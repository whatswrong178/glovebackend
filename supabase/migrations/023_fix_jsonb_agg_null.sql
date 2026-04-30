-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 023 — Fix jsonb_agg NULL on empty result sets
--
-- Root cause: Postgres's jsonb_agg() returns NULL (not []) when aggregating
-- over an empty set. Three RPCs were affected:
--   • fn_ar_aging()         → buckets = NULL when no Active invoices
--   • fn_org_tree()         → nodes   = NULL when no Active staff
--   • fn_pl_summary(y, m)  → top_skus / supplier_spend = NULL when no Paid invoices
--
-- Fix: wrap every jsonb_agg() call in COALESCE(..., '[]'::jsonb) so the
-- frontend always receives an array, never null.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. fn_ar_aging — buckets array + per-bucket invoices array
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_ar_aging()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER STABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM staff WHERE id = auth.uid();
  IF v_role NOT IN ('Admin', 'HR', 'Finance') THEN
    RAISE EXCEPTION 'Access denied: AR Aging requires Admin, HR, or Finance role.';
  END IF;

  RETURN (
    WITH credit_days AS (
      SELECT
        i.id,
        i.invoice_no,
        i.client_id,
        c.name  AS client_name,
        i.total_amount,
        i.created_at,
        CASE c.credit_terms
          WHEN 'Cash Term' THEN 0
          WHEN '30 Days'   THEN 30
          WHEN '60 Days'   THEN 60
          WHEN '90 Days'   THEN 90
          ELSE 0
        END AS credit_days,
        i.created_by,
        s.name AS sales_name
      FROM invoices i
      JOIN clients  c ON c.id = i.client_id
      JOIN staff    s ON s.id = i.created_by
      WHERE i.status = 'Active'
    ),
    bucketed AS (
      SELECT
        id, invoice_no, client_id, client_name, total_amount, created_at, sales_name,
        credit_days,
        (CURRENT_DATE - (created_at::DATE + credit_days)) AS overdue_days
      FROM credit_days
    ),
    with_bucket AS (
      SELECT
        *,
        CASE
          WHEN overdue_days < 0   THEN 'Current'
          WHEN overdue_days <= 30 THEN '1-30 Days Overdue'
          WHEN overdue_days <= 60 THEN '31-60 Days Overdue'
          WHEN overdue_days <= 90 THEN '61-90 Days Overdue'
          ELSE                         '90+ Days Overdue'
        END AS bucket
      FROM bucketed
    )
    SELECT jsonb_build_object(
      'generated_at', NOW(),
      'buckets', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'bucket',        bucket_name,
            'count',         invoice_count,
            'total_amount',  ROUND(bucket_total, 2),
            'invoices',      COALESCE(invoice_list, '[]'::jsonb)
          )
          ORDER BY bucket_order
        ),
        '[]'::jsonb
      )
    )
    FROM (
      SELECT
        bucket AS bucket_name,
        COUNT(*) AS invoice_count,
        SUM(total_amount) AS bucket_total,
        CASE bucket
          WHEN 'Current'           THEN 0
          WHEN '1-30 Days Overdue' THEN 1
          WHEN '31-60 Days Overdue'THEN 2
          WHEN '61-90 Days Overdue'THEN 3
          ELSE                          4
        END AS bucket_order,
        jsonb_agg(
          jsonb_build_object(
            'id',           id,
            'invoice_no',   invoice_no,
            'client_name',  client_name,
            'sales_name',   sales_name,
            'total_amount', ROUND(total_amount, 2),
            'created_at',   created_at,
            'overdue_days', overdue_days
          )
          ORDER BY overdue_days DESC
        ) AS invoice_list
      FROM with_bucket
      GROUP BY bucket, bucket_order
    ) summary
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_ar_aging() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. fn_org_tree — nodes array
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_org_tree()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER STABLE
AS $$
DECLARE
  v_role  TEXT;
  v_year  INT := EXTRACT(YEAR  FROM CURRENT_DATE);
  v_month INT := EXTRACT(MONTH FROM CURRENT_DATE);
