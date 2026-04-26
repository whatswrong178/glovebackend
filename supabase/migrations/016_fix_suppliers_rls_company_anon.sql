-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 016: Fix broken RLS + company_settings anon read
--
-- 1. suppliers_admin_all in migration 013 used `staff.id = auth.uid()` which
--    is WRONG — staff.id is the staff UUID, auth.uid() is the auth UUID.
--    The correct bridge column is auth_user_id. Drop and recreate.
--
-- 2. company_settings needs anon SELECT so the login page can display
--    the company logo/name before the user authenticates.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Fix suppliers RLS ─────────────────────────────────────────────────────
-- Drop ALL previously created policies to avoid "already exists" conflict

DROP POLICY IF EXISTS suppliers_admin_all         ON suppliers;
DROP POLICY IF EXISTS suppliers_staff_read        ON suppliers;
DROP POLICY IF EXISTS suppliers_hr_read           ON suppliers;
DROP POLICY IF EXISTS suppliers_sales_leader_read ON suppliers;
DROP POLICY IF EXISTS suppliers_logistics_read    ON suppliers;

-- All policies from migration 002 that were correct — restore them
-- Admin: full CRUD via helper function (correct)
CREATE POLICY suppliers_admin_all ON suppliers
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin')
  WITH CHECK (auth_staff_role() = 'Admin');

-- HR: read only
CREATE POLICY suppliers_hr_read ON suppliers
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader/Sales: read (for product forms)
CREATE POLICY suppliers_sales_leader_read ON suppliers
  FOR SELECT TO authenticated
  USING (auth_staff_role() IN ('Leader', 'Sales'));

-- ── 2. company_settings — allow anon SELECT (login page branding) ─────────────

DROP POLICY IF EXISTS company_settings_staff_read  ON company_settings;
DROP POLICY IF EXISTS company_settings_public_read ON company_settings;

-- Allow all roles (anon + authenticated) to SELECT
CREATE POLICY company_settings_public_read ON company_settings
  FOR SELECT
  USING (true);
