-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 021: Fix get_dashboard_kpis() — read from commissions table
-- MediGlove ERP
--
-- Bug fixed: Migration 018 calculated est/actual commission directly from
-- invoice_items using qty × selling_price × rate (revenue-based).
-- This incorrectly:
--   (a) Skipped cost_price deduction (not GP-based)
--   (b) Ignored KAM bonus rows in commissions table
--   (c) Ignored tug-of-war commission splits (wrong staff_id scoping)
--
-- Fix: Both est_commission and actual_commission now read directly from the
-- commissions table, which is written by compute_base_commission() and
-- correctly contains GP × rate + KAM + split-adjusted amounts per staff.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_dashboard_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id         UUID    := auth_staff_id();
  v_role              TEXT    := auth_staff_role();
  v_see_all           BOOLEAN;
  v_active_count      INTEGER := 0;
  v_est_commission    NUMERIC := 0;
  v_actual_commission NUMERIC := 0;
  v_public_pool       INTEGER := 0;
BEGIN
  v_see_all := (v_role IN ('Admin', 'HR'));

  -- ── Active invoice count ─────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_active_count
  FROM invoices
  WHERE status = 'Active'
    AND (v_see_all OR created_by = v_caller_id);

  -- ── Est. commission: sum Est rows from commissions table ─────────────────────
  -- Reads GP-based commission (including KAM bonus, split-adjusted) from the
  -- commissions table written by compute_base_commission().
  -- Admin/HR see all staff commissions; others see only their own.
  SELECT COALESCE(SUM(c.amount), 0) INTO v_est_commission
  FROM commissions c
  JOIN invoices i ON i.id = c.invoice_id
  WHERE c.status = 'Est'
    AND i.status  = 'Active'
    AND (v_see_all OR c.staff_id = v_caller_id);

  -- ── Actual commission: sum Actual rows — current calendar month ───────────────
  -- fn_unlock_commissions_on_paid() flips Est → Actual and stamps paid_at
  -- when HR marks invoice as Paid. This query reads those flipped rows.
  SELECT COALESCE(SUM(c.amount), 0) INTO v_actual_commission
  FROM commissions c
  JOIN invoices i ON i.id = c.invoice_id
  WHERE c.status = 'Actual'
    AND DATE_TRUNC('month', i.paid_at) = DATE_TRUNC('month', NOW())
    AND (v_see_all OR c.staff_id = v_caller_id);

  -- ── Public pool (orphan clients) ─────────────────────────────────────────────
  SELECT COUNT(*) INTO v_public_pool
  FROM clients
  WHERE is_orphan = TRUE;

  RETURN jsonb_build_object(
    'active_invoices',   v_active_count,
    'est_commission',    v_est_commission,
    'actual_commission', v_actual_commission,
    'public_pool',       v_public_pool
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_kpis() TO authenticated;
