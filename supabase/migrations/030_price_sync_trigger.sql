-- Migration 030 — Auto-sync open PO / invoice prices when a product price changes
-- When cost_price / min_selling_price / suggested_price is updated on a product,
-- any non-frozen document that references that product is updated automatically.
--
-- PO freeze boundary  : status = 'Sent'  (Draft + Approved are live)
-- Invoice freeze boundary : status IN ('Paid', 'Cancelled')  (Active is live)
--
-- This prevents the need to manually re-key prices on every open document after
-- a global bulk-price update.

-- ── Trigger function ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_open_doc_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- ── 1. Purchase order items (open = Draft or Approved) ──────────────────────
  -- unit_cost maps to cost_price (price per carton)
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    UPDATE purchase_order_items poi
    SET    unit_cost = NEW.cost_price
    FROM   purchase_orders po
    WHERE  poi.po_id      = po.id
      AND  poi.product_id = NEW.id
      AND  po.status     IN ('Draft', 'Approved');
  END IF;

  -- ── 2. Invoice items (open = Active) ────────────────────────────────────────
  -- selling_price maps to suggested_price
  -- cost_price_snapshot maps to cost_price  (if the column exists)
  IF NEW.suggested_price IS DISTINCT FROM OLD.suggested_price
  OR NEW.cost_price      IS DISTINCT FROM OLD.cost_price
  THEN
    -- selling_price sync
    IF NEW.suggested_price IS DISTINCT FROM OLD.suggested_price THEN
      UPDATE invoice_items ii
      SET    selling_price = NEW.suggested_price
      FROM   invoices inv
      WHERE  ii.invoice_id  = inv.id
        AND  ii.product_id  = NEW.id
        AND  inv.status     = 'Active';
    END IF;

    -- cost_price_snapshot sync (column may not exist on all deployments — guard it)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE  table_schema = 'public'
        AND  table_name   = 'invoice_items'
        AND  column_name  = 'cost_price_snapshot'
    ) AND NEW.cost_price IS DISTINCT FROM OLD.cost_price
    THEN
      UPDATE invoice_items ii
      SET    cost_price_snapshot = NEW.cost_price
      FROM   invoices inv
      WHERE  ii.invoice_id  = inv.id
        AND  ii.product_id  = NEW.id
        AND  inv.status     = 'Active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Attach trigger to products ────────────────────────────────────────────────
-- Drop if re-running migration (idempotent)
DROP TRIGGER IF EXISTS trg_sync_open_doc_prices ON products;

CREATE TRIGGER trg_sync_open_doc_prices
AFTER UPDATE OF cost_price, min_selling_price, suggested_price
ON products
FOR EACH ROW
EXECUTE FUNCTION sync_open_doc_prices();

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT trigger_name, event_manipulation, action_statement
-- FROM information_schema.triggers
-- WHERE trigger_name = 'trg_sync_open_doc_prices';
