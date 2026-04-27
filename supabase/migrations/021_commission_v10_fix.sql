-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 021: Commission Engine v10 — Full Fix
-- EPIC-06 · Authored against COMMISSION_FORMULA_v10.md (2026-04-27)
--
-- Bug fixes in fn_calculate_monthly_payout vs v10 spec:
--   1. invoice_line_items → invoice_items  (wrong table name)
--   2. v_staff.full_name → v_staff.name    (wrong column)
--   3. s2.reports_to → s2.leader_id        (wrong FK column)
--   4. s3.offboarded = FALSE → s3.status = 'Active'  (column doesn't exist)
--   5. Discount allocation: by category revenue ratio, NOT by qty ratio  (§ 1b)
--   6. Net revenue: sum(selling_price×qty) from invoice_items, not total_amount
--   7. Tug-of-War: implement invoicer_pct reduction + owner compensation pass (§ 8)
--   8. Joint Order: apply 50% multiplier to commission + revenue credit (§ 11)
--   9. Mentor Reward: on mentee's TEAM revenue, NOT mentee's personal revenue (§ 7)
--  10. Create bounty_events table + trigger fn_check_bounty_tiers              (§ 4)
--  11. Seed ALL Appendix A system_params
-- ══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- § 4 support: bounty_events table
-- Stores one row per tier-unlock per client.
-- clients.tierXclaimed flags guard against re-triggering.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bounty_events (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID         NOT NULL REFERENCES staff(id)   ON DELETE CASCADE,
  client_id    UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tier         INT          NOT NULL CHECK (tier BETWEEN 1 AND 4),
  amount       NUMERIC(8,2) NOT NULL CHECK (amount > 0),
  unlocked_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, tier)   -- each tier claimable once per client, ever
);

CREATE INDEX IF NOT EXISTS idx_bounty_staff_month ON bounty_events (staff_id, unlocked_at);

COMMENT ON TABLE bounty_events IS
  'One row per tier-unlock per client. staff_id = who gets paid. Immutable after insert.';

ALTER TABLE bounty_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bounty_own_read"  ON bounty_events;
DROP POLICY IF EXISTS "bounty_admin_all" ON bounty_events;

CREATE POLICY "bounty_own_read" ON bounty_events
  FOR SELECT USING (
    staff_id = (SELECT id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1)
  );

CREATE POLICY "bounty_admin_all" ON bounty_events
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid() AND role IN ('Admin','HR')
    )
  );

GRANT SELECT ON bounty_events TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- § 4 trigger: fn_check_bounty_tiers
-- Fires AFTER UPDATE OF status ON invoices when status transitions to 'Paid'.
-- Evaluates all 4 bounty tiers and inserts bounty_events rows as they unlock.
-- Uses clients.tierXclaimed as idempotency guard.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_check_bounty_tiers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bounty_enabled    BOOLEAN;
  v_client_r          RECORD;
  v_prev_count        BIGINT;
  v_cumulative_rev    NUMERIC;
  v_days_since_first  INT;
  v_first_paid_date   DATE;

  -- Tier params (loaded from system_params with v10 defaults)
  v_t1_min_boxes  INT;
  v_t1_amount     NUMERIC;
  v_t2_amount     NUMERIC;
  v_t2_min_rev    NUMERIC;
  v_t2_days       INT;
  v_t3_amount     NUMERIC;
  v_t3_min_rev    NUMERIC;
  v_t3_days       INT;
  v_t4_amount     NUMERIC;
  v_t4_min_rev    NUMERIC;
  v_t4_days       INT;
