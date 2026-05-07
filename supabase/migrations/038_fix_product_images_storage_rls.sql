-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 038: Fix product-images storage bucket + RLS policies
--
-- Error: "new row violates row-level security policy" when uploading logo
--        from Settings page.
--
-- Root cause: The product-images bucket either (a) doesn't exist yet, or
--             (b) exists but has no INSERT policy allowing Admin uploads.
--
-- Fix:
--   1. Upsert the bucket as public=true (images must be readable in PDFs/
--      invoices without auth tokens — e.g. company logo in printed docs).
--   2. Add INSERT policy  → authenticated Admin can upload any path.
--   3. Add UPDATE policy  → authenticated Admin can overwrite (upsert: true).
--   4. Add SELECT policy  → public read (bucket is public, but belt+suspenders).
--   5. Add DELETE policy  → authenticated Admin can remove stale files.
--
-- Upload path used by settings page: logos/company-logo.{ext}
-- Upload path used by product form:  products/{product_id}/{filename}
-- Both paths live in the same bucket → one policy set covers both.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Ensure bucket exists and is public ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,            -- public: objects readable without auth token
  5242880,         -- 5 MB max per file
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── 2. Drop stale / conflicting policies (idempotent) ────────────────────────
DROP POLICY IF EXISTS "Admin can upload product images"   ON storage.objects;
DROP POLICY IF EXISTS "Admin can update product images"   ON storage.objects;
DROP POLICY IF EXISTS "Public can read product images"    ON storage.objects;
DROP POLICY IF EXISTS "Admin can delete product images"   ON storage.objects;
DROP POLICY IF EXISTS "product-images insert"             ON storage.objects;
DROP POLICY IF EXISTS "product-images select"             ON storage.objects;
DROP POLICY IF EXISTS "product-images update"             ON storage.objects;
DROP POLICY IF EXISTS "product-images delete"             ON storage.objects;


-- ── 3. INSERT — Admin only ────────────────────────────────────────────────────
CREATE POLICY "product-images insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.staff
    WHERE id   = auth.uid()
      AND role = 'Admin'
  )
);


-- ── 4. UPDATE — Admin only (needed for upsert: true) ─────────────────────────
CREATE POLICY "product-images update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.staff
    WHERE id   = auth.uid()
      AND role = 'Admin'
  )
);


-- ── 5. SELECT — public (bucket is public; this is belt-and-suspenders) ───────
CREATE POLICY "product-images select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'product-images');


-- ── 6. DELETE — Admin only ────────────────────────────────────────────────────
CREATE POLICY "product-images delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.staff
    WHERE id   = auth.uid()
      AND role = 'Admin'
  )
);


-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'product-images';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';
