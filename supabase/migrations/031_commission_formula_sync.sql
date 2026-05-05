-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 031: Commission Formula Fix + Full Price-Sync Chain
--
-- Three bugs fixed:
--
-- Bug 1 — get_dashboard_kpis used GROSS REVENUE × rate instead of
--          GROSS PROFIT × rate (formula mismatch with fn_calculate_monthly_payout)
--
-- Bug 2 — invoices.total_amount was NOT recomputed when invoice_items.selling_price
--          changed (e.g. after migration 030 price-sync trigger fired)
--
-- Bug 3 — Editing purchase_order_items.unit_cost (via EditPOModal) had no path
--          back to products.cost_price, so the migration 030 cascade never fired
--          and invoice_items.cost_price_snapshot stayed stale.
--
-- Fix chain after this migration:
--   EditPOModal saves unit_cost
--   → trg_sync_product_cost_from_po  (NEW)  → products.cost_price
--   → trg_sync_open_doc_prices       (M030) → invoice_items.cost_price_snapshot + selling_price
--   → trg_sync_invoice_total         (NEW)  → invoices.total_amount
--   → get_dashboard_kpis()           (FIXED)→ GP-based est_commission / actual_commission
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Trigger 1: PO unit_cost → products.cost_price ────────────────────────────
-- When an admin edits a non-Sent PO's line-item cost, treat that as the new
-- authoritative product cost. Migration 030 then cascades to invoice_items.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_product_cost_from_po()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only cascade for open POs (Draft / Approved).
  -- Sent = archived; its prices are historical records, not current cost.
  IF EXISTS (
    SELECT 1 FROM purchase_orders
    WHERE id     = NEW.po_id
      AND status IN ('Draft', 'Approved')
  ) THEN
    -- Only write when value actually changed — avoids redundant cascades
    UPDATE products
    SET    cost_price = NEW.unit_cost
    WHERE  id         = NEW.product_id
      AND  cost_price IS DISTINCT FROM NEW.unit_cost;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_cost_from_po ON purchase_order_items;

CREATE TRIGGER trg_sync_product_cost_from_po
AFTER UPDATE OF unit_cost
ON purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION sync_product_cost_from_po();


-- ── Trigger 2: invoice_items change → invoices.total_amount ──────────────────
-- When selling_price or qty on an invoice_item changes (including via the
-- migration-030 cascade), recompute the parent invoice's total_amount so
-- the denormalized column stays consistent.
--
-- Formula: total_amount = MAX(0, subtotal - discount + delivery_charge)
-- Only fires for Active invoices (Paid = locked, Cancelled = irrelevant).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_invoice_total_on_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id UUID;
  v_subtotal   NUMERIC;
BEGIN
  -- Works for INSERT, UPDATE (has NEW), and DELETE (has OLD only)
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT COALESCE(SUM(qty::NUMERIC * selling_price), 0)
  INTO   v_subtotal
  FROM   invoice_items
  WHERE  invoice_id = v_invoice_id;

  UPDATE invoices
  SET    total_amount = GREATEST(0,
           v_subtotal
           - COALESCE(discount, 0)
           + COALESCE(delivery_charge, 0)
         )
  WHERE  id     = v_invoice_id
    AND  status = 'Active';   -- never touch Paid / Cancelled totals

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_total ON invoice_items;

CREATE TRIGGER trg_sync_invoice_total
AFTER INSERT OR UPDATE OF qty, selling_price OR DELETE
ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION sync_invoice_total_on_item_change();


-- ── Fix 3: get_dashboard_kpis — GP-based commission formula ──────────────────
-- Old formula: qty × selling_price × rate              (WRONG — gross revenue)
-- New formula: MAX(0, GP_net_of_discount) × rate       (CORRECT — matches fn_calculate_monthly_payout)
--
-- GP per item  = (selling_price - cost_price_snapshot) × qty
-- Disc_alloc   = invoice.discount × (item_revenue / invoice_subtotal)
-- Net GP       = GP_raw - Disc_alloc   (floor at 0)
-- Commission   = Net_GP × rate
--
-- Rates are loaded from system_params (fallback: A=0.20, B=0.15).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_dashboard_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id         UUID    := auth_staff_id();
  v_role              TEXT    := auth_staff_role();
  v_see_all           BOOLEAN;
  v_active_count      INTEGER := 0;
  v_est_commission    NUMERIC := 0;
  v_actual_commission NUMERIC := 0;
  v_public_pool       INTEGER := 0;
  v_rate_a            NUMERIC;
  v_rate_b            NUMERIC;
