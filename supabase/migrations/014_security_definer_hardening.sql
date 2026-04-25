-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 014: SECURITY DEFINER Hardening (GSEC-01 / GSEC-02)
--
-- Findings from Test Report 2026-04-25:
--
--   GSEC-01 (🟠 High): SECURITY DEFINER functions in 003/006/008/011/012 have
--     no explicit EXECUTE grant restrictions beyond the default PUBLIC grant.
--     Any authenticated role can call any RPC, including admin-only ones whose
--     role guard relies solely on the function body (RAISE EXCEPTION). Defence-
--     in-depth requires REVOKE + explicit GRANT at the DB level.
--
--   GSEC-02 (🟡 Medium): SECURITY DEFINER functions without a fixed search_path
--     are vulnerable to schema hijacking — an attacker who can create objects in
--     a non-public schema can shadow built-in functions called inside the RPC.
--     Fix: SET search_path = public, pg_temp on every SECURITY DEFINER function.
--
-- Strategy:
--   Auto-discover every SECURITY DEFINER function in schema `public` via
--   pg_proc, then apply REVOKE/GRANT/ALTER in a single DO block.
--   No hardcoded signatures — immune to 42883 if a function is missing.
--
-- Internal-only functions (get_system_param_numeric) get search_path hardening
-- but no GRANT to authenticated — the DO block skips them explicitly.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 + 2 combined: auto-discover → REVOKE PUBLIC → GRANT authenticated
--                      → ALTER search_path
--
-- Internal helpers that must NOT be callable by authenticated:
--   get_system_param_numeric
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r           RECORD;
  v_sig       TEXT;
  -- Functions that should NOT receive a GRANT to authenticated
  v_internal  TEXT[] := ARRAY['get_system_param_numeric'];
BEGIN
  FOR r IN
    SELECT
      p.proname                                                        AS fname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)            AS fargs
    FROM   pg_proc      p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname  = 'public'
      AND  p.prosecdef = TRUE        -- SECURITY DEFINER only
    ORDER BY p.proname
  LOOP
    v_sig := format('%I(%s)', r.fname, r.fargs);

    -- GSEC-01: strip PUBLIC execute
    EXECUTE 'REVOKE ALL ON FUNCTION ' || v_sig || ' FROM PUBLIC';

    -- GSEC-01: re-grant to authenticated (skip internal helpers)
    IF NOT (r.fname = ANY(v_internal)) THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || v_sig || ' TO authenticated';
    END IF;

    -- GSEC-02: fix search_path
    EXECUTE 'ALTER FUNCTION ' || v_sig || ' SET search_path = public, pg_temp';

    RAISE NOTICE 'Hardened: %', v_sig;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run manually to audit):
--
--   SELECT proname,
--          prosecdef,
--          proconfig,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_can_exec,
--          has_function_privilege('anon',          oid, 'EXECUTE') AS anon_can_exec
--   FROM   pg_proc
--   JOIN   pg_namespace n ON n.oid = pronamespace
--   WHERE  n.nspname  = 'public'
--     AND  prosecdef  = TRUE
--   ORDER BY proname;
--
--   Expected:
--     prosecdef   = true  for all rows
--     proconfig   contains 'search_path=public, pg_temp'
--     auth_can_exec = true   (except get_system_param_numeric → false)
--     anon_can_exec = false  for all rows
-- ─────────────────────────────────────────────────────────────────────────────