BEGIN
  SELECT role INTO v_role FROM staff WHERE id = auth.uid();
  IF v_role NOT IN ('Admin', 'HR') THEN
    RAISE EXCEPTION 'Access denied: Org Tree requires Admin or HR role.';
  END IF;

  RETURN (
    WITH RECURSIVE
    monthly_rev AS (
      SELECT
        i.created_by AS staff_id,
        SUM(i.total_amount) AS net_revenue
      FROM invoices i
      WHERE i.status = 'Paid'
        AND EXTRACT(YEAR  FROM i.paid_at) = v_year
        AND EXTRACT(MONTH FROM i.paid_at) = v_month
      GROUP BY i.created_by
    ),
    nodes AS (
      SELECT
        s.id,
        s.name               AS full_name,
        s.role,
        s.leader_id          AS reports_to,
        s.leader_frozen,
        s.consecutive_fail_months,
        s.leader_exemption,
        COALESCE(r.net_revenue, 0) AS personal_net_revenue,
        CASE s.role
          WHEN 'Leader' THEN
            CASE
              WHEN s.leader_frozen THEN 'frozen'
              WHEN COALESCE(r.net_revenue, 0) >= (
                CASE WHEN s.leader_exemption THEN 35000 ELSE 50000 END
              ) THEN 'healthy'
              WHEN COALESCE(r.net_revenue, 0) >= (
                CASE WHEN s.leader_exemption THEN 17500 ELSE 25000 END
              ) THEN 'warning'
              ELSE 'danger'
            END
          ELSE 'n/a'
        END AS leader_status
      FROM staff s
      LEFT JOIN monthly_rev r ON r.staff_id = s.id
      WHERE s.status = 'Active'
    ),
    tree AS (
      SELECT
        n.id, n.full_name, n.role, n.reports_to,
        n.leader_frozen, n.consecutive_fail_months,
        n.personal_net_revenue, n.leader_status,
        0 AS depth,
        ARRAY[n.id] AS path
      FROM nodes n
      WHERE n.reports_to IS NULL

      UNION ALL

      SELECT
        n.id, n.full_name, n.role, n.reports_to,
        n.leader_frozen, n.consecutive_fail_months,
        n.personal_net_revenue, n.leader_status,
        t.depth + 1,
        t.path || n.id
      FROM nodes n
      JOIN tree t ON t.id = n.reports_to
      WHERE NOT (n.id = ANY(t.path))
    )
    SELECT jsonb_build_object(
      'generated_at', NOW(),
      'year',         v_year,
      'month',        v_month,
      'nodes', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',                      id,
            'full_name',               full_name,
            'role',                    role,
            'reports_to',              reports_to,
            'leader_frozen',           leader_frozen,
            'consecutive_fail_months', consecutive_fail_months,
            'personal_net_revenue',    ROUND(personal_net_revenue, 2),
            'leader_status',           leader_status,
            'depth',                   depth
          )
          ORDER BY depth, full_name
        ),
        '[]'::jsonb
      )
    )
    FROM tree
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_org_tree() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. fn_pl_summary — top_skus + supplier_spend arrays
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_pl_summary(p_year INT, p_month INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER STABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM staff WHERE id = auth.uid();
  IF v_role NOT IN ('Admin') THEN
    RAISE EXCEPTION 'Access denied: P&L requires Admin role.';
  END IF;

  RETURN (
    WITH
    paid_items AS (
      SELECT
        ii.product_id,
        ii.qty,
        ii.selling_price,
        ii.cost_price_snapshot,
        ii.qty * ii.selling_price       AS revenue,
        ii.qty * ii.cost_price_snapshot AS cogs,
        inv.supplier_id
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE inv.status = 'Paid'
        AND EXTRACT(YEAR  FROM inv.paid_at) = p_year
        AND EXTRACT(MONTH FROM inv.paid_at) = p_month
    ),
    financials AS (
      SELECT
        COALESCE(SUM(revenue), 0) AS gross_revenue,
        COALESCE(SUM(cogs),    0) AS total_cogs
      FROM paid_items
    ),
    total_payout AS (
      SELECT COALESCE(SUM(total_payout), 0) AS approx_payout
      FROM monthly_payouts
      WHERE year = p_year AND month = p_month
    ),
    top_skus AS (
      SELECT
        p.sku,
        p.name AS product_name,
        SUM(pi.qty)     AS total_qty,
        SUM(pi.revenue) AS revenue,
        SUM(pi.cogs)    AS cogs
      FROM paid_items pi
      JOIN products p ON p.id = pi.product_id
      GROUP BY p.sku, p.name
      ORDER BY revenue DESC
      LIMIT 10
    ),
    supplier_spend AS (
      SELECT
        COALESCE(sup.name, 'Unknown') AS supplier_name,
        SUM(pi.cogs)  AS spend,
        SUM(pi.qty)   AS total_boxes
      FROM paid_items pi
      JOIN products p ON p.id = pi.product_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      GROUP BY supplier_name
      ORDER BY spend DESC
    )
    SELECT jsonb_build_object(
      'year',               p_year,
      'month',              p_month,
      'gross_revenue',      ROUND(f.gross_revenue,                                      2),
      'total_cogs',         ROUND(f.total_cogs,                                         2),
      'gross_profit',       ROUND(f.gross_revenue - f.total_cogs,                       2),
      'approx_payout',      ROUND(tp.approx_payout,                                     2),
      'net_company_profit', ROUND(f.gross_revenue - f.total_cogs - tp.approx_payout,    2),
      'gross_margin_pct',   ROUND(
                              CASE WHEN f.gross_revenue > 0
                                   THEN (f.gross_revenue - f.total_cogs) / f.gross_revenue * 100
                                   ELSE 0 END, 2),
      'top_skus', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'sku', sku, 'name', product_name,
          'qty', total_qty, 'revenue', ROUND(revenue, 2), 'cogs', ROUND(cogs, 2)
        )) FROM top_skus),
        '[]'::jsonb
      ),
      'supplier_spend', COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'supplier', supplier_name,
          'spend',    ROUND(spend, 2),
          'boxes',    total_boxes
        )) FROM supplier_spend),
        '[]'::jsonb
      )
    )
    FROM financials f, total_payout tp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_pl_summary(INT, INT) TO authenticated;
