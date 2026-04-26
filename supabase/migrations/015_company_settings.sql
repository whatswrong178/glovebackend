-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 015: Company Settings (Letterhead Source of Truth)
--
-- Creates a singleton company_settings table.
-- Only 1 row ever exists (id = '00000000-0000-0000-0000-000000000001').
-- Admin can update; all authenticated staff can SELECT (needed for doc generation).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_settings (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name     TEXT          NOT NULL DEFAULT 'MediGlove Sdn Bhd',
  registration_no  TEXT,                        -- SSM / CCM number
  gst_no           TEXT,                        -- GST or SST registration number
  address_line1    TEXT,
  address_line2    TEXT,
  city             TEXT,
  postcode         TEXT,
  state            TEXT,
  country          TEXT          NOT NULL DEFAULT 'Malaysia',
  phone            TEXT,
  fax              TEXT,
  email            TEXT,
  website          TEXT,
  logo_url         TEXT,                        -- Full URL to logo in Supabase Storage
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_by       UUID          REFERENCES staff(id) ON DELETE SET NULL
);

COMMENT ON TABLE  company_settings IS 'Singleton — always exactly one row. Used for all document letterheads.';
COMMENT ON COLUMN company_settings.logo_url IS 'Public URL of logo image in Supabase Storage bucket "company-assets"';

-- ── 2. Seed singleton row ─────────────────────────────────────────────────────
INSERT INTO company_settings (
  id,
  company_name,
  country
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'MediGlove Sdn Bhd',
  'Malaysia'
) ON CONFLICT (id) DO NOTHING;

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

-- Admin: full control
CREATE POLICY company_settings_admin_all ON company_settings
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin')
  WITH CHECK (auth_staff_role() = 'Admin');

-- All staff: read (needed for invoice/DO letterhead)
CREATE POLICY company_settings_staff_read ON company_settings
  FOR SELECT TO authenticated
  USING (auth.role() = 'authenticated');

-- ── 4. updated_at trigger ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON company_settings;
CREATE TRIGGER trg_company_settings_updated_at
  BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── MANUAL STEP (Supabase Dashboard): ────────────────────────────────────────
-- Storage → New Bucket → Name: "company-assets" → Public: TRUE
-- This cannot be done via SQL. Do it once in the dashboard.
-- ─────────────────────────────────────────────────────────────────────────────
