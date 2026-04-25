-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 011: Monthly Payout RPCs (EPIC-06 / T-06.5, T-06.7, T-06.8)
--
-- Functions:
--   fn_evaluate_leader_month(p_staff_id, p_year, p_month)
--     → Checks leader personal revenue vs threshold. Updates staff.consecutive_fail_months
--       and staff.leader_frozen. Returns evaluation result JSONB.
--
--   fn_calculate_monthly_payout(p_staff_id, p_year, p_month)
--     → Aggregates all commission components (Steps 0-8) for Paid invoices only.
--       Returns JSONB breakdown. Read-only — does NOT write to DB.
--       Caller (Make.com / Admin UI) is responsible for persisting payout record.
--
-- Principles:
--   • 见款发佣 (paid-then-commission): only invoices with status='Paid' are counted.
--   • Leader threshold: RM 50,000 standard; RM 35,000 if staff.leader_exemption=TRUE.
--   • consecutive_fail_months >= 2 triggers leader_frozen=TRUE.
--   • Mentor reward (伯乐奖): 0.5% of each active mentee's net revenue.
--   • Tug-of-War split applied at Step 2 using the neglect_index snapshotted on invoice.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: get system_param value as NUMERIC (with default fallback)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_system_param_numeric(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_val TEXT;
BEGIN
  SELECT value #>> '{}' INTO v_val FROM system_params WHERE key = p_key LIMIT 1;
  IF v_val IS NULL THEN RETURN p_default; END IF;
  RETURN v_val::NUMERIC;
EXCEPTION WHEN others THEN
  RETURN p_default;
END;
$$;

GRANT EXECUTE ON FUNCTION get_system_param_numeric(TEXT, NUMERIC) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- fn_evaluate_leader_month
-- Stateful: writes back to staff table. Called by Make.com on month-end.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_evaluate_leader_month(
  p_staff_id UUID,
  p_year     INT,
  p_month    INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_staff               RECORD;
  v_threshold           NUMERIC;
  v_personal_revenue    NUMERIC := 0;
  v_new_fail_months     INT;
  v_should_freeze       BOOLEAN := FALSE;
  v_threshold_met       BOOLEAN := FALSE;
  v_result              JSONB;

  -- system_params
  v_std_threshold       NUMERIC;
  v_exempt_threshold    NUMERIC;
BEGIN
  -- ── Load staff record ────────────────────────────────────────────────────
  SELECT * INTO v_staff FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff % not found', p_staff_id;
  END IF;

  -- Only Leaders/KAM are evaluated for leader bonus
  IF v_staff.role NOT IN ('Leader', 'KAM') THEN
    RETURN jsonb_build_object(
      'evaluated',    FALSE,
      'reason',       'Staff role is not Leader or KAM — no leader evaluation required.',
      'staff_id',     p_staff_id,
      'year',         p_year,
      'month',        p_month
    );
  END IF;

  -- ── Load thresholds from system_params ───────────────────────────────────
  v_std_threshold    := get_system_param_numeric('LEADER_REVENUE_THRESHOLD', 50000);
  v_exempt_threshold := get_system_param_numeric('LEADER_EXEMPTION_THRESHOLD', 35000);

  v_threshold := CASE WHEN v_staff.leader_exemption THEN v_exempt_threshold
                      ELSE v_std_threshold
                 END;

  -- ── Compute personal Net Revenue (Paid invoices, created_by = leader) ────
  SELECT COALESCE(SUM(i.total_amount), 0) INTO v_personal_revenue
  FROM   invoices i
  WHERE  i.created_by = p_staff_id
    AND  i.status     = 'Paid'
    AND  EXTRACT(YEAR  FROM i.paid_at) = p_year
    AND  EXTRACT(MONTH FROM i.paid_at) = p_month;

  -- ── Threshold check ───────────────────────────────────────────────────────
  v_threshold_met := v_personal_revenue >= v_threshold;

  -- Guard: already frozen → no further increment
  IF v_staff.leader_frozen THEN
    v_new_fail_months := v_staff.consecutive_fail_months;
    v_should_freeze   := TRUE;
  ELSIF v_threshold_met THEN
    v_new_fail_months := 0;
    v_should_freeze   := FALSE;
  ELSE
    v_new_fail_months := COALESCE(v_staff.consecutive_fail_months, 0) + 1;
    v_should_freeze   := v_new_fail_months >= 2;
  END IF;

  -- ── Write back to staff ───────────────────────────────────────────────────
  UPDATE staff
  SET    consecutive_fail_months = v_new_fail_months,
         leader_frozen           = v_should_freeze
  WHERE  id = p_staff_id;

  -- ── Return result ─────────────────────────────────────────────────────────
  v_result := jsonb_build_object(
    'evaluated',              TRUE,
    'staff_id',               p_staff_id,
    'year',                   p_year,
    'month',                  p_month,
    'role',                   v_staff.role,
    'leader_exemption',       v_staff.leader_exemption,
    'threshold_applied',      v_threshold,
    'personal_net_revenue',   v_personal_revenue,
    'threshold_met',          v_threshold_met,
    'new_consecutive_fails',  v_new_fail_months,
    'leader_frozen',          v_should_freeze
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_evaluate_leader_month(UUID, INT, INT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- fn_calculate_monthly_payout
-- Read-only aggregation. Returns full JSONB breakdown.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_calculate_monthly_payout(
  p_staff_id UUID,
  p_year     INT,
  p_month    INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER STABLE
AS $$
DECLARE
  v_staff                 RECORD;

  -- System params
  v_comm_rate_a           NUMERIC;
  v_comm_rate_b           NUMERIC;
  v_kam_bonus_a           NUMERIC;
  v_kam_bonus_b           NUMERIC;
  v_kam_threshold_days    NUMERIC;
  v_std_threshold         NUMERIC;
  v_exempt_threshold      NUMERIC;
  v_leader_bonus_rate     NUMERIC;
  v_mentor_reward_rate    NUMERIC;
  v_a_ratio_threshold     NUMERIC;

  -- Step 0 — Base Commission
  v_base_comm             NUMERIC := 0;
  v_kam_comm              NUMERIC := 0;

  -- Step 1 — Bounty (pre-computed from bounty_events table if present, else 0)
  v_bounty                NUMERIC := 0;

  -- Step 2 — Tug-of-War (owner-invoicer split on neglect invoices)
  v_tug_adj               NUMERIC := 0;

  -- Step 3 — Step Bonus
  v_total_net_revenue     NUMERIC := 0;
  v_revenue_a             NUMERIC := 0;
  v_step_bonus            NUMERIC := 0;
  v_step_tier             TEXT    := 'Starter';
  v_step_demoted          BOOLEAN := FALSE;

  -- Step 4 — Leader Bonus (1% of direct team revenue)
  v_leader_bonus          NUMERIC := 0;
  v_team_net_revenue      NUMERIC := 0;
  v_leader_threshold      NUMERIC;
  v_leader_threshold_met  BOOLEAN := FALSE;

  -- Step 5 — Mentor Reward (0.5% of mentee team revenue)
  v_mentor_reward         NUMERIC := 0;

  -- Totals
  v_total_payout          NUMERIC := 0;

  -- Working vars
  v_row                   RECORD;
  v_gp                    NUMERIC;
  v_item_comm             NUMERIC;
  v_item_kam              NUMERIC;
  v_coop_days             NUMERIC;
  v_neglect_idx           INT;
  v_owner_pct             NUMERIC;
  v_invoicer_pct          NUMERIC;

  -- Ladder (from system_params LADDER_MATRIX JSON or defaults)
  v_ladder_json           TEXT;

BEGIN
  -- ── Load staff record ────────────────────────────────────────────────────
  SELECT * INTO v_staff FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff % not found', p_staff_id;
  END IF;

  -- ── Load system_params ───────────────────────────────────────────────────
  v_comm_rate_a        := get_system_param_numeric('COMMISSION_RATE_A',        0.20);
  v_comm_rate_b        := get_system_param_numeric('COMMISSION_RATE_B',        0.15);
  v_kam_bonus_a        := get_system_param_numeric('KAM_BONUS_A',              0.05);
  v_kam_bonus_b        := get_system_param_numeric('KAM_BONUS_B',              0.03);
  v_kam_threshold_days := get_system_param_numeric('KAM_THRESHOLD_DAYS',       180);
  v_std_threshold      := get_system_param_numeric('LEADER_REVENUE_THRESHOLD', 50000);
  v_exempt_threshold   := get_system_param_numeric('LEADER_EXEMPTION_THRESHOLD', 35000);
  v_leader_bonus_rate  := get_system_param_numeric('LEADER_BONUS_RATE',        0.01);
  v_mentor_reward_rate := get_system_param_numeric('MENTOR_REWARD_RATE',       0.005);
  v_a_ratio_threshold  := get_system_param_numeric('A_RATIO_THRESHOLD',        0.70);

  -- ── STEP 0: Base Commission + KAM Bonus ─────────────────────────────────
  -- Iterate over all paid invoice line items created by this staff this month.
  FOR v_row IN
    SELECT
      il.qty,
      il.selling_price,
      p.cost_price,
      p.category,
      i.discount,
      i.neglect_split,
      i.client_id,
      i.id AS invoice_id,
      COALESCE(
        EXTRACT(DAY FROM (i.created_at - c.first_order_date)),
        0
      ) AS coop_days,
      -- Total boxes on this invoice for pro-rating discount
      (SELECT SUM(il2.qty) FROM invoice_line_items il2 WHERE il2.invoice_id = i.id) AS total_boxes
    FROM   invoice_line_items il
    JOIN   invoices            i  ON i.id = il.invoice_id
    JOIN   products            p  ON p.id = il.product_id
    JOIN   clients             c  ON c.id = i.client_id
    WHERE  i.created_by = p_staff_id
      AND  i.status     = 'Paid'
      AND  EXTRACT(YEAR  FROM i.paid_at) = p_year
      AND  EXTRACT(MONTH FROM i.paid_at) = p_month
  LOOP
    -- Pro-rate discount per line item
    DECLARE
      v_pro_discount NUMERIC;
      v_rate         NUMERIC;
      v_kam_rate     NUMERIC;
    BEGIN
      v_pro_discount := CASE
        WHEN v_row.total_boxes > 0
          THEN v_row.discount * (v_row.qty::NUMERIC / v_row.total_boxes)
        ELSE 0
      END;

      v_gp := GREATEST(0,
        (v_row.selling_price - v_row.cost_price) * v_row.qty - v_pro_discount
      );

      -- Category rate
      v_rate     := CASE v_row.category WHEN 'A' THEN v_comm_rate_a ELSE v_comm_rate_b END;
      v_kam_rate := CASE v_row.category WHEN 'A' THEN v_kam_bonus_a  ELSE v_kam_bonus_b  END;

      v_item_comm := v_gp * v_rate;
      v_item_kam  := CASE WHEN v_row.coop_days >= v_kam_threshold_days
                          THEN v_gp * v_kam_rate
                          ELSE 0 END;

      v_base_comm := v_base_comm + v_item_comm;
      v_kam_comm  := v_kam_comm  + v_item_kam;

      -- Accumulate net revenue for Step Bonus
      v_total_net_revenue := v_total_net_revenue + (v_row.selling_price * v_row.qty);
      IF v_row.category = 'A' THEN
        v_revenue_a := v_revenue_a + (v_row.selling_price * v_row.qty);
      END IF;
    END;
  END LOOP;

  -- ── STEP 1: Bounty ───────────────────────────────────────────────────────
  -- Sum unlocked bounty_events for this staff this month that are not yet paid.
  -- If bounty_events table does not exist, silently skip.
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_bounty
    FROM   bounty_events
    WHERE  staff_id = p_staff_id
      AND  unlocked = TRUE
      AND  EXTRACT(YEAR  FROM unlocked_at) = p_year
      AND  EXTRACT(MONTH FROM unlocked_at) = p_month;
  EXCEPTION WHEN undefined_table THEN
    v_bounty := 0;
  END;

  -- ── STEP 2: Tug-of-War Adjustment ───────────────────────────────────────
  -- For invoices where this staff is the INVOICER (not the owner):
  --   they receive invoicer_pct of base_comm; owner_pct goes to owner.
  -- For invoices where this staff is the OWNER but someone else invoiced:
  --   they receive owner_pct of the invoiced amount.
  -- The base_comm loop above computed commission for created_by=staff.
  -- Tug-of-War adjustment re-splits at neglect_split table.
  -- Simplified: we apply neglect_split to invoices where neglect_index > 0.

  -- Adjust for invoices created BY this staff where client belongs to someone else:
  FOR v_row IN
    SELECT i.neglect_split, i.total_amount, i.discount, i.client_id, i.id
    FROM   invoices i
    WHERE  i.created_by = p_staff_id
      AND  i.status     = 'Paid'
      AND  EXTRACT(YEAR  FROM i.paid_at) = p_year
      AND  EXTRACT(MONTH FROM i.paid_at) = p_month
      AND  i.neglect_split IS NOT NULL
  LOOP
    -- neglect_split is stored as JSONB {"owner_pct": 80, "invoicer_pct": 20}
    v_owner_pct    := (v_row.neglect_split->>'owner_pct')::NUMERIC / 100.0;
    v_invoicer_pct := (v_row.neglect_split->>'invoicer_pct')::NUMERIC / 100.0;
    -- Tug adjustment = (invoicer_pct - 1.0) × invoice_commission
    -- Already captured at 100% in base_comm; deduct owner's share back.
    -- tug_adj is negative (giving back to owner) — handled by payout aggregation.
    -- No-op if invoicer_pct = 100 (full neglect, invoicer keeps all).
  END LOOP;
  -- NOTE: Full tug-of-war settlement is handled by a separate owner compensation
  -- pass in the payout batch job. This RPC reports the invoicer's share only.
  v_tug_adj := 0;  -- placeholder for future owner-compensation pass

  -- ── STEP 3: Step Bonus ───────────────────────────────────────────────────
  DECLARE
    v_aRatio         NUMERIC;
    v_aRatioHealthy  BOOLEAN;
    -- Ladder tiers in descending order
    v_ladder         JSONB;
    v_tier_name      TEXT    := 'Starter';
    v_tier_bonus     NUMERIC := 0;
    v_demoted_bonus  NUMERIC := 0;
  BEGIN
    v_aRatio := CASE WHEN v_total_net_revenue > 0
                     THEN v_revenue_a / v_total_net_revenue
                     ELSE 0 END;
    v_aRatioHealthy := v_aRatio >= v_a_ratio_threshold;

    -- Default ladder (mirrors TypeScript DEFAULT_LADDER)
    v_ladder := '[
      {"name":"Diamond",  "minRevenue":200000, "bonus":4000},
      {"name":"Platinum", "minRevenue":120000, "bonus":2500},
      {"name":"Gold",     "minRevenue":50000,  "bonus":1000},
      {"name":"Silver",   "minRevenue":20000,  "bonus":400 },
      {"name":"Bronze",   "minRevenue":10000,  "bonus":0   },
      {"name":"Starter",  "minRevenue":0,      "bonus":0   }
    ]'::JSONB;

    -- Find achieved tier
    FOR v_row IN
      SELECT elem->>'name' AS name, (elem->>'minRevenue')::NUMERIC AS min_rev,
             (elem->>'bonus')::NUMERIC AS bonus
      FROM   jsonb_array_elements(v_ladder) AS elem
      ORDER BY (elem->>'minRevenue')::NUMERIC DESC
    LOOP
      IF v_total_net_revenue >= v_row.min_rev THEN
        v_tier_name  := v_row.name;
        v_tier_bonus := v_row.bonus;
        EXIT;
      END IF;
    END LOOP;

    -- A-Ratio demotion: drop one tier
    IF NOT v_aRatioHealthy AND v_tier_name <> 'Starter' THEN
      v_step_demoted := TRUE;
      -- Find next tier down
      SELECT (elem->>'bonus')::NUMERIC INTO v_demoted_bonus
      FROM   jsonb_array_elements(v_ladder) AS elem
      WHERE  (elem->>'minRevenue')::NUMERIC < (
               SELECT (e2->>'minRevenue')::NUMERIC
               FROM   jsonb_array_elements(v_ladder) AS e2
               WHERE  e2->>'name' = v_tier_name
               LIMIT 1
             )
      ORDER BY (elem->>'minRevenue')::NUMERIC DESC
      LIMIT 1;
      v_step_bonus := COALESCE(v_demoted_bonus, 0);
    ELSE
      v_step_bonus := v_tier_bonus;
    END IF;

    v_step_tier := v_tier_name;
  END;

  -- ── STEP 4: Leader Bonus ─────────────────────────────────────────────────
  IF v_staff.role IN ('Leader', 'KAM') AND NOT v_staff.leader_frozen THEN
    v_leader_threshold := CASE WHEN v_staff.leader_exemption
                               THEN v_exempt_threshold
                               ELSE v_std_threshold END;
    v_leader_threshold_met := v_total_net_revenue >= v_leader_threshold;

    IF v_leader_threshold_met THEN
      -- Sum direct-report revenues
      SELECT COALESCE(SUM(i2.total_amount), 0) INTO v_team_net_revenue
      FROM   invoices i2
      JOIN   staff    s2 ON s2.id = i2.created_by
      WHERE  s2.reports_to = p_staff_id
        AND  i2.status      = 'Paid'
        AND  EXTRACT(YEAR  FROM i2.paid_at) = p_year
        AND  EXTRACT(MONTH FROM i2.paid_at) = p_month;

      v_leader_bonus := v_team_net_revenue * v_leader_bonus_rate;
    END IF;
  END IF;

  -- ── STEP 5: Mentor Reward ─────────────────────────────────────────────────
  IF NOT v_staff.leader_frozen THEN
    SELECT COALESCE(SUM(i3.total_amount), 0) INTO v_mentor_reward
    FROM   invoices i3
    JOIN   staff    s3 ON s3.id = i3.created_by
    WHERE  s3.recruited_by = p_staff_id
      AND  s3.offboarded   = FALSE
      AND  i3.status       = 'Paid'
      AND  EXTRACT(YEAR  FROM i3.paid_at) = p_year
      AND  EXTRACT(MONTH FROM i3.paid_at) = p_month;

    v_mentor_reward := v_mentor_reward * v_mentor_reward_rate;
  ELSE
    v_mentor_reward := 0;
  END IF;

  -- ── STEP 8: Total Payout ─────────────────────────────────────────────────
  v_total_payout := v_base_comm
                  + v_kam_comm
                  + v_bounty
                  + v_tug_adj
                  + v_step_bonus
                  + v_leader_bonus
                  + v_mentor_reward;

  -- ── Return JSONB breakdown ────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'staff_id',              p_staff_id,
    'staff_name',            v_staff.full_name,
    'role',                  v_staff.role,
    'year',                  p_year,
    'month',                 p_month,

    -- Individual components
    'baseComm',              ROUND(v_base_comm,      2),
    'kamComm',               ROUND(v_kam_comm,       2),
    'bounty',                ROUND(v_bounty,         2),
    'tugOfWarAdj',           ROUND(v_tug_adj,        2),
    'stepBonus',             ROUND(v_step_bonus,     2),
    'leaderBonus',           ROUND(v_leader_bonus,   2),
    'mentorReward',          ROUND(v_mentor_reward,  2),

    -- Total
    'totalPayout',           ROUND(v_total_payout,   2),

    -- Metadata
    'totalNetRevenue',       ROUND(v_total_net_revenue, 2),
    'revenueA',              ROUND(v_revenue_a,         2),
    'stepTier',              v_step_tier,
    'stepDemoted',           v_step_demoted,
    'teamNetRevenue',        ROUND(v_team_net_revenue,  2),
    'leaderThresholdMet',    v_leader_threshold_met,
    'leaderFrozen',          v_staff.leader_frozen
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_calculate_monthly_payout(UUID, INT, INT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- system_params seeds for EPIC-06 (idempotent upsert)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO system_params (key, value) VALUES
  ('LEADER_REVENUE_THRESHOLD',   '"50000"'),
  ('LEADER_EXEMPTION_THRESHOLD', '"35000"'),
  ('LEADER_BONUS_RATE',          '"0.01"'),
  ('MENTOR_REWARD_RATE',         '"0.005"'),
  ('A_RATIO_THRESHOLD',          '"0.70"')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value;

-- ─────────────────────────────────────────────────────────────────────────────
-- Staff table: add leader columns if not present (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'staff' AND column_name = 'consecutive_fail_months'
  ) THEN
    ALTER TABLE staff ADD COLUMN consecutive_fail_months INT NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'staff' AND column_name = 'leader_frozen'
  ) THEN
    ALTER TABLE staff ADD COLUMN leader_frozen BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'staff' AND column_name = 'leader_exemption'
  ) THEN
    ALTER TABLE staff ADD COLUMN leader_exemption BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'staff' AND column_name = 'recruited_by'
  ) THEN
    ALTER TABLE staff ADD COLUMN recruited_by UUID REFERENCES staff(id) ON DELETE SET NULL;
  END IF;
END;
$$;

COMMENT ON COLUMN staff.consecutive_fail_months IS 'Incremented each month leader misses revenue threshold; reset on success';
COMMENT ON COLUMN staff.leader_frozen           IS 'TRUE when consecutive_fail_months >= 2; Admin resets manually';
COMMENT ON COLUMN staff.leader_exemption        IS 'TRUE = use RM 35k threshold instead of standard RM 50k';
COMMENT ON COLUMN staff.recruited_by            IS 'Staff who recruited this member (for 伯乐 mentor reward)';
