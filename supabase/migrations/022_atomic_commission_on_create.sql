-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 022: Atomic Commission on Invoice Creation
-- MediGlove ERP
--
-- Problems fixed:
--   (a) compute_base_commission() was NOT called inside create_invoice_atomic().
--       Frontend was responsible for calling it separately — if it failed or was
--       skipped (e.g. old app version, network drop), the commissions table stayed
--       empty for that invoice. This silently broke get_dashboard_kpis() after
--       Migration 021 started reading from commissions.
--
--   (b) compute_base_commission() was not idempotent — calling it twice would
--       insert duplicate Est rows. Adding a DELETE guard at entry fixes this and
--       makes it safe for the frontend to still call it (no-op re-run).
--
-- Changes:
--   1. PATCH compute_base_commission(UUID):
--      → DELETE existing Est rows for the invoice before recomputing.
--        (Actual rows are never deleted — they are settled and immutable.)
--
--   2. PATCH create_invoice_atomic(...):
--      → Add PERFORM compute_base_commission(v_invoice_id) before RETURN.
--        Runs inside the same transaction — if commission write fails, the
--        whole invoice creation rolls back atomically.
--
-- Monthly reset (每个月1号结算归0):
--   NO migration needed. get_dashboard_kpis() already uses:
--     DATE_TRUNC('month', i.paid_at) = DATE_TRUNC('month', NOW())
--   This naturally returns 0 on the 1st of each month until new invoices are
--   paid. fn_calculate_monthly_payout() is called by Make.com on month-end
--   with explicit (year, month) params — also already correct.
-- ══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Idempotency guard: compute_base_commission()
--    DELETE existing Est rows before recomputing. Safe because:
--    • Actual rows are never touched (status != 'Est' guard).
--    • Calling twice now produces identical rows, not duplicates.
--    • Frontend can continue calling this without side-effects.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_base_commission(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv              invoices%ROWTYPE;
  v_item             invoice_items%ROWTYPE;
  v_product          products%ROWTYPE;
  v_client           clients%ROWTYPE;
  v_split            commission_splits%ROWTYPE;
  v_gp               NUMERIC := 0;
  v_base_rate        NUMERIC;
  v_kam_rate         NUMERIC := 0;
  v_commission       NUMERIC;
  v_total_gp         NUMERIC := 0;
  v_total_discount   NUMERIC;
  v_items_count      INTEGER;
  v_param_kam_days   INTEGER;
  v_param_kam_a      NUMERIC;
  v_param_kam_b      NUMERIC;
BEGIN
  SELECT * INTO v_inv    FROM invoices WHERE id = p_invoice_id;
  SELECT * INTO v_client FROM clients  WHERE id = v_inv.client_id;
  SELECT COUNT(*) INTO v_items_count FROM invoice_items WHERE invoice_id = p_invoice_id;

  -- ── IDEMPOTENCY GUARD ────────────────────────────────────────────────────────
  -- Delete any existing Est rows for this invoice before recomputing.
  -- Actual rows (already settled) are never deleted.
  DELETE FROM commissions
  WHERE invoice_id = p_invoice_id
    AND status     = 'Est';

  -- Load params
  SELECT (value #>> '{}')::INTEGER INTO v_param_kam_days
  FROM system_params WHERE key = 'kam_threshold_days';

  SELECT (value #>> '{}')::NUMERIC INTO v_param_kam_a
  FROM system_params WHERE key = 'kam_bonus_rate_a';

  SELECT (value #>> '{}')::NUMERIC INTO v_param_kam_b
  FROM system_params WHERE key = 'kam_bonus_rate_b';

  -- Per-item discount split equally
  v_total_discount := v_inv.discount / GREATEST(v_items_count, 1);

  FOR v_item IN
    SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id;

    -- GP熔断: GP = max(0, (selling - cost) * qty) - pro-rated discount
    v_gp := GREATEST(
      0,
      ((v_item.selling_price - v_item.cost_price_snapshot) * v_item.qty)
      - v_total_discount
    );

    v_total_gp := v_total_gp + v_gp;
  END LOOP;

  -- Loop again to write commission rows per item category
  FOR v_item IN
    SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id;

    v_gp := GREATEST(
      0,
      ((v_item.selling_price - v_item.cost_price_snapshot) * v_item.qty)
      - (v_inv.discount / GREATEST(v_items_count, 1))
    );

    -- Base commission rate by category
    IF v_product.category = 'A' THEN
      SELECT (value #>> '{}')::NUMERIC INTO v_base_rate
      FROM system_params WHERE key = 'commission_rate_a';
    ELSE
      SELECT (value #>> '{}')::NUMERIC INTO v_base_rate
      FROM system_params WHERE key = 'commission_rate_b';
    END IF;

    -- KAM loyalty bonus: client cooperation >= 180 days
    v_kam_rate := 0;
    IF v_client.first_order_date IS NOT NULL
       AND (CURRENT_DATE - v_client.first_order_date) >= v_param_kam_days
    THEN
      IF v_product.category = 'A' THEN
        v_kam_rate := v_param_kam_a;
      ELSE
        v_kam_rate := v_param_kam_b;
      END IF;
    END IF;

    v_commission := v_gp * (v_base_rate + v_kam_rate);

    -- Check for tug-of-war split
    SELECT * INTO v_split
    FROM commission_splits
    WHERE invoice_id = p_invoice_id
    LIMIT 1;

    IF FOUND THEN
      -- Split Base commission between owner and assistant
      INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
      VALUES
        (p_invoice_id, v_split.owner_id,     'Base',
         v_commission * (v_split.owner_ratio / 100), 'Est'),
        (p_invoice_id, v_split.assistant_id, 'Base',
         v_commission * (v_split.assistant_ratio / 100), 'Est');

      -- KAM bonus goes to the commission owner (original owner)
      IF v_kam_rate > 0 THEN
        INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
        VALUES
          (p_invoice_id, v_split.owner_id, 'KAM',
           v_gp * v_kam_rate * (v_split.owner_ratio / 100), 'Est');
      END IF;
    ELSE
      -- Full commission to creator
      INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
      VALUES
        (p_invoice_id, v_inv.created_by, 'Base', v_commission, 'Est');

      IF v_kam_rate > 0 THEN
        INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
        VALUES
          (p_invoice_id, v_inv.created_by, 'KAM', v_gp * v_kam_rate, 'Est');
      END IF;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_base_commission(UUID) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Atomic commission write inside create_invoice_atomic()
--    Single PERFORM call added before RETURN. Same transaction = full rollback
--    on failure. Frontend calling compute_base_commission() again afterwards
--    is now a safe idempotent no-op (deletes+rewrites same rows).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_invoice_atomic(
  p_client_id       UUID,
  p_items           JSONB,   -- [{product_id, qty, selling_price}]
  p_discount        NUMERIC DEFAULT 0,
  p_delivery_charge NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        UUID    := auth_staff_id();
  v_client           clients%ROWTYPE;
  v_item             JSONB;
  v_product          products%ROWTYPE;
  v_total_qty        INTEGER := 0;
  v_total_amount     NUMERIC := 0;
  v_delivery_charge  NUMERIC := p_delivery_charge;
  v_invoice_no       TEXT;
  v_invoice_id       UUID    := gen_random_uuid();
  v_do_id            UUID    := gen_random_uuid();
  v_do_no            TEXT;
  v_owner_id_before  UUID;
  v_neglect_idx      INTEGER;
  v_split_owner_pct  NUMERIC;
  v_split_asst_pct   NUMERIC;
  v_ownership_transferred BOOLEAN := FALSE;
BEGIN
  -- ── 4.1  Load client (lock row for update)
  SELECT * INTO v_client
  FROM clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found: %', p_client_id;
  END IF;

  v_owner_id_before := v_client.owner_id;
  v_neglect_idx     := v_client.neglect_index;

  -- ── 4.2  Validate & aggregate items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::UUID;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id';
    END IF;

    -- Price floor guard
    IF (v_item->>'selling_price')::NUMERIC < v_product.min_selling_price THEN
      RAISE EXCEPTION
        'Selling price % is below min_selling_price % for SKU %',
        v_item->>'selling_price',
        v_product.min_selling_price,
        v_product.sku;
    END IF;

    v_total_qty    := v_total_qty + (v_item->>'qty')::INTEGER;
    v_total_amount := v_total_amount
                    + ((v_item->>'selling_price')::NUMERIC * (v_item->>'qty')::INTEGER);
  END LOOP;

  -- ── 4.3  Promo rule: 3-box minimum
  IF v_total_qty < 3 THEN
    RAISE EXCEPTION
      'Order rejected: minimum 3 boxes required. Current total: % box(es).',
      v_total_qty;
  END IF;

  -- ── 4.4  Promo rule: West Malaysia >= 5 boxes → free shipping
  IF v_client.region = 'West Malaysia' AND v_total_qty >= 5 THEN
    v_delivery_charge := 0;
  END IF;

  v_total_amount := v_total_amount - p_discount + v_delivery_charge;

  -- ── 4.5  Generate invoice number
  v_invoice_no := generate_invoice_no();

  -- ── 4.6  Resolve neglect split (tug-of-war)
  IF v_neglect_idx > 0 AND v_owner_id_before IS NOT NULL
     AND v_owner_id_before <> v_caller_id
  THEN
    -- Determine split percentages from system_params or hardcoded tiers
    -- (mirrors existing split logic from original 003 migration)
    v_split_owner_pct := CASE
      WHEN v_neglect_idx >= 3 THEN 0
      WHEN v_neglect_idx = 2  THEN 20
      ELSE                        50
    END;
    v_split_asst_pct := 100 - v_split_owner_pct;

    INSERT INTO commission_splits
      (invoice_id, owner_id, assistant_id, owner_ratio, assistant_ratio)
    VALUES
      (v_invoice_id, v_owner_id_before, v_caller_id,
       v_split_owner_pct, v_split_asst_pct);
  END IF;

  -- ── 4.7  Transfer ownership if neglect_index >= 3
  IF v_neglect_idx >= 3 AND v_owner_id_before IS NOT NULL
     AND v_owner_id_before <> v_caller_id
  THEN
    UPDATE clients
    SET    owner_id      = v_caller_id,
           neglect_index = 0
    WHERE  id = p_client_id;

    v_ownership_transferred := TRUE;
  END IF;

  -- ── 4.8  Insert Invoice
  INSERT INTO invoices
    (id, invoice_no, client_id, created_by, discount, delivery_charge,
     total_amount, status, neglect_split)
  VALUES
    (v_invoice_id, v_invoice_no, p_client_id, v_caller_id, p_discount,
     v_delivery_charge, v_total_amount, 'Active',
     CASE WHEN v_split_owner_pct IS NOT NULL
          THEN jsonb_build_object(
                 'owner_pct',    v_split_owner_pct,
                 'invoicer_pct', v_split_asst_pct
               )
          ELSE NULL
     END);

  -- ── 4.9  Insert Invoice Items + Draft POs per supplier
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID;

    INSERT INTO invoice_items
      (invoice_id, product_id, qty, selling_price, cost_price_snapshot)
    VALUES
      (v_invoice_id,
       v_product.id,
       (v_item->>'qty')::INTEGER,
       (v_item->>'selling_price')::NUMERIC,
       v_product.cost_price);

    -- Upsert Draft PO per supplier (one PO per supplier per invoice)
    WITH existing_po AS (
      SELECT id FROM purchase_orders
      WHERE invoice_id = v_invoice_id AND supplier_id = v_product.supplier_id
      LIMIT 1
    ),
    new_po AS (
      INSERT INTO purchase_orders (po_no, supplier_id, invoice_id, status)
      SELECT generate_po_no(), v_product.supplier_id, v_invoice_id, 'Draft'
      WHERE NOT EXISTS (SELECT 1 FROM existing_po)
      RETURNING id
    ),
    resolved_po AS (
      SELECT id FROM existing_po
      UNION ALL
      SELECT id FROM new_po
    )
    INSERT INTO purchase_order_items (po_id, product_id, qty, unit_cost)
    SELECT r.id, v_product.id, (v_item->>'qty')::INTEGER, v_product.cost_price
    FROM resolved_po r;
  END LOOP;

  -- ── 4.10  Insert Delivery Order
  v_do_no := generate_do_no('Invoice');

  INSERT INTO delivery_orders
    (id, do_no, type, invoice_id, client_id, created_by, status)
  VALUES
    (v_do_id, v_do_no, 'Invoice', v_invoice_id, p_client_id, v_caller_id, 'Pending');

  -- ── 4.11  Set first_order_date on client if this is their first invoice
  UPDATE clients
  SET first_order_date = CURRENT_DATE
  WHERE id = p_client_id AND first_order_date IS NULL;

  -- ── 4.12  Compute commission rows atomically (Migration 022)
  --   Writes Est rows to commissions table in the same transaction.
  --   If this fails the whole invoice creation rolls back.
  --   compute_base_commission() is now idempotent — frontend calling it
  --   again afterwards is a safe no-op (deletes + rewrites same Est rows).
  PERFORM compute_base_commission(v_invoice_id);

  RETURN jsonb_build_object(
    'invoice_id',             v_invoice_id,
    'invoice_no',             v_invoice_no,
    'do_id',                  v_do_id,
    'do_no',                  v_do_no,
    'total_amount',           v_total_amount,
    'delivery_charge',        v_delivery_charge,
    'neglect_index_applied',  v_neglect_idx,
    'ownership_transferred',  v_ownership_transferred
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_invoice_atomic(UUID, JSONB, NUMERIC, NUMERIC) TO authenticated;
