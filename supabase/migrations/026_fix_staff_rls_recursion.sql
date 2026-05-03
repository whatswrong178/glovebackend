-- ══════════════════════════════════════════════════════════════════════════════
-- 026_fix_staff_rls_recursion.sql
-- MediGlove ERP — Hotfix: staff table RLS infinite recursion
--
-- Problem (Migration 025):
--   The staff SELECT/UPDATE policies used:
--     EXISTS (SELECT 1 FROM staff WHERE auth_user_id = auth.uid() AND role = ...)
--   When the policy is ON the staff table itself, this sub-query is also
--   subject to the same RLS policy → infinite recursion → 0 rows returned
--   → Admin loses all permissions.
--
-- Fix:
--   1. Create auth_staff_role() as SECURITY DEFINER — runs without RLS,
--      safely reads the caller's own role from staff.
--   2. Rebuild all staff policies using auth_staff_role() instead of the
--      self-referential subquery.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Drop the recursive policies from migration 025 ─────────────────────────
DROP POLICY IF EXISTS "staff_select"        ON staff;
DROP POLICY IF EXISTS "staff_insert_admin"  ON staff;
DROP POLICY IF EXISTS "staff_update"        ON staff;
DROP POLICY IF EXISTS "staff_delete_admin"  ON staff;

-- ── 2. SECURITY DEFINER helper — bypasses RLS to read own role ────────────────
-- This function runs with the privileges of the definer (postgres), not the
-- caller, so it can read the staff table without triggering RLS recursion.
CREATE OR REPLACE FUNCTION auth_staff_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM staff WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- ── 3. Rebuild staff RLS policies (non-recursive) ─────────────────────────────
CREATE POLICY "staff_select" ON staff
  FOR SELECT USING (
    -- Own row — always visible
    auth_user_id = auth.uid()
    OR
    -- Admin or HR can see all rows
    auth_staff_role() IN ('Admin', 'HR')
  );

CREATE POLICY "staff_insert_admin" ON staff
  FOR INSERT WITH CHECK (
    auth_staff_role() = 'Admin'
  );

CREATE POLICY "staff_update" ON staff
  FOR UPDATE USING (
    -- Own row (cannot self-escalate role — enforced at application layer)
    auth_user_id = auth.uid()
    OR
    auth_staff_role() IN ('Admin', 'HR')
  );

CREATE POLICY "staff_delete_admin" ON staff
  FOR DELETE USING (
    auth_staff_role() = 'Admin'
  );

-- ── Verification ──────────────────────────────────────────────────────────────
-- After applying, run as the Admin user:
--   SELECT * FROM staff LIMIT 5;
-- Should return rows (not empty). If empty, check auth_staff_role() returns
-- a non-null value for your session.
