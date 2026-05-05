-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 027: clients.address + product parent_product_id for variants
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Add address column to clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'address'
  ) THEN
    ALTER TABLE clients ADD COLUMN address TEXT;
  END IF;
END;
$$;

COMMENT ON COLUMN clients.address IS 'Full delivery / billing address for printed documents';

-- 2. Add parent_product_id to products (self-ref for variant grouping)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'parent_product_id'
  ) THEN
    ALTER TABLE products
      ADD COLUMN parent_product_id UUID REFERENCES products(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'variant_label'
  ) THEN
    ALTER TABLE products ADD COLUMN variant_label TEXT;
  END IF;
END;
$$;

COMMENT ON COLUMN products.parent_product_id IS 'NULL = standalone or parent product; non-NULL = this is a variant of the parent';
COMMENT ON COLUMN products.variant_label     IS 'Human-readable size/spec label e.g. "Small", "XL", "200pcs"';

CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_product_id)
  WHERE parent_product_id IS NOT NULL;
