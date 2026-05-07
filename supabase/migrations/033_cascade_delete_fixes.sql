-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 033: Fix FK cascade rules to allow clean invoice / PO / DO deletion
--
-- Problem:
--   Deleting an invoice fails with:
--     "new row for relation 'delivery_orders' violates check constraint
--      'do_invoice_has_invoice'"
--
--   Root cause: delivery_orders.invoice_id has ON DELETE SET NULL.
--   When an invoice is deleted, Postgres NULLs out invoice_id on any linked DO.
--   But the check constraint says: Invoice-type DOs MUST have invoice_id IS NOT NULL.
--   → Conflict → DELETE blocked.
--
-- Fix: Change delivery_orders.invoice_id to ON DELETE CASCADE.
--   - Invoice-type DOs reference a specific invoice; they have no meaning without it.
--   - Sample DOs already have invoice_id = NULL, so they are unaffected.
--   - Deleting an invoice will now also delete its Invoice-type DOs.
--
-- Purchase orders: ON DELETE SET NULL is intentional and kept as-is.
--   A PO can outlive the invoice reference (e.g., re-order). No change needed.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Step 1: Drop the old FK constraint ───────────────────────────────────────
ALTER TABLE delivery_orders
  DROP CONSTRAINT IF EXISTS delivery_orders_invoice_id_fkey;


-- ── Step 2: Recreate with ON DELETE CASCADE ───────────────────────────────────
ALTER TABLE delivery_orders
  ADD CONSTRAINT delivery_orders_invoice_id_fkey
    FOREIGN KEY (invoice_id)
    REFERENCES invoices(id)
    ON DELETE CASCADE;


-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT conname, confdeltype
-- FROM   pg_constraint
-- WHERE  conname = 'delivery_orders_invoice_id_fkey';
-- Expected: confdeltype = 'c'  (c = CASCADE)
