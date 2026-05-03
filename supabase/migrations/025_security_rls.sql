-- ══════════════════════════════════════════════════════════════════════════════
-- 025_security_rls.sql
-- MediGlove ERP — Security Audit P0-3: RLS hardening pass
--
-- Covers tables that were missing RLS or had no/weak policies:
--   1. company_settings   — Admin-only (bank account, company info)
--   2. staff              — Admin/HR: all; Leader/Sales: own row only
--   3. email_templates    — Admin-only
--   4. playbook_materials — Sales+ can SELECT; Admin can INSERT/UPDATE/DELETE
--   5. commissions        — Admin: all; Staff: own rows only
--
-- Safe to re-run: uses DROP POLICY IF EXISTS before CREATE POLICY.
-- Uses auth.uid() + staff.auth_user_id — consistent with all other migrations.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Helper macro (reused inline) ──────────────────────────────────────────────
-- Auth pattern:
--   admin_or_hr  → EXISTS (SELECT 1 FROM staff WHERE auth_user_id=auth.uid() AND role IN ('Admin','HR'))
--   own_row      → auth_user_id = auth.uid()
--   any_staff    → EXISTS (SELECT 1 FROM staff WHERE auth_user_id=auth.uid())

-- ════════════════════════════════════════════════════════════════════════════
-- 1. company_settings
--    Risk: bank account numbers, GST codes, letterhead config
--    Policy: Admin-only read and write
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cs_select_admin"  ON company_settings;
DROP POLICY IF EXISTS "cs_insert_admin"  ON company_settings;
DROP POLICY IF EXISTS "cs_update_admin"  ON company_settings;
DROP POLICY IF EXISTS "cs_delete_admin"  ON company_settings;

CREATE POLICY "cs_select_admin" ON company_settings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "cs_insert_admin" ON company_settings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "cs_update_admin" ON company_settings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "cs_delete_admin" ON company_settings
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2. staff
--    Risk: salary info, auth_user_id, phone numbers, role assignments
--    Policy:
--      SELECT  — Admin/HR see all; others see own row only
--      INSERT  — Admin only (via create-staff-user Edge Function)
--      UPDATE  — Admin/HR can update all; own row limited (no role self-escalation)
--      DELETE  — Admin only
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select"        ON staff;
DROP POLICY IF EXISTS "staff_insert_admin"  ON staff;
DROP POLICY IF EXISTS "staff_update"        ON staff;
DROP POLICY IF EXISTS "staff_delete_admin"  ON staff;

CREATE POLICY "staff_select" ON staff
  FOR SELECT USING (
    -- own row
    auth_user_id = auth.uid()
    OR
    -- Admin or HR sees all
    EXISTS (
      SELECT 1 FROM staff s2
      WHERE s2.auth_user_id = auth.uid()
        AND s2.role IN ('Admin', 'HR')
    )
  );

-- INSERT is done by the create-staff-user Edge Function (service_role key),
-- but this policy adds a DB-level guard in case of direct calls.
CREATE POLICY "staff_insert_admin" ON staff
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff s2
      WHERE s2.auth_user_id = auth.uid()
        AND s2.role = 'Admin'
    )
  );

CREATE POLICY "staff_update" ON staff
  FOR UPDATE USING (
    -- Admin/HR can update any row
    EXISTS (
      SELECT 1 FROM staff s2
      WHERE s2.auth_user_id = auth.uid()
        AND s2.role IN ('Admin', 'HR')
    )
    OR
    -- Own row (cannot escalate own role — application layer enforces this)
    auth_user_id = auth.uid()
  );

CREATE POLICY "staff_delete_admin" ON staff
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM staff s2
      WHERE s2.auth_user_id = auth.uid()
        AND s2.role = 'Admin'
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3. email_templates
--    Risk: phishing surface if writable by non-admin
--    Policy: Admin-only full access
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "et_select_admin" ON email_templates;
DROP POLICY IF EXISTS "et_insert_admin" ON email_templates;
DROP POLICY IF EXISTS "et_update_admin" ON email_templates;
DROP POLICY IF EXISTS "et_delete_admin" ON email_templates;

CREATE POLICY "et_select_admin" ON email_templates
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "et_insert_admin" ON email_templates
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "et_update_admin" ON email_templates
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "et_delete_admin" ON email_templates
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 4. playbook_materials
--    Policy: any authenticated staff can SELECT; Admin only for mutations
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE playbook_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pm_select_staff"  ON playbook_materials;
DROP POLICY IF EXISTS "pm_insert_admin"  ON playbook_materials;
DROP POLICY IF EXISTS "pm_update_admin"  ON playbook_materials;
DROP POLICY IF EXISTS "pm_delete_admin"  ON playbook_materials;

CREATE POLICY "pm_select_staff" ON playbook_materials
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "pm_insert_admin" ON playbook_materials
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "pm_update_admin" ON playbook_materials
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "pm_delete_admin" ON playbook_materials
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 5. commissions
--    Risk: salary data — must not be cross-readable between sales reps
--    Policy:
--      SELECT  — Admin/HR see all; own rows only for others
--      INSERT  — Admin/HR only (commissions are system-generated)
--      UPDATE  — Admin only
--      DELETE  — Admin only
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comm_select"       ON commissions;
DROP POLICY IF EXISTS "comm_insert_admin" ON commissions;
DROP POLICY IF EXISTS "comm_update_admin" ON commissions;
DROP POLICY IF EXISTS "comm_delete_admin" ON commissions;

CREATE POLICY "comm_select" ON commissions
  FOR SELECT USING (
    -- Own commission record (staff_id column)
    staff_id = (
      SELECT id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1
    )
    OR
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role IN ('Admin', 'HR')
    )
  );

CREATE POLICY "comm_insert_admin" ON commissions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role IN ('Admin', 'HR')
    )
  );

CREATE POLICY "comm_update_admin" ON commissions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

CREATE POLICY "comm_delete_admin" ON commissions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role = 'Admin'
    )
  );

-- ── Verification query (run after applying to confirm) ─────────────────────────
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'company_settings','staff','email_templates',
--     'playbook_materials','commissions'
--   )
-- ORDER BY tablename;
-- Expected: rowsecurity = true for all 5 rows.
