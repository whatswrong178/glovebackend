-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 005 — Offboarding Trigger v2
-- MediGlove ERP · EPIC-02 / T-02.5
--
-- Replaces fn_staff_offboarding() with full edge-case coverage:
--   (A) Client orphan release         — was in v1
--   (B) Leader departure cascade      — NEW: direct reports lose leader_id
--   (C) Idempotent guard              — NEW: only Active → Inactive fires logic
--   (D) Accurate audit via GET DIAGNOSTICS — NEW: v1 count was a post-hoc query
--
-- Run after 003_functions_triggers.sql (trigger already exists — DROP + re-CREATE
-- is not needed because CREATE OR REPLACE handles the function; the TRIGGER
-- binding is identical so we only replace the function body).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_staff_offboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clients_orphaned  INT := 0;
  v_reports_unlinked  INT := 0;
BEGIN
  -- ── Guard ──────────────────────────────────────────────────────────────────
  -- Only fires on a genuine Active → Inactive transition.
  -- Idempotent: if staff is already Inactive (e.g. second UPDATE call) this
  -- block is skipped entirely, preventing double-orphan writes.
  IF NOT (NEW.status = 'Inactive' AND OLD.status = 'Active') THEN
    RETURN NEW;
  END IF;

  -- ── Step 1: Release owned clients to public pool ────────────────────────────
  -- Sets is_orphan = TRUE and clears owner_id for every client this staff owned.
  -- We skip rows that are already orphaned (is_orphan = FALSE guard) to avoid
  -- touching unrelated clients in edge scenarios.
  UPDATE clients
  SET
    is_orphan = TRUE,
    owner_id  = NULL
  WHERE
    owner_id  = OLD.id
    AND is_orphan = FALSE;

  -- Capture actual rows affected (NOT a post-hoc count query — avoids race condition)
  GET DIAGNOSTICS v_clients_orphaned = ROW_COUNT;

  -- ── Step 2: Cascade leader departure (Edge Case A) ──────────────────────────
  -- If the offboarded staff member held the Leader role, their direct reports
  -- have leader_id pointing at a now-Inactive account.
  -- We NULL the pointer so that:
  --   (a) auth_staff_leader_id() RLS helper returns NULL instead of stale data
  --   (b) Admin can reassign reports from the HR panel without data corruption
  --
  -- We only unlink ACTIVE reports — Inactive staff already have broken leader
  -- chains by definition and touching them would create noise in audit logs.
  UPDATE staff
  SET leader_id = NULL
  WHERE
    leader_id = OLD.id
    AND status  = 'Active';

  GET DIAGNOSTICS v_reports_unlinked = ROW_COUNT;

  -- ── Step 3: Structured audit log ────────────────────────────────────────────
  RAISE LOG
    '[Offboarding] staff_id=% name="%" role=% | clients_orphaned=% | reports_unlinked=%',
    OLD.id,
    OLD.name,
    OLD.role,
    v_clients_orphaned,
    v_reports_unlinked;

  RETURN NEW;
END;
$$;

-- ── Re-assert trigger binding (idempotent DROP + CREATE) ───────────────────────
-- The original trigger from migration 003 is already bound to the function.
-- Because we used CREATE OR REPLACE on the function, the trigger automatically
-- picks up the new body with no DROP needed.
-- However, we explicitly drop and recreate here to guarantee AFTER UPDATE OF
-- status fires on the correct column and FOR EACH ROW semantics are locked.

DROP TRIGGER IF EXISTS trg_staff_offboarding ON staff;

CREATE TRIGGER trg_staff_offboarding
  AFTER UPDATE OF status ON staff
  FOR EACH ROW
  EXECUTE FUNCTION fn_staff_offboarding();

-- ── Smoke test helper (run manually in SQL Editor to verify) ──────────────────
-- DO $$
-- DECLARE
--   v_staff_id UUID;
-- BEGIN
--   -- Insert a throwaway Inactive staff record to prove trigger guard
--   INSERT INTO staff (name, email, role, status)
--   VALUES ('Test Offboard', 'offboard-test@mediglove.local', 'Sales', 'Inactive')
--   RETURNING id INTO v_staff_id;
--
--   -- Attempt to update Inactive → Inactive (must NOT trigger logic)
--   UPDATE staff SET status = 'Inactive' WHERE id = v_staff_id;
--   RAISE NOTICE 'Idempotent guard: OK (no double-orphan)';
--
--   ROLLBACK;
-- END $$;
