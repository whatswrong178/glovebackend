-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 020: Add units_per_carton to products table
-- MediGlove ERP · EPIC-05
--
-- Purpose: When creating an invoice and the user changes the unit from Carton
--          to Box / Pack / etc., the system auto-calculates the selling price
--          per unit by dividing the carton price by units_per_carton.
--
-- Example: Nitrile Gloves M
--   suggested_price   = RM 189.00 (per carton)
--   units_per_carton  = 10        (10 boxes per carton)
--   → auto price per Box = 189 / 10 = RM 18.90
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Add column to products table ─────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS units_per_carton INTEGER NOT NULL DEFAULT 1
  CONSTRAINT products_units_per_carton_positive CHECK (units_per_carton >= 1);

COMMENT ON COLUMN products.units_per_carton IS
  'Number of sub-units (Box/Pack/Can/etc.) inside one Carton. Used for '
  'auto-price calculation when invoice line unit is changed from Carton.';

-- ── 2. Rebuild products_safe_view to include units_per_carton ────────────────
DROP VIEW IF EXISTS products_safe_view;

CREATE OR REPLACE VIEW products_safe_view
WITH (security_barrier = true)
AS
SELECT
  p.id,
  p.name,
  p.sku,
  p.supplier_id,
  s.name                          AS supplier_name,
  p.category,
  -- cost_price: visible to Admin only; NULL for all other roles
  CASE
    WHEN auth_staff_role() = 'Admin' THEN p.cost_price
    ELSE NULL
  END                             AS cost_price,
  p.min_selling_price,
  p.suggested_price,
  p.units_per_carton,
  p.description,
  p.created_at,
  p.updated_at
FROM products p
JOIN suppliers s ON s.id = p.supplier_id;

COMMENT ON VIEW products_safe_view IS
  'security_barrier=true view. cost_price masked to NULL for non-Admin roles.
   Joins supplier name for display. Includes units_per_carton for invoice UX.
   Use this view for all non-Admin product reads.';

GRANT SELECT ON products_safe_view TO authenticated;