BEGIN
  -- Guard: only run on Paid transition
  IF NOT (NEW.status = 'Paid' AND (OLD.status IS DISTINCT FROM 'Paid')) THEN
    RETURN NEW;
  END IF;
  IF NEW.paid_at IS NULL THEN RETURN NEW; END IF;

  -- Master bounty toggle
  SELECT (value #>> '{}')::BOOLEAN INTO v_bounty_enabled
  FROM system_params WHERE key = 'BOUNTY_ENABLED' LIMIT 1;
  IF NOT COALESCE(v_bounty_enabled, TRUE) THEN RETURN NEW; END IF;

  -- Load client (snapshot before any updates in this trigger)
  SELECT * INTO v_client_r FROM clients WHERE id = NEW.client_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Load tier parameters
  v_t1_min_boxes := get_system_param_numeric('BOUNTY_T1_MIN_BOXES', 3)::INT;
  v_t1_amount    := get_system_param_numeric('BOUNTY_T1_AMOUNT',    50);
  v_t2_amount    := get_system_param_numeric('BOUNTY_T2_AMOUNT',    50);
  v_t2_min_rev   := get_system_param_numeric('BOUNTY_T2_MIN_REV',   1000);
  v_t2_days      := get_system_param_numeric('BOUNTY_T2_DAYS',      90)::INT;
  v_t3_amount    := get_system_param_numeric('BOUNTY_T3_AMOUNT',    100);
  v_t3_min_rev   := get_system_param_numeric('BOUNTY_T3_MIN_REV',   2000);
  v_t3_days      := get_system_param_numeric('BOUNTY_T3_DAYS',      180)::INT;
  v_t4_amount    := get_system_param_numeric('BOUNTY_T4_AMOUNT',    200);
  v_t4_min_rev   := get_system_param_numeric('BOUNTY_T4_MIN_REV',   6000);
  v_t4_days      := get_system_param_numeric('BOUNTY_T4_DAYS',      365)::INT;

  -- Count prior paid invoices for this client (to detect the first-ever invoice)
  SELECT COUNT(*) INTO v_prev_count
  FROM invoices
  WHERE client_id = NEW.client_id
    AND status    = 'Paid'
    AND id       <> NEW.id;

  -- Cumulative net revenue (includes current invoice since trigger fires AFTER update)
  SELECT COALESCE(SUM(total_amount - delivery_charge), 0) INTO v_cumulative_rev
  FROM invoices
  WHERE client_id = NEW.client_id
    AND status    = 'Paid';

  -- Days since first paid invoice
  IF v_prev_count = 0 THEN
    -- This IS the first paid invoice → set first_order_date
    v_days_since_first := 0;
    UPDATE clients
    SET    first_order_date = NEW.paid_at::DATE
    WHERE  id = NEW.client_id
      AND  first_order_date IS NULL;
  ELSIF v_client_r.first_order_date IS NOT NULL THEN
    v_days_since_first := (NEW.paid_at::DATE - v_client_r.first_order_date)::INT;
  ELSE
    SELECT MIN(paid_at)::DATE INTO v_first_paid_date
    FROM invoices
    WHERE client_id = NEW.client_id AND status = 'Paid' AND id <> NEW.id;
    v_days_since_first := COALESCE((NEW.paid_at::DATE - v_first_paid_date)::INT, 0);
  END IF;

  -- Update running total_revenue on client
  UPDATE clients
  SET    total_revenue = total_revenue + (NEW.total_amount - NEW.delivery_charge)
  WHERE  id = NEW.client_id;

  -- ── Tier 1: First paid invoice + min_boxes ──────────────────────────────
  IF NOT v_client_r.tier1_claimed
     AND v_prev_count = 0
     AND NEW.total_boxes >= v_t1_min_boxes
  THEN
    INSERT INTO bounty_events (staff_id, client_id, tier, amount)
    VALUES (NEW.created_by, NEW.client_id, 1, v_t1_amount)
    ON CONFLICT (client_id, tier) DO NOTHING;
    UPDATE clients SET tier1_claimed = TRUE WHERE id = NEW.client_id;
  END IF;

  -- ── Tier 2: Cumulative ≥ T2_MIN_REV within T2_DAYS ─────────────────────
  IF NOT v_client_r.tier2_claimed
     AND v_cumulative_rev >= v_t2_min_rev
     AND v_days_since_first <= v_t2_days
  THEN
    INSERT INTO bounty_events (staff_id, client_id, tier, amount)
    VALUES (NEW.created_by, NEW.client_id, 2, v_t2_amount)
    ON CONFLICT (client_id, tier) DO NOTHING;
    UPDATE clients SET tier2_claimed = TRUE WHERE id = NEW.client_id;
  END IF;

  -- ── Tier 3 ───────────────────────────────────────────────────────────────
  IF NOT v_client_r.tier3_claimed
     AND v_cumulative_rev >= v_t3_min_rev
     AND v_days_since_first <= v_t3_days
  THEN
    INSERT INTO bounty_events (staff_id, client_id, tier, amount)
    VALUES (NEW.created_by, NEW.client_id, 3, v_t3_amount)
    ON CONFLICT (client_id, tier) DO NOTHING;
    UPDATE clients SET tier3_claimed = TRUE WHERE id = NEW.client_id;
  END IF;

  -- ── Tier 4 ───────────────────────────────────────────────────────────────
  IF NOT v_client_r.tier4_claimed
     AND v_cumulative_rev >= v_t4_min_rev
     AND v_days_since_first <= v_t4_days
  THEN
    INSERT INTO bounty_events (staff_id, client_id, tier, amount)
    VALUES (NEW.created_by, NEW.client_id, 4, v_t4_amount)
    ON CONFLICT (client_id, tier) DO NOTHING;
    UPDATE clients SET tier4_claimed = TRUE WHERE id = NEW.client_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_bounty_on_paid ON invoices;
CREATE TRIGGER trg_check_bounty_on_paid
  AFTER UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_bounty_tiers();


-- ─────────────────────────────────────────────────────────────────────────────
-- Core RPC: fn_calculate_monthly_payout  (complete rewrite — v10 compliant)
-- Read-only. Returns full JSONB breakdown of all commission components.
-- See COMMISSION_FORMULA_v10.md for formula specification.
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

  -- § Appendix A — system params
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

  -- §0 Revenue
  v_total_net_revenue     NUMERIC := 0;   -- sum(selling_price×qty) for step-bonus tier
  v_revenue_a             NUMERIC := 0;   -- category A only

  -- §2+3 Base + KAM Commission
  v_base_comm             NUMERIC := 0;
  v_kam_comm              NUMERIC := 0;

  -- §4 Bounty
  v_bounty                NUMERIC := 0;

  -- §5 Step Bonus
  v_step_bonus            NUMERIC := 0;
  v_step_tier             TEXT    := 'Starter';
  v_step_demoted          BOOLEAN := FALSE;

  -- §6 Leader Bonus
  v_leader_bonus          NUMERIC := 0;
  v_team_net_revenue      NUMERIC := 0;
  v_leader_threshold      NUMERIC;
  v_leader_threshold_met  BOOLEAN := FALSE;

  -- §7 Mentor Reward
  v_mentor_reward         NUMERIC := 0;

  -- §8 Tug-of-War owner compensation (separate pass)
  v_tug_owner_bonus       NUMERIC := 0;

  -- Total
  v_total_payout          NUMERIC := 0;

  -- Invoice loop working variables
  v_inv                   RECORD;
  v_raw_gp_a              NUMERIC;
  v_raw_gp_b              NUMERIC;
  v_rev_a_inv             NUMERIC;
  v_rev_b_inv             NUMERIC;
  v_inv_total_rev         NUMERIC;
  v_disc_a                NUMERIC;
  v_disc_b                NUMERIC;
  v_gp_a                  NUMERIC;
  v_gp_b                  NUMERIC;
  v_inv_base              NUMERIC;
  v_inv_kam               NUMERIC;
  v_coop_days             INT;
  v_invoicer_pct          NUMERIC;
  v_is_creator            BOOLEAN;

  -- Step bonus working vars
  v_a_ratio               NUMERIC;
  v_a_ratio_healthy       BOOLEAN;
  v_ladder                JSONB;
  v_ladder_row            RECORD;
  v_tier_bonus            NUMERIC;
  v_demoted_bonus         NUMERIC;

  -- Mentor reward working vars
  v_mentee                RECORD;
  v_mentee_team_rev       NUMERIC;

BEGIN
  -- ── Load staff record ────────────────────────────────────────────────────
  SELECT * INTO v_staff FROM staff WHERE id = p_staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff % not found', p_staff_id;
  END IF;

  -- ── Load all system params (§ Appendix A) ────────────────────────────────
  v_comm_rate_a        := get_system_param_numeric('COMMISSION_RATE_A',        0.20);
  v_comm_rate_b        := get_system_param_numeric('COMMISSION_RATE_B',        0.15);
  v_kam_bonus_a        := get_system_param_numeric('KAM_A_RATE',               0.05);
  v_kam_bonus_b        := get_system_param_numeric('KAM_B_RATE',               0.03);
  v_kam_threshold_days := get_system_param_numeric('KAM_PERIOD',               180);
  v_std_threshold      := get_system_param_numeric('LEADER_THRESHOLD',         50000);
  v_exempt_threshold   := get_system_param_numeric('LEADER_THRESHOLD_EXEMPTION', 35000);
  v_leader_bonus_rate  := get_system_param_numeric('LEADER_RATE',              0.01);
  v_mentor_reward_rate := get_system_param_numeric('MENTOR_RATE',              0.005);
  v_a_ratio_threshold  := get_system_param_numeric('A_RATIO_THRESHOLD',        0.70);

  -- ── §1 + §2 + §3: GP calculation, Base Commission, KAM Allowance ─────────
  --
  -- Loop over every paid invoice where this staff is either:
  --   (a) the creator (created_by = p_staff_id), or
  --   (b) the co-creator of a joint order (is_joint_order AND co_created_by = p_staff_id)
  --
  -- For each invoice:
  --   1. Aggregate GP by category (A/B) from invoice_items  ← FIX #1: correct table
  --   2. Allocate discount by revenue ratio A/B             ← FIX #5: v10 § 1b formula
  --   3. Apply GP floor = 0                                 ← v10 § 1c
  --   4. Apply KAM bonus if client tenure ≥ KAM_PERIOD      ← v10 § 3
  --   5. Apply tug-of-war invoicer_pct reduction            ← FIX #7: v10 § 8
  --   6. Apply joint order 50% split                        ← FIX #8: v10 § 11
  -- ─────────────────────────────────────────────────────────────────────────
  FOR v_inv IN
    SELECT
      i.id,
      i.client_id,
      i.discount,
      i.delivery_charge,
      i.total_amount,
      i.is_joint_order,
      i.co_created_by,
      i.neglect_split,
      i.created_by
    FROM invoices i
    WHERE (
      i.created_by = p_staff_id
      OR (i.is_joint_order = TRUE AND i.co_created_by = p_staff_id)
    )
      AND i.status = 'Paid'
      AND EXTRACT(YEAR  FROM i.paid_at) = p_year
      AND EXTRACT(MONTH FROM i.paid_at) = p_month
  LOOP
    -- Per-invoice GP aggregation by category
    -- invoice_items ← FIX #1 (was "invoice_line_items" in migration 011)
    SELECT
      COALESCE(SUM(CASE WHEN p.category = 'A'
                        THEN (ii.selling_price - ii.cost_price_snapshot) * ii.qty
                        ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN p.category = 'B'
                        THEN (ii.selling_price - ii.cost_price_snapshot) * ii.qty
                        ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN p.category = 'A'
                        THEN ii.selling_price * ii.qty
                        ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN p.category = 'B'
                        THEN ii.selling_price * ii.qty
                        ELSE 0 END), 0)
    INTO v_raw_gp_a, v_raw_gp_b, v_rev_a_inv, v_rev_b_inv
    FROM invoice_items ii                              -- FIX #1
    JOIN products      p  ON p.id = ii.product_id     -- joined only for p.category
    WHERE ii.invoice_id = v_inv.id;

    v_inv_total_rev := v_rev_a_inv + v_rev_b_inv;

    -- § 1b: Discount proportional allocation by revenue ratio  ← FIX #5
    -- Discount_A = Total_Discount × (Revenue_A / Total_Revenue)
    -- Discount_B = Total_Discount × (Revenue_B / Total_Revenue)
    IF v_inv_total_rev > 0 THEN
      v_disc_a := v_inv.discount * (v_rev_a_inv / v_inv_total_rev);
      v_disc_b := v_inv.discount * (v_rev_b_inv / v_inv_total_rev);
    ELSE
      v_disc_a := 0;
      v_disc_b := 0;
    END IF;

    -- § 1c: GP floor = 0 (熔断机制)
    v_gp_a := GREATEST(0, v_raw_gp_a - v_disc_a);
    v_gp_b := GREATEST(0, v_raw_gp_b - v_disc_b);

    -- § 3: KAM tenure check (client.first_order_date)
    SELECT COALESCE(
      EXTRACT(DAY FROM (NOW() - c.first_order_date::TIMESTAMPTZ))::INT,
      0
    )
    INTO v_coop_days
    FROM clients c
    WHERE c.id = v_inv.client_id;

    -- § 2 Base Commission + § 3 KAM Allowance
    v_inv_base := v_gp_a * v_comm_rate_a  + v_gp_b * v_comm_rate_b;
    v_inv_kam  := CASE WHEN v_coop_days >= v_kam_threshold_days
                       THEN v_gp_a * v_kam_bonus_a + v_gp_b * v_kam_bonus_b
                       ELSE 0 END;

    -- Is this staff the invoice creator (vs co_created_by only)?
    v_is_creator := (v_inv.created_by = p_staff_id);

    -- § 8 Tug-of-War: reduce invoicer commission by invoicer_pct        ← FIX #7
    -- Only the creator (invoicer) is subject to the neglect split.
    -- Co-creator (HR/Finance) is not part of the ownership dispute.
    IF v_is_creator AND v_inv.neglect_split IS NOT NULL THEN
      v_invoicer_pct :=
        COALESCE((v_inv.neglect_split->>'invoicer_pct')::NUMERIC, 100) / 100.0;
      v_inv_base := v_inv_base * v_invoicer_pct;
      v_inv_kam  := v_inv_kam  * v_invoicer_pct;
    END IF;

    -- § 11 Joint Order 50/50 split                                       ← FIX #8
    IF v_inv.is_joint_order THEN
      v_inv_base := v_inv_base * 0.5;
      v_inv_kam  := v_inv_kam  * 0.5;
    END IF;

    -- Accumulate commission
    v_base_comm := v_base_comm + v_inv_base;
    v_kam_comm  := v_kam_comm  + v_inv_kam;

    -- § 0 Revenue for step bonus tier check
    -- Joint order: 50/50 revenue credit (§ 11)
    -- Tug-of-war: revenue stays 100% with invoicer (only commission is split)
    IF v_inv.is_joint_order THEN
      v_total_net_revenue := v_total_net_revenue + v_inv_total_rev * 0.5;
      v_revenue_a         := v_revenue_a         + v_rev_a_inv    * 0.5;
    ELSIF v_is_creator THEN
      v_total_net_revenue := v_total_net_revenue + v_inv_total_rev;
      v_revenue_a         := v_revenue_a         + v_rev_a_inv;
    END IF;
  END LOOP;


  -- ── § 8 Owner Compensation Pass (Tug-of-War)                          ← FIX #7
  -- Find paid invoices this month where:
  --   • client.created_by = p_staff_id  (this staff owns the client)
  --   • invoice.created_by ≠ p_staff_id (someone else invoiced)
  --   • neglect_split IS NOT NULL        (split is active)
  -- Owner earns owner_pct of the base commission on those invoices.
  -- ─────────────────────────────────────────────────────────────────────────
  FOR v_inv IN
    SELECT
      i.id,
      i.client_id,
      i.discount,
      i.neglect_split
    FROM invoices i
    JOIN clients  c ON c.id = i.client_id
    WHERE c.created_by      = p_staff_id       -- this staff is the client owner
      AND i.created_by     <> p_staff_id       -- but someone else invoiced
      AND i.neglect_split   IS NOT NULL        -- tug-of-war split is active
      AND i.status          = 'Paid'
      AND EXTRACT(YEAR  FROM i.paid_at) = p_year
      AND EXTRACT(MONTH FROM i.paid_at) = p_month
  LOOP
    -- Recompute GP for owner's invoices
    SELECT
      COALESCE(SUM(CASE WHEN p.category = 'A'
                        THEN (ii.selling_price - ii.cost_price_snapshot) * ii.qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN p.category = 'B'
                        THEN (ii.selling_price - ii.cost_price_snapshot) * ii.qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN p.category = 'A'
                        THEN ii.selling_price * ii.qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN p.category = 'B'
                        THEN ii.selling_price * ii.qty ELSE 0 END), 0)
    INTO v_raw_gp_a, v_raw_gp_b, v_rev_a_inv, v_rev_b_inv
    FROM invoice_items ii
    JOIN products      p  ON p.id = ii.product_id     -- joined only for p.category
    WHERE ii.invoice_id = v_inv.id;

    v_inv_total_rev := v_rev_a_inv + v_rev_b_inv;

    IF v_inv_total_rev > 0 THEN
      v_disc_a := v_inv.discount * (v_rev_a_inv / v_inv_total_rev);
      v_disc_b := v_inv.discount * (v_rev_b_inv / v_inv_total_rev);
    ELSE
      v_disc_a := 0;
      v_disc_b := 0;
    END IF;

    v_gp_a := GREATEST(0, v_raw_gp_a - v_disc_a);
    v_gp_b := GREATEST(0, v_raw_gp_b - v_disc_b);

    -- Owner gets owner_pct of base commission only (no KAM — owner didn't serve client)
    v_tug_owner_bonus := v_tug_owner_bonus +
      (v_gp_a * v_comm_rate_a + v_gp_b * v_comm_rate_b) *
      (COALESCE((v_inv.neglect_split->>'owner_pct')::NUMERIC, 0) / 100.0);
  END LOOP;


  -- ── § 4: Bounty ─────────────────────────────────────────────────────────
  -- Reads from bounty_events table (populated by fn_check_bounty_tiers trigger).
  BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_bounty
    FROM   bounty_events
    WHERE  staff_id = p_staff_id
      AND  EXTRACT(YEAR  FROM unlocked_at) = p_year
      AND  EXTRACT(MONTH FROM unlocked_at) = p_month;
  EXCEPTION WHEN undefined_table THEN
    v_bounty := 0;
  END;


  -- ── § 5: Step Bonus with A-Ratio Guard ───────────────────────────────────
  v_a_ratio       := CASE WHEN v_total_net_revenue > 0
                           THEN v_revenue_a / v_total_net_revenue
                           ELSE 0 END;
  v_a_ratio_healthy := v_a_ratio >= v_a_ratio_threshold;

  -- Default ladder (mirrors TypeScript DEFAULT_LADDER — overridden by LADDER_MATRIX param)
  v_ladder := '[
    {"name":"Diamond",  "minRevenue":200000, "bonus":4000},
    {"name":"Platinum", "minRevenue":120000, "bonus":2500},
    {"name":"Gold",     "minRevenue":50000,  "bonus":1000},
    {"name":"Silver",   "minRevenue":20000,  "bonus":400 },
    {"name":"Bronze",   "minRevenue":10000,  "bonus":0   },
    {"name":"Starter",  "minRevenue":0,      "bonus":0   }
  ]'::JSONB;

  -- Find achieved tier (highest threshold that personal revenue meets)
  v_tier_bonus := 0;
  FOR v_ladder_row IN
    SELECT
      elem->>'name'                  AS name,
      (elem->>'minRevenue')::NUMERIC AS min_rev,
      (elem->>'bonus')::NUMERIC      AS bonus
    FROM   jsonb_array_elements(v_ladder) AS elem
    ORDER  BY (elem->>'minRevenue')::NUMERIC DESC
  LOOP
    IF v_total_net_revenue >= v_ladder_row.min_rev THEN
      v_step_tier  := v_ladder_row.name;
      v_tier_bonus := v_ladder_row.bonus;
      EXIT;
    END IF;
  END LOOP;

  -- A-Ratio demotion: downgrade ONE tier  ← v10 § 5 (not forfeit entire bonus)
  IF NOT v_a_ratio_healthy AND v_step_tier <> 'Starter' THEN
    v_step_demoted := TRUE;
    -- Find the tier immediately below the achieved tier
    SELECT (elem->>'bonus')::NUMERIC INTO v_demoted_bonus
    FROM   jsonb_array_elements(v_ladder) AS elem
    WHERE  (elem->>'minRevenue')::NUMERIC < (
             SELECT (e2->>'minRevenue')::NUMERIC
             FROM   jsonb_array_elements(v_ladder) AS e2
             WHERE  e2->>'name' = v_step_tier
             LIMIT 1
           )
    ORDER  BY (elem->>'minRevenue')::NUMERIC DESC
    LIMIT  1;
    v_step_bonus := COALESCE(v_demoted_bonus, 0);
  ELSE
    v_step_bonus := v_tier_bonus;
  END IF;


  -- ── § 6: Leader Override ─────────────────────────────────────────────────
  -- Personal revenue threshold check uses v_total_net_revenue (personal only).
  -- Team revenue = SUM of direct subordinates' (total_amount − delivery_charge).
  -- FIX #3: uses s.leader_id (was s.reports_to in migration 011)
  IF v_staff.role IN ('Leader', 'KAM') AND NOT COALESCE(v_staff.leader_frozen, FALSE) THEN
    v_leader_threshold :=
      CASE WHEN COALESCE(v_staff.leader_exemption, FALSE)
           THEN v_exempt_threshold
           ELSE v_std_threshold END;

    v_leader_threshold_met := v_total_net_revenue >= v_leader_threshold;

    IF v_leader_threshold_met THEN
      -- Sum direct-report net revenues (total_amount − delivery_charge)
      SELECT COALESCE(SUM(i2.total_amount - i2.delivery_charge), 0)
      INTO   v_team_net_revenue
      FROM   invoices i2
      JOIN   staff    s2 ON s2.id = i2.created_by
      WHERE  s2.leader_id = p_staff_id          -- FIX #3: was s2.reports_to
        AND  i2.status    = 'Paid'
        AND  EXTRACT(YEAR  FROM i2.paid_at) = p_year
        AND  EXTRACT(MONTH FROM i2.paid_at) = p_month;

      v_leader_bonus := v_team_net_revenue * v_leader_bonus_rate;
    END IF;
  END IF;


  -- ── § 7: Mentor Reward ───────────────────────────────────────────────────
  -- Mentor_Reward = Σ (Mentee_Team_Total_Net_Revenue × MENTOR_RATE)
  -- Mentee_Team_Total_Net_Revenue = sum of all Sales UNDER the mentee Leader
  --   (the mentee's own personal revenue is excluded per spec)
  --
  -- FIX #9: was summing mentee's own invoices — must sum mentee's TEAM invoices
  -- FIX #4: was s3.offboarded = FALSE — column is s3.status = 'Active'
  IF NOT COALESCE(v_staff.leader_frozen, FALSE) THEN
    FOR v_mentee IN
      SELECT s.id AS mentee_id
      FROM   staff s
      WHERE  s.recruited_by = p_staff_id      -- FIX #4 context: recruited_by exists
        AND  s.status       = 'Active'         -- FIX #4: was s.offboarded = FALSE
        AND  s.role         IN ('Leader','KAM') -- only promoted mentees generate team revenue
    LOOP
      -- Sum the mentee's TEAM revenue (direct reports under mentee, not mentee themselves)
      SELECT COALESCE(SUM(i3.total_amount - i3.delivery_charge), 0)
      INTO   v_mentee_team_rev
      FROM   invoices i3
      JOIN   staff    s3 ON s3.id = i3.created_by
      WHERE  s3.leader_id = v_mentee.mentee_id  -- mentee's direct reports
        AND  i3.status    = 'Paid'
        AND  EXTRACT(YEAR  FROM i3.paid_at) = p_year
        AND  EXTRACT(MONTH FROM i3.paid_at) = p_month;

      v_mentor_reward := v_mentor_reward + (v_mentee_team_rev * v_mentor_reward_rate);
    END LOOP;
  END IF;


  -- ── § 9: Total Payout ────────────────────────────────────────────────────
  v_total_payout := v_base_comm
                  + v_kam_comm
                  + v_bounty
                  + v_step_bonus
                  + v_leader_bonus
                  + v_mentor_reward
                  + v_tug_owner_bonus;

  -- ── Return full JSONB breakdown ───────────────────────────────────────────
  RETURN jsonb_build_object(
    'staff_id',             p_staff_id,
    'staff_name',           v_staff.name,           -- FIX #2: was v_staff.full_name
    'role',                 v_staff.role,
    'year',                 p_year,
    'month',                p_month,

    -- Commission components (all rounded to 2dp)
    'baseComm',             ROUND(v_base_comm,        2),
    'kamComm',              ROUND(v_kam_comm,          2),
    'bounty',               ROUND(v_bounty,            2),
    'stepBonus',            ROUND(v_step_bonus,        2),
    'leaderBonus',          ROUND(v_leader_bonus,      2),
    'mentorReward',         ROUND(v_mentor_reward,     2),
    'tugOfWarOwnerBonus',   ROUND(v_tug_owner_bonus,   2),

    -- Grand total
    'totalPayout',          ROUND(v_total_payout,      2),

    -- Revenue metadata
    'totalNetRevenue',      ROUND(v_total_net_revenue, 2),
    'revenueA',             ROUND(v_revenue_a,         2),
    'aRatio',               ROUND(v_a_ratio,           4),
    'stepTier',             v_step_tier,
    'stepDemoted',          v_step_demoted,

    -- Leader metadata
    'teamNetRevenue',       ROUND(v_team_net_revenue,  2),
    'leaderThresholdMet',   v_leader_threshold_met,
    'leaderFrozen',         COALESCE(v_staff.leader_frozen, FALSE)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_calculate_monthly_payout(UUID, INT, INT) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Appendix A: Full system_params seed (idempotent upsert)
-- All keys match exactly what fn_calculate_monthly_payout reads.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO system_params (key, value) VALUES
  -- § 2 Base Commission rates
  ('COMMISSION_RATE_A',              '"0.20"'),
  ('COMMISSION_RATE_B',              '"0.15"'),

  -- § 3 KAM Allowance
  ('KAM_A_RATE',                     '"0.05"'),
  ('KAM_B_RATE',                     '"0.03"'),
  ('KAM_PERIOD',                     '"180"'),

  -- § 4 New Client Bounty
  ('BOUNTY_ENABLED',                 '"true"'),
  ('BOUNTY_T1_MIN_BOXES',            '"3"'),
  ('BOUNTY_T1_AMOUNT',               '"50"'),
  ('BOUNTY_T2_AMOUNT',               '"50"'),
  ('BOUNTY_T2_MIN_REV',              '"1000"'),
  ('BOUNTY_T2_DAYS',                 '"90"'),
  ('BOUNTY_T3_AMOUNT',               '"100"'),
  ('BOUNTY_T3_MIN_REV',              '"2000"'),
  ('BOUNTY_T3_DAYS',                 '"180"'),
  ('BOUNTY_T4_AMOUNT',               '"200"'),
  ('BOUNTY_T4_MIN_REV',              '"6000"'),
  ('BOUNTY_T4_DAYS',                 '"365"'),

  -- § 5 Step Bonus / Ladder
  ('A_RATIO_THRESHOLD',              '"0.70"'),

  -- § 6 Leader Override
  ('LEADER_THRESHOLD',               '"50000"'),
  ('LEADER_THRESHOLD_EXEMPTION',     '"35000"'),
  ('LEADER_RATE',                    '"0.01"'),
  ('DEATH_LINE_MONTHS',              '"2"'),

  -- § 7 Mentor Reward
  ('MENTOR_RATE',                    '"0.005"'),

  -- Spinoff threshold (fn_request_spinoff)
  ('SPINOFF_THRESHOLD',              '"50000"'),

  -- Delivery free threshold
  ('FREE_DELIVERY_BOXES',            '"5"'),
  ('MIN_BOXES',                      '"3"')

ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value;

-- Also insert legacy key aliases used in fn_evaluate_leader_month (migration 011)
-- so that function continues to work without modification:
INSERT INTO system_params (key, value) VALUES
  ('LEADER_REVENUE_THRESHOLD',       '"50000"'),
  ('LEADER_EXEMPTION_THRESHOLD',     '"35000"'),
  ('LEADER_BONUS_RATE',              '"0.01"'),
  ('MENTOR_REWARD_RATE',             '"0.005"'),
  ('KAM_BONUS_A',                    '"0.05"'),
  ('KAM_BONUS_B',                    '"0.03"'),
  ('KAM_THRESHOLD_DAYS',             '"180"')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value;

