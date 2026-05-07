-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 035: Fix cost_price_snapshot unit mismatch
--
-- Problem:
--   invoice_items.selling_price  = price PER CARTON (e.g. RM 199 / carton)
--   invoice_items.qty            = quantity IN CARTONS (e.g. 4 cartons)
--   invoice_items.cost_price_snapshot was being set to products.cost_price
--   which is PER UNIT (e.g. RM 16.90 / unit)
--
--   GP formula:  (selling_price - cost_price_snapshot) × qty
--   Old result:  (199 - 16.90) × 4 = RM 728  ← WRONG (mixing units)
--   Correct:     (199 - 16.90 × 10) × 4 = RM 120  (10 units per carton)
--
-- Fix:
--   cost_price_snapshot must be PER CARTON = cost_price × units_per_carton
--   Then (selling_price − cost_price_snapshot) × qty is dimensionally correct.
--
-- Scope:
--   1. Rewrite sync_open_doc_prices() to store per-carton snapshot.
--   2. Re-attach trigger to also fire on units_per_carton changes.
--   3. Backfill cost_price_snapshot on ALL statuses (old data was wrong unit).
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Step 1: Rewrite sync_open_doc_prices ─────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_open_doc_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- ── 1. Purchase order items (open = Draft or Approved) ────────────────────
  -- unit_cost stays per-unit (that is how suppliers quote / how POs are entered)
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    UPDATE purchase_order_items poi
    SET    unit_cost = NEW.cost_price
    FROM   purchase_orders po
    WHERE  poi.po_id      = po.id
      AND  poi.product_id = NEW.id
      AND  po.status     IN ('Draft', 'Approved');
  END IF;

  -- ── 2. Invoice items (open = Active) ─────────────────────────────────────
  IF NEW.suggested_price   IS DISTINCT FROM OLD.suggested_price
  OR NEW.cost_price        IS DISTINCT FROM OLD.cost_price
  OR NEW.units_per_carton  IS DISTINCT FROM OLD.units_per_carton
  THEN
    -- selling_price sync (unchanged logic)
    IF NEW.suggested_price IS DISTINCT FROM OLD.suggested_price THEN
      UPDATE invoice_items ii
      SET    selling_price = NEW.suggested_price
      FROM   invoices inv
      WHERE  ii.invoice_id = inv.id
        AND  ii.product_id = NEW.id
        AND  inv.status    = 'Active';
    END IF;

    -- cost_price_snapshot = PER-CARTON cost = cost_price × units_per_carton
    -- This makes it dimensionally consistent with selling_price (also per carton)
    -- so the GP formula (selling_price - cost_price_snapshot) × qty is correct.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE  table_schema = 'public'
        AND  table_name   = 'invoice_items'
        AND  column_name  = 'cost_price_snapshot'
    ) AND (
      NEW.cost_price       IS DISTINCT FROM OLD.cost_price
      OR NEW.units_per_carton IS DISTINCT FROM OLD.units_per_carton
    )
    THEN
      UPDATE invoice_items ii
      SET    cost_price_snapshot = NEW.cost_price
                                   * COALESCE(NEW.units_per_carton, 1)
      FROM   invoices inv
      WHERE  ii.invoice_id = inv.id
        AND  ii.product_id = NEW.id
        AND  inv.status    = 'Active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-attach — now also fires when units_per_carton changes
DROP TRIGGER IF EXISTS trg_sync_open_doc_prices ON products;

CREATE TRIGGER trg_sync_open_doc_prices
AFTER UPDATE OF cost_price, min_selling_price, suggested_price, units_per_carton
ON products
FOR EACH ROW
EXECUTE FUNCTION sync_open_doc_prices();


-- ── Step 2: Backfill cost_price_snapshot (ALL statuses) ─────────────────────
-- The old snapshot was per-unit; correct value is per-carton.
-- We fix all rows where a valid cost_price exists so historical P&L is accurate.
-- Rows where cost_price = 0 or NULL are left as-is (no data to work with).

UPDATE invoice_items ii
SET    cost_price_snapshot = p.cost_price * COALESCE(p.units_per_carton, 1)
FROM   products p
WHERE  ii.product_id = p.id
  AND  p.cost_price  > 0;


-- ── Step 3: Recompute total_amount for Active invoices ───────────────────────
-- selling_price is unchanged so total_amount does NOT change —
-- the snapshot fix only affects GP / commission, not the invoice total.
-- (No recompute needed here — total_amount = SUM(qty × selling_price) - discount + delivery)


-- ── Verification ─────────────────────────────────────────────────────────────
-- After running, spot-check with:
--
-- SELECT
--   ii.id,
--   p.sku,
--   p.cost_price                                        AS cost_per_unit,
--   p.units_per_carton,
--   p.cost_price * COALESCE(p.units_per_carton, 1)     AS cost_per_carton,
--   ii.cost_price_snapshot,
--   ii.selling_price,
--   (ii.selling_price - ii.cost_price_snapshot) * ii.qty AS gp_correct
-- FROM invoice_items ii
-- JOIN products p ON p.id = ii.product_id
-- LIMIT 20;
--
-- GP should now equal: (selling_price_per_carton - cost_per_carton) × qty_cartons
