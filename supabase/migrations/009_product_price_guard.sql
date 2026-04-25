-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 009 — Product Price Guard + Supplier Constraint + Playbook Types
-- MediGlove ERP · EPIC-03 / T-03.2 / T-03.3
--
-- Sections:
--   A. products table hardening
--      A1. Backfill NULL supplier_id (point to a sentinel "Unknown" supplier)
--      A2. Drop old FK (ON DELETE SET NULL) → re-add (ON DELETE RESTRICT)
--      A3. ALTER supplier_id SET NOT NULL
--      A4. Add updated_at column + trigger
--   B. products_safe_view (enhanced: supplier name join, security_barrier=true)
--   C. fn_validate_price_guard(p_product_id, p_selling_price) RPC
--   D. playbook_materials: expand type CHECK to include Article/Comic/Music
--   E. GRANTs
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A: Products table hardening
-- ─────────────────────────────────────────────────────────────────────────────

-- A1. Ensure a fallback "Unknown Supplier" sentinel exists for backfill.
--     ON CONFLICT on name is not guaranteed unique — use a fixed known UUID
--     so this INSERT is idempotent.
DO $$
DECLARE
  v_sentinel_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO suppliers (id, name)
  VALUES (v_sentinel_id, '[Unknown Supplier]')
  ON CONFLICT (id) DO NOTHING;

  -- Point any NULL supplier_id rows to sentinel
  UPDATE products
     SET supplier_id = v_sentinel_id
   WHERE supplier_id IS NULL;
END;
$$;

-- A2. Drop the old FK constraint (which allowed ON DELETE SET NULL → NULL values)
DO $$
BEGIN
  ALTER TABLE products
    DROP CONSTRAINT IF EXISTS products_supplier_id_fkey;
EXCEPTION WHEN others THEN
  NULL; -- constraint name may differ; the DO block below re-adds correctly
END;
$$;

-- Re-add with ON DELETE RESTRICT (Admin must reassign products before deleting supplier)
ALTER TABLE products
  ADD CONSTRAINT products_supplier_id_fkey
    FOREIGN KEY (supplier_id)
    REFERENCES suppliers(id)
    ON DELETE RESTRICT;

-- A3. Enforce NOT NULL — backfill above guarantees no existing NULLs
ALTER TABLE products
  ALTER COLUMN supplier_id SET NOT NULL;

COMMENT ON COLUMN products.supplier_id IS
  'NOT NULL — every product must belong to a supplier. ON DELETE RESTRICT prevents orphaning.';

-- A4. Add updated_at column (idempotent)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- updated_at auto-maintenance trigger (re-use the fn_set_updated_at function from 007)
DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B: products_safe_view — enhanced with supplier name, security_barrier
-- Replaces the version created in Migration 002.
-- ─────────────────────────────────────────────────────────────────────────────

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
  p.description,
  p.created_at,
  p.updated_at
FROM products p
JOIN suppliers s ON s.id = p.supplier_id;

COMMENT ON VIEW products_safe_view IS
  'security_barrier=true view. cost_price masked to NULL for non-Admin roles.
   Joins supplier name for display. Use this view for all non-Admin product reads.';

-- Grant SELECT on the view to authenticated role
GRANT SELECT ON products_safe_view TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION C: fn_validate_price_guard(p_product_id, p_selling_price)
-- Called by invoice creation to reject selling price below min_selling_price.
-- Returns: { "valid": true } or raises EXCEPTION with code 'price_below_floor'.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_validate_price_guard(
  p_product_id    UUID,
  p_selling_price NUMERIC(12,2)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product products%ROWTYPE;
BEGIN
  -- Load product
  SELECT * INTO v_product FROM products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found: id=%', p_product_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Price floor check
  IF p_selling_price < v_product.min_selling_price THEN
    RAISE EXCEPTION
      'price_below_floor: selling_price=% is below min_selling_price=% for product "%"',
      p_selling_price, v_product.min_selling_price, v_product.name
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'valid',              true,
    'product_id',         p_product_id,
    'product_name',       v_product.name,
    'selling_price',      p_selling_price,
    'min_selling_price',  v_product.min_selling_price,
    'margin',             p_selling_price - v_product.min_selling_price
  );
END;
$$;

COMMENT ON FUNCTION fn_validate_price_guard IS
  'Price floor enforcement RPC. Called before invoice_item INSERT.
   Raises P0002 exception if selling_price < min_selling_price.
   Use: SELECT fn_validate_price_guard(product_id, unit_price) from invoice creation flow.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION D: playbook_materials — expand type CHECK constraint
-- v10 spec adds: Article, Comic, Music (001 only had PDF/Video/Image/Script)
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop old type check, re-add with full v10 enum
ALTER TABLE playbook_materials
  DROP CONSTRAINT IF EXISTS playbook_materials_type_check;

ALTER TABLE playbook_materials
  ADD CONSTRAINT playbook_materials_type_check
    CHECK (type IN ('PDF', 'Video', 'Image', 'Script', 'Article', 'Comic', 'Music'));

COMMENT ON COLUMN playbook_materials.type IS
  'v10: PDF | Video | Image | Script | Article | Comic | Music';

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION E: GRANTs
-- ─────────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION fn_validate_price_guard(UUID, NUMERIC) TO authenticated;

-- ── Verification markers ──────────────────────────────────────────────────────
-- products.supplier_id: NOT NULL enforced, FK ON DELETE RESTRICT
-- products.updated_at: auto-maintained by trg_products_updated_at
-- products_safe_view: security_barrier=true, supplier_name joined, cost_price masked
-- fn_validate_price_guard: P0002 exception on price < floor
-- playbook_materials.type: expanded to 6 values (v10 spec)
