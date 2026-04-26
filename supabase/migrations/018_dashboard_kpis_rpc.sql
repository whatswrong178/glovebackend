-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 018: get_dashboard_kpis() — real-time KPI tiles for Dashboard
-- MediGlove ERP · EPIC-08
--
-- Returns 4 KPIs for the calling staff member:
--   active_invoices  — count of Active invoices (scoped by role)
--   est_commission   — estimated commission from Active invoices
--   actual_commission— commission from Paid invoices in current calendar month
--   public_pool      — count of orphan clients available to claim
--
-- Commission formula (per line item):
--   qty × selling_price × rate
--   where rate = 0.20 if product.category='A', 0.15 if category='B'
--
-- Role scoping:
--   Admin / HR → see ALL invoices
--   Leader / Sales / Logistics → see own invoices (created_by = caller)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_dashboard_kpis()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id         UUID   := auth_staff_id();
  v_role              TEXT   := auth_staff_role();
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

  -- ── Est. commission (Active invoices) ────────────────────────────────────────
  SELECT COALESCE(SUM(
    ii.qty::NUMERIC
    * ii.selling_price
    * CASE p.category WHEN 'A' THEN 0.20 WHEN 'B' THEN 0.15 ELSE 0.15 END
  ), 0) INTO v_est_commission
  FROM invoices i
  JOIN invoice_items ii ON ii.invoice_id = i.id
  JOIN products p        ON p.id = ii.product_id
  WHERE i.status = 'Active'
    AND (v_see_all OR i.created_by = v_caller_id);

  -- ── Actual commission (Paid invoices — current calendar month) ───────────────
  SELECT COALESCE(SUM(
    ii.qty::NUMERIC
    * ii.selling_price
    * CASE p.category WHEN 'A' THEN 0.20 WHEN 'B' THEN 0.15 ELSE 0.15 END
  ), 0) INTO v_actual_commission
  FROM invoices i
  JOIN invoice_items ii ON ii.invoice_id = i.id
  JOIN products p        ON p.id = ii.product_id
  WHERE i.status = 'Paid'
    AND DATE_TRUNC('month', i.paid_at)  = DATE_TRUNC('month', NOW())
    AND (v_see_all OR i.created_by = v_caller_id);

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
