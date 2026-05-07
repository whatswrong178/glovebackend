-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 037: Create monthly_payouts table
--
-- fn_pl_summary (M023 / M034) references monthly_payouts in its total_payout
-- CTE, but the table was never created — causing:
--   ERROR: relation "monthly_payouts" does not exist
--
-- This table lets Admin manually record approximate monthly staff payouts
-- (salary + commissions) so P&L can compute net_company_profit.
-- If no rows exist for a period, approx_payout defaults to 0 (P&L still works).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS monthly_payouts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  year         INTEGER     NOT NULL,
  month        INTEGER     NOT NULL CHECK (month BETWEEN 1 AND 12),
  staff_id     UUID        REFERENCES staff(id) ON DELETE SET NULL,
  total_payout NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_payout >= 0),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (year, month, staff_id)  -- one row per staff per month
);

-- Index for the WHERE year = ? AND month = ? lookup in fn_pl_summary
CREATE INDEX IF NOT EXISTS idx_monthly_payouts_year_month
  ON monthly_payouts (year, month);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE monthly_payouts ENABLE ROW LEVEL SECURITY;

-- Only Admin can read
CREATE POLICY "monthly_payouts_select_admin"
  ON monthly_payouts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  );

-- Only Admin can insert / update / delete
CREATE POLICY "monthly_payouts_write_admin"
  ON monthly_payouts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  );

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT * FROM monthly_payouts LIMIT 5;
-- SELECT fn_pl_summary(2026, 5);   -- should return without error; approx_payout = 0