BEGIN
  v_see_all := (v_role IN ('Admin', 'HR'));

  -- Load commission rates from system_params (consistent with fn_calculate_monthly_payout)
  v_rate_a := get_system_param_numeric('COMMISSION_RATE_A', 0.20);
  v_rate_b := get_system_param_numeric('COMMISSION_RATE_B', 0.15);

  -- ── Active invoice count ──────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_active_count
  FROM invoices
  WHERE status = 'Active'
    AND (v_see_all OR created_by = v_caller_id);

  -- ── Est. commission — Active invoices, GP-based ───────────────────────────
  --
  -- Join to a per-invoice subtotal subquery so we can allocate discount
  -- proportionally by item revenue (same method as fn_calculate_monthly_payout § 1b).
  --
  SELECT COALESCE(SUM(
    GREATEST(0,
      -- Raw GP for this item
      (ii.selling_price - ii.cost_price_snapshot) * ii.qty::NUMERIC

      -- Subtract proportional discount share
      - COALESCE(i.discount, 0)
        * NULLIF(ii.selling_price * ii.qty::NUMERIC, 0)
        / NULLIF(inv_sub.subtotal, 0)
    )
    * CASE WHEN p.category = 'A' THEN v_rate_a ELSE v_rate_b END
  ), 0) INTO v_est_commission
  FROM invoices i
  JOIN invoice_items ii ON ii.invoice_id = i.id
  JOIN products      p  ON p.id           = ii.product_id
  JOIN (
    -- Per-invoice revenue subtotal for discount allocation
    SELECT invoice_id, SUM(qty::NUMERIC * selling_price) AS subtotal
    FROM   invoice_items
    GROUP  BY invoice_id
  ) inv_sub ON inv_sub.invoice_id = i.id
  WHERE i.status = 'Active'
    AND (v_see_all OR i.created_by = v_caller_id);

  -- ── Actual commission — Paid invoices, current calendar month, GP-based ──
  SELECT COALESCE(SUM(
    GREATEST(0,
      (ii.selling_price - ii.cost_price_snapshot) * ii.qty::NUMERIC

      - COALESCE(i.discount, 0)
        * NULLIF(ii.selling_price * ii.qty::NUMERIC, 0)
        / NULLIF(inv_sub.subtotal, 0)
    )
    * CASE WHEN p.category = 'A' THEN v_rate_a ELSE v_rate_b END
  ), 0) INTO v_actual_commission
  FROM invoices i
  JOIN invoice_items ii ON ii.invoice_id = i.id
  JOIN products      p  ON p.id           = ii.product_id
  JOIN (
    SELECT invoice_id, SUM(qty::NUMERIC * selling_price) AS subtotal
    FROM   invoice_items
    GROUP  BY invoice_id
  ) inv_sub ON inv_sub.invoice_id = i.id
  WHERE i.status = 'Paid'
    AND DATE_TRUNC('month', i.paid_at) = DATE_TRUNC('month', NOW())
    AND (v_see_all OR i.created_by = v_caller_id);

  -- ── Public pool (orphan clients) ──────────────────────────────────────────
  SELECT COUNT(*) INTO v_public_pool
  FROM clients
  WHERE is_orphan = TRUE;

  RETURN jsonb_build_object(
    'active_invoices',   v_active_count,
    'est_commission',    ROUND(v_est_commission,    2),
    'actual_commission', ROUND(v_actual_commission, 2),
    'public_pool',       v_public_pool
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_kpis() TO authenticated;


-- ── Verification queries (comment out before running in prod) ─────────────
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE trigger_name IN (
--   'trg_sync_product_cost_from_po',
--   'trg_sync_invoice_total',
--   'trg_sync_open_doc_prices'   -- from migration 030
-- );
--
-- -- Spot-check: compare old vs new est_commission
-- SELECT get_dashboard_kpis();
