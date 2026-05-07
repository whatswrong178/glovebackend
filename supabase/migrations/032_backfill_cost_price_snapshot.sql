-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 032: Backfill cost_price_snapshot + recompute Active invoice totals
--
-- Root cause of est_commission still showing wrong value after M031:
--   invoice_items.cost_price_snapshot was 0 (or NULL) on pre-existing rows.
--   GP formula = (selling_price - 0) × qty = selling_price × qty
--   → identical to the old wrong gross-revenue formula.
--
-- Fix 1: Backfill cost_price_snapshot from products.cost_price for any
--   invoice_item where it is NULL or 0 but the product has a real cost_price.
--
-- Fix 2: Recompute invoices.total_amount for all Active invoices.
--   The trg_sync_invoice_total trigger (M031) only fires on new row changes;
--   existing rows were never backfilled. This one-time recompute closes that gap.
--
-- Safety: Paid and Cancelled invoices are intentionally NOT touched —
--   they are historical records whose totals are locked.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Fix 1: Backfill cost_price_snapshot ──────────────────────────────────────
-- Only overwrites rows that are clearly stale (snapshot = 0 or NULL)
-- AND the product actually has a known cost (cost_price > 0).
-- Rows with a genuine zero-cost product are intentionally left as-is.

UPDATE invoice_items ii
SET    cost_price_snapshot = p.cost_price
FROM   products p
WHERE  ii.product_id = p.id
  AND  p.cost_price  > 0
  AND  (ii.cost_price_snapshot IS NULL OR ii.cost_price_snapshot = 0);


-- ── Fix 2: Recompute total_amount for all Active invoices ─────────────────────
-- Formula mirrors trg_sync_invoice_total (M031):
--   total = MAX(0, subtotal − discount + delivery_charge)

UPDATE invoices i
SET    total_amount = GREATEST(
         0,
         (
           SELECT COALESCE(SUM(qty::NUMERIC * selling_price), 0)
           FROM   invoice_items
           WHERE  invoice_id = i.id
         )
         - COALESCE(i.discount, 0)
         + COALESCE(i.delivery_charge, 0)
       )
WHERE  i.status = 'Active';


-- ── Verification queries (comment out before running in prod) ─────────────────
-- -- Count rows fixed:
-- SELECT COUNT(*) AS fixed_snapshots
-- FROM invoice_items ii
-- JOIN products p ON p.id = ii.product_id
-- WHERE ii.cost_price_snapshot = p.cost_price AND p.cost_price > 0;
--
-- -- Check dashboard KPIs after backfill:
-- SELECT get_dashboard_kpis();
