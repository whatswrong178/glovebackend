-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 028 — Document Improvements
-- MediGlove ERP · EPIC-05/07/08
--
-- 1. purchase_order_items: add `unit` column (measurement unit per line item).
-- 2. company_settings: add `terms_and_conditions` column (global T&C text).
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Unit column on PO items
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'Carton';

COMMENT ON COLUMN purchase_order_items.unit IS
  'Measurement unit for this PO line item (e.g. Carton, Box, Pack)';

-- 2. Terms and conditions on company settings (global, shown on all docs)
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS terms_and_conditions text;

COMMENT ON COLUMN company_settings.terms_and_conditions IS
  'Default T&C text printed at the bottom of all invoices, DOs, and POs';
