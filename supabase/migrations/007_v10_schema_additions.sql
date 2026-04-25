-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 007 — v10 Schema Additions (Ultimate Merged Edition)
-- MediGlove ERP · v10.0 Upgrade
--
-- Adds all columns required by v10 spec that were absent from migrations 001-006.
-- Every DDL statement uses IF NOT EXISTS / ON CONFLICT guards — fully idempotent.
--
-- Sections:
--   A. staff      — phone, hire_date, base_salary, commission_rate_override,
--                   updated_at, consecutive_fail_months, leader_frozen,
--                   permission_switches, mentor_id
--   B. invoices   — co_created_by, is_joint_order, neglect_split, total_boxes
--   C. clients    — tier1_claimed … tier4_claimed, total_revenue
--   D. system_params — v10 missing keys
--   E. updated_at auto-trigger on staff
-- ══════════════════════════════════════════════════════════════════════════════

-- ── A. STAFF — v10 column additions ─────────────────────────────────────────

-- A.1 Contact & compensation fields (referenced by staff.ts, missing from 001)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS phone                     TEXT,
  ADD COLUMN IF NOT EXISTS hire_date                 DATE         NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS base_salary               NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS commission_rate_override  NUMERIC(6,4),  -- e.g. 0.0350 = 3.50%
  ADD COLUMN IF NOT EXISTS updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW();

COMMENT ON COLUMN staff.hire_date                IS 'ISO date of employment start';
COMMENT ON COLUMN staff.commission_rate_override  IS 'Per-staff commission rate override; NULL = use system default';
COMMENT ON COLUMN staff.updated_at               IS 'Auto-updated by trg_staff_updated_at trigger';

-- A.2 Leader health tracking fields (v10 Death Line state machine)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS consecutive_fail_months  INTEGER      NOT NULL DEFAULT 0
                                                     CHECK (consecutive_fail_months >= 0),
  ADD COLUMN IF NOT EXISTS leader_frozen            BOOLEAN      NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN staff.consecutive_fail_months IS 'Months Leader missed GMV threshold consecutively; resets on pass';
COMMENT ON COLUMN staff.leader_frozen           IS 'TRUE when >= 2 consecutive fails; freezes Leader Override + Mentor Reward';

-- A.3 Composite permission switches (v10 RBAC extension)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS permission_switches  JSONB  NOT NULL DEFAULT '{}'::JSONB;

COMMENT ON COLUMN staff.permission_switches IS
  'Granular capability overrides, e.g. {"allowDelivery": true, "allowSampleApproval": false}';

-- A.4 Mentor linkage (v10 Spin-off — records who coached this Leader)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS mentor_id  UUID  REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN staff.mentor_id IS
  'FK → staff.id of original Leader who coached this staff member before spin-off. NULL for non-mentored staff.';

CREATE INDEX IF NOT EXISTS idx_staff_mentor_id ON staff(mentor_id) WHERE mentor_id IS NOT NULL;

-- ── B. INVOICES — v10 column additions ──────────────────────────────────────

-- B.1 Joint Order co-creator (50/50 HR代开单 flow)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS co_created_by   UUID     REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_joint_order  BOOLEAN  NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN invoices.co_created_by  IS 'HR & Finance staff ID when isJointOrder=true; commission splits 50/50';
COMMENT ON COLUMN invoices.is_joint_order IS 'TRUE = HR代开单; Base commission split 50/50 between owner and co_created_by';

-- Constraint: co_created_by must be present when is_joint_order is TRUE
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_joint_order_requires_co_creator;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_joint_order_requires_co_creator
    CHECK (is_joint_order = FALSE OR co_created_by IS NOT NULL);

-- B.2 Neglect Index commission split snapshot (Tug-of-War audit trail)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS neglect_split  JSONB;

COMMENT ON COLUMN invoices.neglect_split IS
  'Snapshot of tug-of-war split at invoice creation time. '
  'Format: {"neglectIndex": 2, "ownerShare": 0.40, "invoicerShare": 0.60, '
  '"ownerId": "<uuid>", "invocerId": "<uuid>", "ownershipTransferred": false}. '
  'NULL when createdBy == client.owner_id (no split).';

-- B.3 Total boxes (Promo Engine gate: min 3 boxes, free shipping >= 5 boxes)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS total_boxes  INTEGER  NOT NULL DEFAULT 0
                                         CHECK (total_boxes >= 0);

