-- Migration 029 — Add image_url to products
-- Allows each product to have a public image shown on the official website.
-- Upload via ERP product edit page → Supabase Storage bucket "product-images".

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;

-- Expose the column in the safe view used by non-Admin roles
-- (products_safe_view already mirrors all non-sensitive columns)
-- If a view exists we need to recreate it to include the new column.
-- Guard: only drop/recreate if the view exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'products_safe_view'
  ) THEN
    DROP VIEW products_safe_view;
    CREATE VIEW products_safe_view AS
      SELECT
        p.id,
        p.name,
        p.sku,
        p.category,
        p.min_selling_price,
        p.suggested_price,
        p.units_per_carton,
        p.description,
        p.image_url,
        s.name AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id;
  END IF;
END;
$$;

-- Storage bucket for product images (run once; idempotent via INSERT ... ON CONFLICT DO NOTHING)
-- NOTE: bucket creation via SQL is only supported on self-hosted Supabase.
-- For Supabase Cloud, create the bucket manually in the Dashboard:
--   Storage → New bucket → Name: "product-images" → Public: YES
-- The policy below grants public read access.

-- Public read policy on product-images bucket (Cloud: create in Dashboard → Policies)
-- INSERT INTO storage.buckets (id, name, public)
--   VALUES ('product-images', 'product-images', true)
--   ON CONFLICT (id) DO NOTHING;

-- Public SELECT policy
-- CREATE POLICY "Public read product-images"
--   ON storage.objects FOR SELECT
--   USING (bucket_id = 'product-images');

-- Admin INSERT / UPDATE / DELETE policy (service_role bypasses RLS, so no extra policy needed)
