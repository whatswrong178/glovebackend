-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 019: Allow Sales role to submit Sample DO requests
-- MediGlove ERP · EPIC-05
--
-- Problem: create_sample_do() in migration 003 only permits Admin/HR/Leader.
--          The frontend canRequestSample flag was already fixed (session prior)
--          but the DB-level permission check still blocks Sales → hard error.
--
-- Fix: Replace the function body with an updated permission guard that
--      includes 'Sales'. All other logic is unchanged.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_sample_do(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth_staff_id();
  v_role      TEXT := auth_staff_role();
  v_client    clients%ROWTYPE;
  v_do_id     UUID := gen_random_uuid();
  v_do_no     TEXT;
BEGIN
  -- Permission check: Admin, HR, Leader, Sales can request samples
  IF v_role NOT IN ('Admin', 'HR', 'Leader', 'Sales') THEN
    RAISE EXCEPTION 'Permission denied: only Admin, HR, Leader or Sales can request samples.';
  END IF;

  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found: %', p_client_id;
  END IF;

  v_do_no := generate_do_no('Sample');

  INSERT INTO delivery_orders
    (id, do_no, type, invoice_id, client_id, created_by, status)
  VALUES
    (v_do_id, v_do_no, 'Sample', NULL, p_client_id, v_caller_id, 'Pending');

  RETURN jsonb_build_object('do_id', v_do_id, 'do_no', v_do_no);
END;
$$;

GRANT EXECUTE ON FUNCTION create_sample_do(UUID) TO authenticated;