COMMENT ON COLUMN invoices.total_boxes IS
  'Sum of all invoice_items.qty. Must be >= 3 (Promo Engine enforced). >= 5 + West Malaysia → delivery_charge = 0.';

CREATE INDEX IF NOT EXISTS idx_invoices_co_created_by ON invoices(co_created_by) WHERE co_created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_is_joint_order ON invoices(is_joint_order) WHERE is_joint_order = TRUE;

-- ── C. CLIENTS — v10 Bounty tier claim tracking + cumulative revenue ─────────

-- C.1 Four-tier bounty claim flags (each redeemable once per new client)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tier1_claimed  BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tier2_claimed  BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tier3_claimed  BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tier4_claimed  BOOLEAN  NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN clients.tier1_claimed IS 'Bounty Tier 1 (first order >= 3 boxes → RM 50) claimed flag';
COMMENT ON COLUMN clients.tier2_claimed IS 'Bounty Tier 2 (90d cumulative >= RM 1,000 → RM 50) claimed flag';
COMMENT ON COLUMN clients.tier3_claimed IS 'Bounty Tier 3 (180d cumulative >= RM 2,000 → RM 100) claimed flag';
COMMENT ON COLUMN clients.tier4_claimed IS 'Bounty Tier 4 (365d cumulative >= RM 6,000 → RM 200) claimed flag';

-- C.2 Cumulative revenue (used for bounty window calculations)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS total_revenue  NUMERIC(14,2)  NOT NULL DEFAULT 0
                                           CHECK (total_revenue >= 0);

COMMENT ON COLUMN clients.total_revenue IS
  'Running sum of all Paid invoice totals for this client. Updated by commission settlement cron.';

-- ── D. SYSTEM PARAMS — v10 missing keys ─────────────────────────────────────
-- Uses ON CONFLICT DO UPDATE to overwrite stale values on re-run.

INSERT INTO system_params (key, value) VALUES
  -- Leader Death Line (v10: 2 consecutive months triggers freeze)
  ('leader_death_line_months',  '"2"'),

  -- Mentor Reward Rate: 0.5% of mentee team Net Revenue, permanently
  ('mentor_reward_rate',        '"0.005"'),

  -- A-class product revenue ratio health threshold for Step Bonus
  ('a_ratio_threshold',         '"0.70"'),

  -- Bounty: Tier 1 changed in v10 from "RM 500 first order" to "3 boxes first order"
  -- bounty_first_order (RM 50 reward) already seeded in 001; add min-boxes qualifier:
  ('bounty_tier1_min_boxes',    '"3"'),

  -- Maximum cumulative bounty per new client (50+50+100+200 = RM 400)
  ('bounty_max',                '"400"'),

  -- Spinoff threshold: Sales cumulative PAID GMV to qualify for spin-off
  ('spinoff_threshold',         '"50000"'),

  -- Ladder matrix: JSON array of {tier, threshold, reward}
  ('ladder_matrix', '[
    {"tier": "Starter",  "threshold": 0,      "reward": 0},
    {"tier": "Bronze",   "threshold": 10000,  "reward": 0},
    {"tier": "Silver",   "threshold": 20000,  "reward": 400},
    {"tier": "Gold",     "threshold": 50000,  "reward": 1000},
    {"tier": "Platinum", "threshold": 120000, "reward": 2500},
    {"tier": "Diamond",  "threshold": 200000, "reward": 4000}
  ]')
ON CONFLICT (key) DO UPDATE
  SET value      = EXCLUDED.value,
      updated_at = NOW();

-- ── E. updated_at auto-trigger for staff ────────────────────────────────────

-- Generic updated_at refresh function (shared across tables)
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_updated_at ON staff;
CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_updated_at();

-- ── F. Indexes for new columns ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_staff_leader_frozen     ON staff(leader_frozen) WHERE leader_frozen = TRUE;
CREATE INDEX IF NOT EXISTS idx_clients_tier1_claimed   ON clients(tier1_claimed) WHERE tier1_claimed = FALSE;
CREATE INDEX IF NOT EXISTS idx_clients_total_revenue   ON clients(total_revenue);

-- ── Verification markers ─────────────────────────────────────────────────────
-- consecutive_fail_months, leader_frozen, permission_switches, mentor_id
-- co_created_by, is_joint_order, neglect_split, total_boxes
-- tier1_claimed, tier2_claimed, tier3_claimed, tier4_claimed, total_revenue
-- leader_death_line_months, mentor_reward_rate, a_ratio_threshold, bounty_max
