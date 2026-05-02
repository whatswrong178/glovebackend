-- ══════════════════════════════════════════════════════════════════════════════
-- 024_needs_assessments.sql
-- MediGlove ERP — Customer Needs Assessment feature
--
-- Creates:
--   1. needs_assessments  — stores all form responses + auto-linked client_id
--   2. RLS policies       — Sales/Leader: own records; Admin/HR: all
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS needs_assessments (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to auto-created/found client (nullable: set after upsert)
  client_id         UUID          REFERENCES clients(id) ON DELETE SET NULL,
  -- Who submitted the form
  created_by        UUID          NOT NULL REFERENCES staff(id),

  -- ── Header fields ──────────────────────────────────────────────────────────
  visit_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  shop_name         TEXT          NOT NULL,
  contact_name      TEXT,
  contact_whatsapp  TEXT,
  contact_email     TEXT,
  contact_address   TEXT,
  region            TEXT          NOT NULL
                                  CHECK (region IN ('West Malaysia','East Malaysia')),

  -- ── S1: Industry ───────────────────────────────────────────────────────────
  industry          TEXT,

  -- ── S2: Usage ──────────────────────────────────────────────────────────────
  monthly_usage     TEXT,                   -- single selection label
  glove_types       TEXT[]  DEFAULT '{}',   -- multi-select
  glove_sizes       TEXT[]  DEFAULT '{}',   -- multi-select

  -- ── S3: Procurement ────────────────────────────────────────────────────────
  supplier_sources  TEXT[]  DEFAULT '{}',   -- multi-select
  price_range       TEXT,                   -- e.g. "RM 15 – 18"
  reorder_timing    TEXT,                   -- single selection label

  -- ── S4: Pain points ────────────────────────────────────────────────────────
  pain_points       TEXT[]  DEFAULT '{}',   -- multi-select
  priorities        TEXT[]  DEFAULT '{}',   -- multi-select

  -- ── S5: Switch willingness ─────────────────────────────────────────────────
  switch_conditions TEXT[]  DEFAULT '{}',   -- multi-select
  decision_maker    TEXT,
  satisfaction      SMALLINT CHECK (satisfaction BETWEEN 1 AND 5),

  -- ── S6: Next actions ───────────────────────────────────────────────────────
  next_reorder      TEXT,
  today_actions     TEXT[]  DEFAULT '{}',   -- multi-select
  sales_notes       TEXT,

  -- ── Computed by analyzeNeeds() ─────────────────────────────────────────────
  lead_score        SMALLINT CHECK (lead_score BETWEEN 0 AND 100),
  lead_temperature  TEXT CHECK (lead_temperature IN ('Hot','Warm','Cold')),

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  needs_assessments IS 'Sales visit needs-assessment form responses; auto-links to clients.';
COMMENT ON COLUMN needs_assessments.client_id IS 'Populated after upsert: find-or-create client by shop_name+owner.';
COMMENT ON COLUMN needs_assessments.lead_score IS '0–100 computed from analyzeNeeds(); ≥70=Hot, 40–69=Warm, <40=Cold.';

-- ── 2. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_na_created_by  ON needs_assessments(created_by);
CREATE INDEX IF NOT EXISTS idx_na_client_id   ON needs_assessments(client_id);
CREATE INDEX IF NOT EXISTS idx_na_visit_date  ON needs_assessments(visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_na_temperature ON needs_assessments(lead_temperature);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE needs_assessments ENABLE ROW LEVEL SECURITY;

-- Sales/Leader: see only their own assessments
CREATE POLICY "na_select_own" ON needs_assessments
  FOR SELECT USING (
    created_by = (
      SELECT id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role IN ('Admin','HR')
    )
  );

-- Anyone authenticated can insert their own record
CREATE POLICY "na_insert_own" ON needs_assessments
  FOR INSERT WITH CHECK (
    created_by = (
      SELECT id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1
    )
  );

-- Owner or Admin/HR can update
CREATE POLICY "na_update_own" ON needs_assessments
  FOR UPDATE USING (
    created_by = (
      SELECT id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role IN ('Admin','HR')
    )
  );

-- Admin/HR only can delete
CREATE POLICY "na_delete_admin" ON needs_assessments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE auth_user_id = auth.uid()
        AND role IN ('Admin','HR')
    )
  );
