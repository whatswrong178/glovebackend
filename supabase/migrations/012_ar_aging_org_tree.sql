-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 012: AR Aging + Org Tree RPCs (EPIC-08 / T-08.2, T-08.4)
--
-- Functions:
--   fn_ar_aging()
--     → Scans all status='Active' invoices. Buckets by overdue days relative
--       to credit_terms. Returns JSONB array: {bucket, count, total_amount, invoices[]}.
--
--   fn_org_tree()
--     → Recursive CTE traversal of staff.reports_to. Returns nested JSONB tree
--       for org chart rendering. Includes: id, full_name, role, leader_frozen,
--       consecutive_fail_months, personal_net_revenue_this_month, team_size.
--
--   fn_pl_summary(p_year INT, p_month INT)
--     → P&L summary for a given month. Returns JSONB:
--       {gross_revenue, total_cogs, gross_profit, total_payout, net_company_profit,
--        top_skus[], supplier_spend[]}.
--
-- All functions: SECURITY DEFINER, Admin/HR only.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_ar_aging
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_ar_aging()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER STABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Role guard
  SELECT role INTO v_role FROM staff WHERE id = auth.uid();
  IF v_role NOT IN ('Admin', 'HR', 'Finance') THEN
    RAISE EXCEPTION 'Access denied: AR Aging requires Admin, HR, or Finance role.';
  END IF;

  RETURN (
    WITH credit_days AS (
      -- Map credit_terms string to integer days
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
      'buckets', jsonb_agg(
        jsonb_build_object(
          'bucket',        bucket_name,
          'count',         invoice_count,
          'total_amount',  ROUND(bucket_total, 2),
          'invoices',      invoice_list
        )
        ORDER BY bucket_order
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
-- fn_org_tree
-- Returns recursive staff hierarchy as nested JSONB.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_org_tree()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER STABLE
AS $$
DECLARE
  v_role       TEXT;
  v_year       INT  := EXTRACT(YEAR  FROM CURRENT_DATE);
  v_month      INT  := EXTRACT(MONTH FROM CURRENT_DATE);
BEGIN
  SELECT role INTO v_role FROM staff WHERE id = auth.uid();
  IF v_role NOT IN ('Admin', 'HR') THEN
    RAISE EXCEPTION 'Access denied: Org Tree requires Admin or HR role.';
  END IF;

  RETURN (
    WITH RECURSIVE
    -- Personal revenue this month (Paid invoices)
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
    -- Annotated staff nodes
    nodes AS (
      SELECT
        s.id,
        s.name               AS full_name,   -- staff.name; aliased for downstream CTEs
        s.role,
        s.leader_id          AS reports_to,  -- staff.leader_id; aliased for recursive join
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
    -- Recursive tree build
    tree AS (
      -- Root nodes (no reports_to = top level or Admin)
      SELECT
        n.id,
        n.full_name,
        n.role,
        n.reports_to,
        n.leader_frozen,
        n.consecutive_fail_months,
        n.personal_net_revenue,
        n.leader_status,
        0 AS depth,
        ARRAY[n.id] AS path
      FROM nodes n
      WHERE n.reports_to IS NULL

      UNION ALL

      SELECT
        n.id,
        n.full_name,
        n.role,
        n.reports_to,
        n.leader_frozen,
        n.consecutive_fail_months,
        n.personal_net_revenue,
        n.leader_status,
        t.depth + 1,
        t.path || n.id
      FROM nodes n
      JOIN tree t ON t.id = n.reports_to
      WHERE NOT (n.id = ANY(t.path))  -- cycle guard
    )
    -- Aggregate flat tree into JSONB (caller renders hierarchy using reports_to)
    SELECT jsonb_build_object(
      'generated_at', NOW(),
      'year',         v_year,
      'month',        v_month,
      'nodes', jsonb_agg(
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
      )
    )
    FROM tree
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_org_tree() TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- fn_pl_summary
-- P&L for a given year/month. Admin only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_pl_summary(
  p_year  INT,
  p_month INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER STABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM staff WHERE id = auth.uid();
  IF v_role <> 'Admin' THEN
    RAISE EXCEPTION 'Access denied: P&L summary requires Admin role.';
  END IF;

  RETURN (
    WITH paid_invoices AS (
      SELECT i.id, i.total_amount, i.discount, i.created_at, i.paid_at
      FROM invoices i
      WHERE i.status = 'Paid'
        AND EXTRACT(YEAR  FROM i.paid_at) = p_year
        AND EXTRACT(MONTH FROM i.paid_at) = p_month
    ),
    line_items AS (
      SELECT
        il.invoice_id,
        il.qty,
        il.selling_price,
        p.cost_price,
        p.category,
        p.supplier_id,
        sup.name AS supplier_name,
        p.name   AS product_name,
        p.sku
      FROM invoice_line_items il
      JOIN paid_invoices pi ON pi.id = il.invoice_id
      JOIN products      p  ON p.id  = il.product_id
      JOIN suppliers     sup ON sup.id = p.supplier_id
    ),
    financials AS (
      SELECT
        SUM(selling_price * qty)  AS gross_revenue,
        SUM(cost_price    * qty)  AS total_cogs
      FROM line_items
    ),
    -- Top 10 SKUs by revenue
    top_skus AS (
      SELECT
        sku,
        product_name,
        SUM(qty)              AS total_qty,
        SUM(selling_price * qty) AS revenue,
        SUM(cost_price    * qty) AS cogs
      FROM line_items
      GROUP BY sku, product_name
      ORDER BY revenue DESC
      LIMIT 10
    ),
    -- Supplier spend
    supplier_spend AS (
      SELECT
        supplier_name,
        SUM(cost_price * qty) AS spend,
        SUM(qty)              AS total_boxes
      FROM line_items
      GROUP BY supplier_name
      ORDER BY spend DESC
    ),
    -- Total payout from all staff this month
    total_payout AS (
      SELECT COALESCE(SUM(
        -- Approximate: sum of (base_comm + kam_comm) from line items
        -- Full payout requires fn_calculate_monthly_payout per staff.
        -- Using GP × avg_rate as proxy for P&L summary.
        GREATEST(0, (il2.selling_price - p2.cost_price)) * il2.qty *
        CASE p2.category WHEN 'A' THEN 0.25 ELSE 0.18 END
      ), 0) AS approx_payout
      FROM invoice_line_items il2
      JOIN paid_invoices pi2 ON pi2.id = il2.invoice_id
      JOIN products p2        ON p2.id  = il2.product_id
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
      'top_skus', (
        SELECT jsonb_agg(jsonb_build_object(
          'sku', sku, 'name', product_name,
          'qty', total_qty, 'revenue', ROUND(revenue, 2), 'cogs', ROUND(cogs, 2)
        ))
        FROM top_skus
      ),
      'supplier_spend', (
        SELECT jsonb_agg(jsonb_build_object(
          'supplier', supplier_name,
          'spend',    ROUND(spend, 2),
          'boxes',    total_boxes
        ))
        FROM supplier_spend
      )
    )
    FROM financials f, total_payout tp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_pl_summary(INT, INT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- snapshots table (T-08.1 — monthly payout snapshots, immutable)
--
-- Migration 001 defined snapshots with a minimal schema (snapshot_month INT,
-- snapshot_year INT, data JSONB). This migration evolves it to the EPIC-06
-- per-staff design via idempotent ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS year         INT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS month        INT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS staff_id     UUID REFERENCES staff(id) ON DELETE RESTRICT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS payload      JSONB;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS created_by   TEXT NOT NULL DEFAULT 'make.com';

-- Drop the old snapshot_month/snapshot_year unique constraint from Migration 001.
ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_snapshot_month_snapshot_year_key;

CREATE UNIQUE INDEX IF NOT EXISTS snapshots_staff_month_uniq
  ON snapshots (staff_id, year, month);

COMMENT ON TABLE snapshots IS 'Immutable monthly payout snapshots. Never UPDATE or DELETE.';

-- Immutability guard: block UPDATE and DELETE
CREATE OR REPLACE RULE snapshots_no_update AS
  ON UPDATE TO snapshots DO INSTEAD NOTHING;

CREATE OR REPLACE RULE snapshots_no_delete AS
  ON DELETE TO snapshots DO INSTEAD NOTHING;

ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY snapshots_admin_read ON snapshots
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  );

CREATE POLICY snapshots_insert_any ON snapshots
  FOR INSERT TO authenticated
  WITH CHECK (TRUE);  -- Insert allowed; immutability enforced by RULEs

