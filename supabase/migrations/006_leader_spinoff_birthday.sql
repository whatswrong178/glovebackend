-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 006 — Leader Performance Engine + Spinoff System + Birthday RPCs
-- MediGlove ERP · EPIC-02 / T-02.2 + T-02.3 + T-02.4
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION A: Schema Extensions (idempotent ALTER TABLE)
-- ─────────────────────────────────────────────────────────────────────────────

-- T-02.2: Track per-Leader bonus status flags
-- leader_bonus_active = FALSE when stripped after 2 consecutive monthly fails
-- spinoff_right_active = FALSE when 0.5% legacy right is also revoked
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS leader_bonus_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS spinoff_right_active  BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN staff.leader_bonus_active  IS
  'FALSE = Leader forfeited 1% mgmt bonus after ≥2 consecutive monthly underperformance';
COMMENT ON COLUMN staff.spinoff_right_active IS
  'FALSE = Leader forfeited 0.5% spinoff legacy right after ≥2 consecutive fails';

-- T-02.3: Track spinoff eligibility threshold per Sales (avoids re-querying all invoices)
-- Not strictly required (we query live), but used for caching the approval status.
ALTER TABLE spinoff_legacy_map
  ADD COLUMN IF NOT EXISTS approved_by   UUID REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gmv_at_split  NUMERIC(14,2);

COMMENT ON COLUMN spinoff_legacy_map.gmv_at_split IS
  'Cumulative GMV of protege at the moment of spinoff — audit trail';

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION B: T-02.2 — Leader Monthly Performance Evaluation
-- ─────────────────────────────────────────────────────────────────────────────

