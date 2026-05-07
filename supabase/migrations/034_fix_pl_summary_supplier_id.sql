-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 034: Fix fn_pl_summary — remove stale inv.supplier_id reference
--
-- Bug: fn_pl_summary (M023) selects inv.supplier_id in the paid_items CTE,
-- but invoices.supplier_id does not exist. Supplier is on products.supplier_id.
-- The column was also unused — supplier_spend CTE joins products → suppliers
-- directly via p.supplier_id. Safe to drop with zero logic change.
-- ══════════════════════════════════════════════════════════════════════════════

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
        ii.qty::NUMERIC * ii.selling_price       AS revenue,
        ii.qty::NUMERIC * ii.cost_price_snapshot AS cogs
        -- inv.supplier_id removed: invoices has no supplier_id column.
        -- supplier_spend CTE joins products → suppliers directly.
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
      JOIN products p   ON p.id   = pi.product_id
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