-- ── B1. fn_evaluate_leader_month(p_year, p_month)
--    Called by Admin (via Dashboard button or scheduled job / Make.com timer).
--    For each Active Leader:
--      1. Sums their PERSONAL invoices for the month (created_by = leader, status != Cancelled)
--      2. Fetches the applicable threshold (50k standard, or 35k if exempted this month)
--      3. Upserts leader_performance_log
--      4. If consecutive_fails >= 2: strips mgmt bonus + spinoff right
--      5. If they PASS after previous fails: resets consecutive_fails, restores bonuses
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_evaluate_leader_month(
  p_year  INTEGER,
  p_month INTEGER
)
RETURNS TABLE (
  leader_id        UUID,
  leader_name      TEXT,
  personal_gmv     NUMERIC(14,2),
  threshold_used   NUMERIC(14,2),
  passed           BOOLEAN,
  consecutive_fails INTEGER,
  bonus_stripped   BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_standard_threshold NUMERIC(14,2);
  v_minimum_threshold  NUMERIC(14,2);
  v_rec                RECORD;
  v_gmv                NUMERIC(14,2);
  v_is_exempted        BOOLEAN;
  v_threshold          NUMERIC(14,2);
  v_passed             BOOLEAN;
  v_prev_log           leader_performance_log%ROWTYPE;
  v_new_consec_fails   INTEGER;
  v_bonus_stripped     BOOLEAN;
BEGIN
  -- ── Guard: only Admin can call this function ──────────────────────────────
  IF (SELECT role FROM staff WHERE auth_user_id = auth.uid()) NOT IN ('Admin') THEN
    RAISE EXCEPTION 'permission_denied: only Admin can run leader evaluation';
  END IF;

  -- ── Load thresholds from system_params ────────────────────────────────────
  SELECT (value #>> '{}')::NUMERIC INTO v_standard_threshold
    FROM system_params WHERE key = 'leader_standard_threshold';
  SELECT (value #>> '{}')::NUMERIC INTO v_minimum_threshold
    FROM system_params WHERE key = 'leader_minimum_threshold';

  -- ── Loop every Active Leader ──────────────────────────────────────────────
  FOR v_rec IN
    SELECT id, name FROM staff WHERE role = 'Leader' AND status = 'Active'
  LOOP
    -- Personal GMV: invoices created BY this Leader for the given month
    -- Excludes Cancelled invoices; includes Active + Paid (per business rule: count billed, not just collected)
    SELECT COALESCE(SUM(total_amount), 0)
    INTO   v_gmv
    FROM   invoices
    WHERE  created_by = v_rec.id
      AND  status    != 'Cancelled'
      AND  EXTRACT(YEAR  FROM created_at) = p_year
      AND  EXTRACT(MONTH FROM created_at) = p_month;

    -- Check if Admin pre-granted a 35k exemption for this leader+month
    SELECT is_exempted INTO v_is_exempted
      FROM leader_performance_log
     WHERE staff_id  = v_rec.id
       AND log_year  = p_year
       AND log_month = p_month;

    v_is_exempted := COALESCE(v_is_exempted, FALSE);
    v_threshold   := CASE WHEN v_is_exempted THEN v_minimum_threshold
                          ELSE v_standard_threshold END;
    v_passed      := v_gmv >= v_threshold;

    -- Fetch previous log entry to carry forward consecutive_fails
    SELECT * INTO v_prev_log
      FROM leader_performance_log
     WHERE staff_id  = v_rec.id
       AND (log_year < p_year OR (log_year = p_year AND log_month < p_month))
     ORDER BY log_year DESC, log_month DESC
     LIMIT 1;

    IF v_passed THEN
      -- PASS: reset streak regardless of history
      v_new_consec_fails := 0;
      v_bonus_stripped   := FALSE;

      -- Restore bonuses if they were previously stripped (Leader recovered)
      UPDATE staff
         SET leader_bonus_active  = TRUE,
             spinoff_right_active = TRUE
       WHERE id = v_rec.id
         AND (leader_bonus_active = FALSE OR spinoff_right_active = FALSE);

    ELSE
      -- FAIL: increment streak
      v_new_consec_fails := COALESCE(v_prev_log.consecutive_fails, 0) + 1;

      IF v_new_consec_fails >= 2 THEN
        -- Strip management bonus + spinoff right
        UPDATE staff
           SET leader_bonus_active  = FALSE,
               spinoff_right_active = FALSE
         WHERE id = v_rec.id;
        v_bonus_stripped := TRUE;
      ELSE
        v_bonus_stripped := FALSE;
      END IF;
    END IF;

    -- Upsert this month's log (INSERT on first eval, UPDATE on re-run)
    INSERT INTO leader_performance_log
      (staff_id, log_month, log_year, personal_gmv, threshold_used,
       is_exempted, passed, consecutive_fails)
    VALUES
      (v_rec.id, p_month, p_year, v_gmv, v_threshold,
       v_is_exempted, v_passed, v_new_consec_fails)
    ON CONFLICT (staff_id, log_month, log_year) DO UPDATE
      SET personal_gmv      = EXCLUDED.personal_gmv,
          threshold_used    = EXCLUDED.threshold_used,
          passed            = EXCLUDED.passed,
          consecutive_fails = EXCLUDED.consecutive_fails;
          -- NOTE: is_exempted intentionally NOT overwritten — Admin exemption persists

    -- Return row for caller to display
    leader_id         := v_rec.id;
    leader_name       := v_rec.name;
    personal_gmv      := v_gmv;
    threshold_used    := v_threshold;
    passed            := v_passed;
    consecutive_fails := v_new_consec_fails;
    bonus_stripped    := v_bonus_stripped;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ── B2. fn_grant_leader_exemption(p_leader_id, p_year, p_month)
--    Admin-only. Pre-marks a leader's upcoming month with 35k threshold.
--    Must be called BEFORE fn_evaluate_leader_month for that month.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_grant_leader_exemption(
  p_leader_id UUID,
  p_year      INTEGER,
  p_month     INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_threshold NUMERIC(14,2);
  v_leader_name   TEXT;
BEGIN
  -- Admin guard
  IF (SELECT role FROM staff WHERE auth_user_id = auth.uid()) NOT IN ('Admin') THEN
    RAISE EXCEPTION 'permission_denied: only Admin can grant exemptions';
  END IF;

  -- Validate leader exists and is a Leader
  SELECT name INTO v_leader_name
    FROM staff
   WHERE id = p_leader_id AND role = 'Leader' AND status = 'Active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target is not an Active Leader');
  END IF;

  -- Fetch minimum threshold
  SELECT (value #>> '{}')::NUMERIC INTO v_min_threshold
    FROM system_params WHERE key = 'leader_minimum_threshold';

  -- Upsert: create or update the log row with exemption flag
  INSERT INTO leader_performance_log
    (staff_id, log_month, log_year, personal_gmv, threshold_used, is_exempted, passed, consecutive_fails)
  VALUES
    (p_leader_id, p_month, p_year, 0, v_min_threshold, TRUE, FALSE, 0)
  ON CONFLICT (staff_id, log_month, log_year) DO UPDATE
    SET is_exempted    = TRUE,
        threshold_used = v_min_threshold;

  RETURN jsonb_build_object(
    'success',      true,
    'leader_name',  v_leader_name,
    'threshold',    v_min_threshold,
    'month',        p_month,
    'year',         p_year
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION C: T-02.3 — Spinoff伯乐引擎
-- ─────────────────────────────────────────────────────────────────────────────

-- ── C1. fn_request_spinoff(p_sales_id)
--    Called by Admin after the Sales member requests to spin off.
--    Validates cumulative paid GMV >= 50k, locks legacy map, promotes to Leader.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_request_spinoff(p_sales_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role   TEXT;
  v_sales         staff%ROWTYPE;
  v_mentor_id     UUID;
  v_cumulative_gmv NUMERIC(14,2);
  v_spinoff_threshold NUMERIC(14,2) := 50000;
  v_legacy_pct    NUMERIC(6,4);
BEGIN
  -- ── Admin guard ───────────────────────────────────────────────────────────
  SELECT role INTO v_caller_role
    FROM staff WHERE auth_user_id = auth.uid();

  IF v_caller_role NOT IN ('Admin') THEN
    RAISE EXCEPTION 'permission_denied: only Admin can approve spinoffs';
  END IF;

  -- ── Validate protege ──────────────────────────────────────────────────────
  SELECT * INTO v_sales FROM staff WHERE id = p_sales_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staff not found');
  END IF;

  IF v_sales.status != 'Active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staff is not Active');
  END IF;

  IF v_sales.role != 'Sales' THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Cannot spinoff: staff role is %s (must be Sales)', v_sales.role));
  END IF;

  -- ── Check cumulative paid GMV ─────────────────────────────────────────────
  SELECT COALESCE(SUM(total_amount), 0) INTO v_cumulative_gmv
    FROM invoices
   WHERE created_by = p_sales_id
     AND status     = 'Paid';

  IF v_cumulative_gmv < v_spinoff_threshold THEN
    RETURN jsonb_build_object(
      'success',     false,
      'error',       format('Insufficient cumulative GMV: RM%.2f / RM%.2f required',
                            v_cumulative_gmv, v_spinoff_threshold),
      'current_gmv', v_cumulative_gmv,
      'required_gmv',v_spinoff_threshold
    );
  END IF;

  -- ── Guard: already spun off? ──────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM spinoff_legacy_map WHERE protege_id = p_sales_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staff has already been spun off');
  END IF;

  -- ── Capture mentor before unlinking ───────────────────────────────────────
  v_mentor_id := v_sales.leader_id;

  IF v_mentor_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Sales has no assigned Leader — cannot create spinoff legacy link');
  END IF;

  -- Validate mentor is still an active Leader with spinoff_right_active
  IF NOT EXISTS (
    SELECT 1 FROM staff
     WHERE id    = v_mentor_id
       AND status = 'Active'
       AND role   IN ('Leader','Admin')
       AND spinoff_right_active = TRUE
  ) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Mentor has lost spinoff right or is no longer active — cannot create legacy link');
  END IF;

  -- Fetch legacy percentage
  SELECT (value #>> '{}')::NUMERIC INTO v_legacy_pct
    FROM system_params WHERE key = 'spinoff_legacy_pct';

  -- ── Execute spinoff ───────────────────────────────────────────────────────
  -- 1. Lock spinoff legacy map
  INSERT INTO spinoff_legacy_map (mentor_id, protege_id, approved_by, approved_at, gmv_at_split)
  VALUES (
    v_mentor_id,
    p_sales_id,
    (SELECT id FROM staff WHERE auth_user_id = auth.uid()),
    NOW(),
    v_cumulative_gmv
  );

  -- 2. Promote Sales → Leader, unlink from their old leader
  UPDATE staff
     SET role      = 'Leader',
         leader_id = NULL
   WHERE id = p_sales_id;

  RETURN jsonb_build_object(
    'success',        true,
    'protege_name',   v_sales.name,
    'mentor_id',      v_mentor_id,
    'gmv_at_split',   v_cumulative_gmv,
    'legacy_pct',     v_legacy_pct,
    'message',        format('%s has been promoted to Leader. Mentor retains %.1f%% legacy commission.',
                             v_sales.name, v_legacy_pct * 100)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION D: T-02.4 — Birthday & Anniversary Celebrant RPCs
-- ─────────────────────────────────────────────────────────────────────────────

-- ── D1. fn_get_birthday_celebrants(p_date)
--    Returns Active staff whose birthday falls on p_date (month+day match).
--    Used by Make.com HTTP module → Supabase → Resend birthday email.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_get_birthday_celebrants(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  staff_id   UUID,
  name       TEXT,
  email      TEXT,
  department TEXT,
  job_title  TEXT,
  birth_year INTEGER,  -- for "Happy Nth Birthday" copy
  age        INTEGER
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    id                            AS staff_id,
    s.name,
    s.email,
    s.department,
    s.job_title,
    EXTRACT(YEAR FROM birthday)::INTEGER  AS birth_year,
    (EXTRACT(YEAR FROM p_date) - EXTRACT(YEAR FROM birthday))::INTEGER AS age
  FROM staff s
  WHERE
    status  = 'Active'
    AND birthday IS NOT NULL
    AND EXTRACT(MONTH FROM birthday) = EXTRACT(MONTH FROM p_date)
    AND EXTRACT(DAY   FROM birthday) = EXTRACT(DAY   FROM p_date)
  ORDER BY name;
$$;

-- ── D2. fn_get_anniversary_celebrants(p_date)
--    Returns Active staff whose work anniversary falls on p_date.
--    Excludes first day on the job (join_date = p_date means day 0, not year 1).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_get_anniversary_celebrants(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  staff_id      UUID,
  name          TEXT,
  email         TEXT,
  department    TEXT,
  job_title     TEXT,
  years_served  INTEGER
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    id                AS staff_id,
    s.name,
    s.email,
    s.department,
    s.job_title,
    (EXTRACT(YEAR FROM p_date) - EXTRACT(YEAR FROM join_date))::INTEGER AS years_served
  FROM staff s
  WHERE
    status  = 'Active'
    AND join_date IS NOT NULL
    AND EXTRACT(MONTH FROM join_date) = EXTRACT(MONTH FROM p_date)
    AND EXTRACT(DAY   FROM join_date) = EXTRACT(DAY   FROM p_date)
    AND join_date < p_date  -- exclude same-day (day 0 = not an anniversary yet)
  ORDER BY years_served DESC, name;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION E: T-02.4 — HR Email Templates (birthday + anniversary)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO email_templates (name, subject, html_body)
VALUES (
  'staff_birthday',
  '🎂 Happy Birthday, {{StaffName}}! From MediGlove Family',
  '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Happy Birthday</title>
  <style>
    body { margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .hero { background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%); padding: 40px 32px; text-align: center; }
    .hero-emoji { font-size: 56px; line-height: 1; }
    .hero h1 { color: #ffffff; font-size: 26px; font-weight: 700; margin: 12px 0 0; }
    .body { padding: 32px; }
    .body p { color: #374151; font-size: 15px; line-height: 1.7; margin: 0 0 16px; }
    .highlight { display: inline-block; background: #ede9fe; color: #5b21b6; padding: 2px 8px; border-radius: 6px; font-weight: 600; }
    .footer { background: #f3f4f6; padding: 16px 32px; text-align: center; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="hero">
      <div class="hero-emoji">🎂</div>
      <h1>Happy Birthday!</h1>
    </div>
    <div class="body">
      <p>Dear <strong>{{StaffName}}</strong>,</p>
      <p>
        On behalf of the entire MediGlove family, we wish you a wonderful
        <span class="highlight">{{Age}}th Birthday</span>! 🎉
      </p>
      <p>
        Your dedication, hard work, and positive energy make our team stronger every day.
        We are truly grateful to have you with us in the <strong>{{Department}}</strong> team.
      </p>
      <p>
        May this year bring you joy, good health, and many reasons to celebrate.
        Here''s to another incredible year ahead!
      </p>
      <p>With warmest wishes,<br /><strong>MediGlove HR Team</strong></p>
    </div>
    <div class="footer">
      MediGlove Supply · care@yourdomain.com<br />
      &copy; {{CurrentYear}} MediGlove. All rights reserved.
    </div>
  </div>
</body>
</html>'
)
ON CONFLICT (name) DO UPDATE
  SET subject   = EXCLUDED.subject,
      html_body = EXCLUDED.html_body,
      updated_at = NOW();

INSERT INTO email_templates (name, subject, html_body)
VALUES (
  'staff_anniversary',
  '🏆 {{YearsServed}} Year{{YearsSuffix}} with MediGlove — Thank You, {{StaffName}}!',
  '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Work Anniversary</title>
  <style>
    body { margin: 0; padding: 0; background: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    .hero { background: linear-gradient(135deg, #d97706 0%, #dc2626 100%); padding: 40px 32px; text-align: center; }
    .hero-emoji { font-size: 56px; line-height: 1; }
    .hero h1 { color: #ffffff; font-size: 26px; font-weight: 700; margin: 12px 0 0; }
    .hero .years { color: #fef3c7; font-size: 16px; margin: 6px 0 0; }
    .body { padding: 32px; }
    .body p { color: #374151; font-size: 15px; line-height: 1.7; margin: 0 0 16px; }
    .milestone { display: inline-block; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 6px; font-weight: 600; }
    .footer { background: #f3f4f6; padding: 16px 32px; text-align: center; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="hero">
      <div class="hero-emoji">🏆</div>
      <h1>{{YearsServed}} Year{{YearsSuffix}} Together!</h1>
      <p class="years">Work Anniversary Milestone</p>
    </div>
    <div class="body">
      <p>Dear <strong>{{StaffName}}</strong>,</p>
      <p>
        Today marks your <span class="milestone">{{YearsServed}}-year work anniversary</span> at MediGlove!
        What an incredible milestone. 🎊
      </p>
      <p>
        As part of our <strong>{{Department}}</strong> team, you have contributed enormously to our
        growth and success. Your commitment over these {{YearsServed}} year{{YearsSuffix}} has not
        gone unnoticed, and we are deeply grateful for everything you bring to the table.
      </p>
      <p>
        Here''s to more milestones, more achievements, and many more years of excellence together.
        Thank you for being a vital part of the MediGlove journey!
      </p>
      <p>With appreciation,<br /><strong>MediGlove HR Team</strong></p>
    </div>
    <div class="footer">
      MediGlove Supply · care@yourdomain.com<br />
      &copy; {{CurrentYear}} MediGlove. All rights reserved.
    </div>
  </div>
</body>
</html>'
)
ON CONFLICT (name) DO UPDATE
  SET subject   = EXCLUDED.subject,
      html_body = EXCLUDED.html_body,
      updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION F: RLS for new columns (inherit existing staff RLS — no new tables)
-- The fn_evaluate_leader_month and fn_grant_leader_exemption RPCs perform their
-- own auth.uid() role-check inside the function body (SECURITY DEFINER pattern).
-- fn_get_birthday_celebrants / fn_get_anniversary_celebrants are callable by
-- any authenticated user (Make.com uses SUPABASE_SERVICE_ROLE_KEY via HTTP).
-- ─────────────────────────────────────────────────────────────────────────────

-- Grant execute to service_role so Make.com can call RPCs without JWT
GRANT EXECUTE ON FUNCTION fn_get_birthday_celebrants(DATE)  TO service_role;
GRANT EXECUTE ON FUNCTION fn_get_anniversary_celebrants(DATE) TO service_role;
-- evaluate/grant_exemption are Admin-only — authenticated role only
GRANT EXECUTE ON FUNCTION fn_evaluate_leader_month(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_grant_leader_exemption(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_request_spinoff(UUID) TO authenticated;
