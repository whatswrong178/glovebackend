-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 008 — Tug-of-War Engine + First-Blood Claim + Leader Freeze Patch
-- MediGlove ERP · EPIC-04 / T-04.4 / T-04.5 / T-06.5 / T-06.7
--
-- Sections:
--   A. fn_first_blood_claim()       — orphan client auto-takeover on invoice insert
--   B. trg_aa_first_blood           — AFTER INSERT ON invoices (fires FIRST, alpha order)
--   C. fn_neglect_index_update()    — Tug-of-War state machine (Index 0→6, force transfer at 6)
--   D. trg_bb_neglect_index         — AFTER INSERT ON invoices (fires SECOND, alpha order)
--   E. fn_evaluate_leader_month()   — PATCH: also writes consecutive_fail_months + leader_frozen
--                                     back to staff table (EPIC-02 gap vs v10 spec)
--   F. GRANTs
--   G. fn_request_spinoff()         — PATCH: also writes mentor_id to staff table on promotion
--                                     (mentor_id column added in Migration 007; 006 predates it)
--
-- Trigger naming convention:
--   trg_aa_* fires before trg_bb_* (PostgreSQL alphabetical trigger execution order).
--   This guarantees First-Blood runs before Neglect-Index so a newly-claimed orphan
--   client exits with neglect_index=0 and owner_id=invoicer — causing the Neglect
--   trigger to see createdBy==owner and correctly skip splitting.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── A. fn_first_blood_claim() ────────────────────────────────────────────────
--
-- Fires when a new Invoice is inserted for an is_orphan=TRUE client.
-- Transfers Client ownership to the invoicer, resets orphan state and neglect_index.
-- Does NOT split commission (100%归 new Owner by virtue of being the invoicer).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_first_blood_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_orphan   BOOLEAN;
  v_old_owner   UUID;
BEGIN
  -- ── Guard: only act on orphan clients ──────────────────────────────────────
  SELECT is_orphan, owner_id
  INTO   v_is_orphan, v_old_owner
  FROM   clients
  WHERE  id = NEW.client_id;

  IF NOT v_is_orphan THEN
    RETURN NEW;  -- Non-orphan: skip, let Neglect trigger handle it
  END IF;

  -- ── Execution: Transfer ownership to invoicer ─────────────────────────────
  -- Step 1: Set new owner = invoicer; clear orphan flag; reset neglect chain
  UPDATE clients
  SET
    owner_id      = NEW.created_by,
    is_orphan     = FALSE,
    neglect_index = 0,
    last_assisted_by = NEW.created_by
  WHERE id = NEW.client_id;

  -- Step 2: Record the split in invoice.neglect_split for audit completeness
  -- (100% to new owner — no split, but snapshot the takeover event)
  UPDATE invoices
  SET neglect_split = jsonb_build_object(
    'event',               'first_blood_claim',
    'previousOwnerId',     v_old_owner,
    'newOwnerId',          NEW.created_by,
    'ownerShare',          1.0,
    'invoicerShare',       1.0,
    'neglectIndex',        0,
    'ownershipTransferred', TRUE
  )
  WHERE id = NEW.id;

  RAISE LOG
    '[FirstBlood] invoice_id=% client_id=% prev_owner=% new_owner=%',
    NEW.id, NEW.client_id, v_old_owner, NEW.created_by;

  RETURN NEW;
END;
$$;

-- ── B. Trigger: trg_aa_first_blood ───────────────────────────────────────────
-- Named trg_aa_* to ensure it fires BEFORE trg_bb_neglect_index (alpha order).

DROP TRIGGER IF EXISTS trg_aa_first_blood ON invoices;
CREATE TRIGGER trg_aa_first_blood
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_first_blood_claim();

-- ── C. fn_neglect_index_update() ─────────────────────────────────────────────
--
-- Tug-of-War state machine for non-orphan clients.
-- Runs AFTER fn_first_blood_claim (which normalizes orphan state first).
--
-- State transitions:
--   Non-owner opens invoice  → neglect_index = MIN(index + 1, 6)
--     index == 6             → force transfer ownership to invoicer, reset to 0
--   Owner opens invoice      → neglect_index = MAX(index - 1, 0) (service debt redemption)
--
-- Commission split ratio table (stored in invoice.neglect_split):
--   Index 0 → 100 : 0    Index 1 → 50 : 50   Index 2 → 40 : 60
--   Index 3 → 30 : 70    Index 4 → 20 : 80   Index 5 → 10 : 90
--   Index 6 → 0 : 100  (force transfer)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_neglect_index_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client          RECORD;
  v_new_index       INTEGER;
  v_owner_share     NUMERIC(4,3);
  v_invoicer_share  NUMERIC(4,3);
  v_transferred     BOOLEAN := FALSE;

  -- Split ratio lookup (index → owner_share)
  SPLIT_RATIOS CONSTANT NUMERIC[] := ARRAY[1.0, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
BEGIN
  -- ── Re-read client state (First-Blood may have just mutated it) ───────────
  SELECT id, owner_id, is_orphan, neglect_index
  INTO   v_client
  FROM   clients
  WHERE  id = NEW.client_id;

  -- ── Guard 1: orphan clients were handled by First-Blood trigger ───────────
  IF v_client.is_orphan THEN
    RETURN NEW;
  END IF;

  -- ── Guard 2: no split needed if owner is opening their own invoice ────────
  --   (but we still decrement index if > 0 — service debt redemption)
  IF NEW.created_by = v_client.owner_id THEN
    -- Service debt redemption: Owner self-serves → index -1
    IF v_client.neglect_index > 0 THEN
      v_new_index := GREATEST(v_client.neglect_index - 1, 0);
      UPDATE clients
      SET neglect_index = v_new_index
      WHERE id = NEW.client_id;

      -- Owner gets 100% (they are the invoicer), record redemption event
      UPDATE invoices
      SET neglect_split = jsonb_build_object(
        'event',                'service_debt_redemption',
        'neglectIndexBefore',   v_client.neglect_index,
        'neglectIndexAfter',    v_new_index,
        'ownerId',              v_client.owner_id,
        'invocerId',            NEW.created_by,
        'ownerShare',           1.0,
        'invoicerShare',        1.0,
        'ownershipTransferred', FALSE
      )
      WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- ── Non-owner opening invoice: increment neglect index ────────────────────
  v_new_index := LEAST(v_client.neglect_index + 1, 6);

  -- Determine split ratios using the post-increment index
  v_owner_share    := SPLIT_RATIOS[v_new_index + 1];  -- +1 because PG arrays are 1-based
  v_invoicer_share := 1.0 - v_owner_share;

  -- ── Force transfer at Index 6 ─────────────────────────────────────────────
  IF v_new_index = 6 THEN
    UPDATE clients
    SET
      owner_id      = NEW.created_by,
      neglect_index = 0,
      last_assisted_by = NEW.created_by
    WHERE id = NEW.client_id;

    v_transferred := TRUE;
    v_new_index   := 0;  -- reset for the snapshot

    RAISE LOG
      '[TugOfWar] OWNERSHIP TRANSFER: client_id=% invoice_id=% old_owner=% new_owner=%',
      NEW.client_id, NEW.id, v_client.owner_id, NEW.created_by;
  ELSE
    -- Normal increment — update index and last_assisted_by
    UPDATE clients
    SET
      neglect_index    = v_new_index,
      last_assisted_by = NEW.created_by
    WHERE id = NEW.client_id;
  END IF;

  -- ── Write split snapshot to invoice.neglect_split ─────────────────────────
  UPDATE invoices
  SET neglect_split = jsonb_build_object(
    'event',                'tug_of_war_split',
    'neglectIndexBefore',   v_client.neglect_index,
    'neglectIndexAfter',    v_new_index,
    'ownerId',              v_client.owner_id,
    'invocerId',            NEW.created_by,
    'ownerShare',           v_owner_share,
    'invoicerShare',        v_invoicer_share,
    'ownershipTransferred', v_transferred
  )
  WHERE id = NEW.id;

  RAISE LOG
    '[TugOfWar] invoice_id=% client_id=% index=%→% owner_share=% invoicer_share=% transferred=%',
    NEW.id, NEW.client_id,
    v_client.neglect_index, v_new_index,
    v_owner_share, v_invoicer_share, v_transferred;

  RETURN NEW;
END;
$$;

-- ── D. Trigger: trg_bb_neglect_index ─────────────────────────────────────────
-- Named trg_bb_* to fire AFTER trg_aa_first_blood (alpha order guarantee).

DROP TRIGGER IF EXISTS trg_bb_neglect_index ON invoices;
CREATE TRIGGER trg_bb_neglect_index
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_neglect_index_update();

-- ── E. fn_evaluate_leader_month() PATCH ──────────────────────────────────────
--
-- EPIC-02 gap: the original Migration 006 version tracked consecutive_fails
-- inside leader_performance_log but did NOT write back to staff.consecutive_fail_months
-- or staff.leader_frozen. This patch replaces the function with the corrected version.
--
-- Changes vs Migration 006:
--   1. After upsert to leader_performance_log, also UPDATE staff SET
--      consecutive_fail_months = v_new_consec_fails,
--      leader_frozen = (v_new_consec_fails >= death_line_months)
--   2. Reads CE.LEADER_DEATH_LINE_MONTHS from system_params (default 2)
--
-- DROP required because Migration 006 defined RETURNS TABLE with a different
-- column set (NUMERIC(14,2) precision, no is_exempted column).
-- CREATE OR REPLACE cannot change the row type; DROP + recreate is the fix.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS fn_evaluate_leader_month(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION fn_evaluate_leader_month(
  p_year  INT,
  p_month INT
)
RETURNS TABLE (
  leader_id          UUID,
  leader_name        TEXT,
  personal_gmv       NUMERIC,
  threshold_used     NUMERIC,
  is_exempted        BOOLEAN,
  passed             BOOLEAN,
  consecutive_fails  INTEGER,
  leader_frozen      BOOLEAN,
  bonus_active       BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_standard_threshold  NUMERIC;
  v_minimum_threshold   NUMERIC;
  v_death_line_months   INTEGER;
  rec                   RECORD;
  v_gmv                 NUMERIC;
  v_is_exempted         BOOLEAN;
  v_effective_threshold NUMERIC;
  v_passed              BOOLEAN;
  v_prev_consec_fails   INTEGER;
  v_new_consec_fails    INTEGER;
  v_is_frozen           BOOLEAN;
  v_bonus_active        BOOLEAN;
BEGIN
  -- ── Load system parameters ────────────────────────────────────────────────
  SELECT (value #>> '{}')::NUMERIC INTO v_standard_threshold
  FROM system_params WHERE key = 'leader_standard_threshold';
  v_standard_threshold := COALESCE(v_standard_threshold, 50000);

  SELECT (value #>> '{}')::NUMERIC INTO v_minimum_threshold
  FROM system_params WHERE key = 'leader_minimum_threshold';
  v_minimum_threshold := COALESCE(v_minimum_threshold, 35000);

  SELECT (value #>> '{}')::INTEGER INTO v_death_line_months
  FROM system_params WHERE key = 'leader_death_line_months';
  v_death_line_months := COALESCE(v_death_line_months, 2);

  -- ── Loop all Active Leaders ───────────────────────────────────────────────
  FOR rec IN
    SELECT s.id, s.name, s.leader_frozen AS currently_frozen,
           s.consecutive_fail_months AS current_consec
    FROM   staff s
    WHERE  s.role   = 'Leader'
    AND    s.status = 'Active'
  LOOP
    -- ── Step 1: Calculate personal GMV (Invoice total, excl. delivery) ─────
    SELECT COALESCE(SUM(i.total_amount - i.delivery_charge), 0)
    INTO   v_gmv
    FROM   invoices i
    WHERE  i.created_by = rec.id
    AND    i.status     != 'Cancelled'
    AND    EXTRACT(YEAR  FROM i.created_at) = p_year
    AND    EXTRACT(MONTH FROM i.created_at) = p_month;

    -- ── Step 2: Check exemption for this period ────────────────────────────
    SELECT COALESCE(lpl.is_exempted, FALSE)
    INTO   v_is_exempted
    FROM   leader_performance_log lpl
    WHERE  lpl.staff_id  = rec.id
    AND    lpl.log_year  = p_year
    AND    lpl.log_month = p_month;
    v_is_exempted := COALESCE(v_is_exempted, FALSE);

    v_effective_threshold := CASE
      WHEN v_is_exempted THEN v_minimum_threshold
      ELSE v_standard_threshold
    END;

    -- ── Step 3: Pass / Fail determination ────────────────────────────────
    v_passed := (v_gmv >= v_effective_threshold);

    -- ── Step 4: Update consecutive_fail_months counter ───────────────────
    v_prev_consec_fails := rec.current_consec;
    v_new_consec_fails  := CASE
      WHEN v_passed THEN 0
      ELSE v_prev_consec_fails + 1
    END;

    -- ── Step 5: Determine frozen state ───────────────────────────────────
    v_is_frozen := (v_new_consec_fails >= v_death_line_months);

    -- ── Step 6: Determine bonus_active ───────────────────────────────────
    -- Bonus is active if: passed OR was previously frozen but just recovered
    -- (Admin manually unfreezes — leader_frozen flag stays until Admin resets it)
    -- Rule: bonus_active = passed AND NOT leader_frozen
    v_bonus_active := v_passed AND NOT v_is_frozen;

    -- ── Step 7: Upsert leader_performance_log ────────────────────────────
    INSERT INTO leader_performance_log (
      staff_id, log_year, log_month,
      personal_gmv, threshold_used,
      is_exempted, passed,
      consecutive_fails
    ) VALUES (
      rec.id, p_year, p_month,
      v_gmv, v_effective_threshold,
      v_is_exempted, v_passed,
      v_new_consec_fails
    )
    ON CONFLICT (staff_id, log_year, log_month) DO UPDATE
      SET personal_gmv      = EXCLUDED.personal_gmv,
          threshold_used    = EXCLUDED.threshold_used,
          passed            = EXCLUDED.passed,
          consecutive_fails = EXCLUDED.consecutive_fails;

    -- ── Step 8: Write back to staff table (PATCH — gap in Migration 006) ──
    UPDATE staff
    SET
      consecutive_fail_months = v_new_consec_fails,
      leader_frozen           = v_is_frozen,
      leader_bonus_active     = v_bonus_active
    WHERE id = rec.id;

    RAISE LOG
      '[LeaderEval] staff_id=% name="%" gmv=% threshold=% passed=% consec_fails=% frozen=%',
      rec.id, rec.name, v_gmv, v_effective_threshold,
      v_passed, v_new_consec_fails, v_is_frozen;

    -- ── Return row ────────────────────────────────────────────────────────
    leader_id         := rec.id;
    leader_name       := rec.name;
    personal_gmv      := v_gmv;
    threshold_used    := v_effective_threshold;
    is_exempted       := v_is_exempted;
    passed            := v_passed;
    consecutive_fails := v_new_consec_fails;
    leader_frozen     := v_is_frozen;
    bonus_active      := v_bonus_active;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ── F. GRANTs ────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION fn_first_blood_claim()                   TO authenticated;
GRANT EXECUTE ON FUNCTION fn_neglect_index_update()                TO authenticated;
GRANT EXECUTE ON FUNCTION fn_evaluate_leader_month(INT, INT)       TO authenticated;


-- ── G. fn_request_spinoff() PATCH ────────────────────────────────────────────
-- Gap: Migration 006 defines fn_request_spinoff but predates the mentor_id
-- column (added in Migration 007). After promotion, staff.mentor_id was NULL.
-- This CREATE OR REPLACE stamps mentor_id = v_mentor_id on the promoted row.
-- All validation logic is identical to Migration 006.
-- Additionally reads spinoff_threshold from system_params (v10 param-driven)
-- instead of the hardcoded 50000 literal in 006.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_request_spinoff(p_sales_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role        TEXT;
  v_sales              staff%ROWTYPE;
  v_mentor_id          UUID;
  v_cumulative_gmv     NUMERIC(14,2);
  v_spinoff_threshold  NUMERIC(14,2);
  v_legacy_pct         NUMERIC(6,4);
BEGIN
  -- ── Admin guard ───────────────────────────────────────────────────────────
  SELECT role INTO v_caller_role
    FROM staff WHERE auth_user_id = auth.uid();

  IF v_caller_role NOT IN ('Admin') THEN
    RAISE EXCEPTION 'permission_denied: only Admin can approve spinoffs';
  END IF;

  -- ── Read spinoff threshold from system_params (v10: param-driven) ─────────
  SELECT (value #>> '{}')::NUMERIC INTO v_spinoff_threshold
    FROM system_params WHERE key = 'spinoff_threshold';
  -- Fallback if param not yet seeded (migration ordering safety net)
  v_spinoff_threshold := COALESCE(v_spinoff_threshold, 50000);

  -- ── Validate protege ──────────────────────────────────────────────────────
  SELECT * INTO v_sales FROM staff WHERE id = p_sales_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staff not found');
  END IF;

  IF v_sales.status != 'Active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staff is not Active');
  END IF;

  IF v_sales.role != 'Sales' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('Cannot spinoff: staff role is %s (must be Sales)', v_sales.role)
    );
  END IF;

  -- ── Check cumulative paid GMV ─────────────────────────────────────────────
  SELECT COALESCE(SUM(total_amount), 0) INTO v_cumulative_gmv
    FROM invoices
   WHERE created_by = p_sales_id
     AND status     = 'Paid';

  IF v_cumulative_gmv < v_spinoff_threshold THEN
    RETURN jsonb_build_object(
      'success',      false,
      'error',        format('Insufficient cumulative GMV: RM%.2f / RM%.2f required',
                              v_cumulative_gmv, v_spinoff_threshold),
      'current_gmv',  v_cumulative_gmv,
      'required_gmv', v_spinoff_threshold
    );
  END IF;

  -- ── Guard: already spun off? ──────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM spinoff_legacy_map WHERE protege_id = p_sales_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Staff has already been spun off');
  END IF;

  -- ── Capture mentor before unlinking ───────────────────────────────────────
  v_mentor_id := v_sales.leader_id;

  IF v_mentor_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Sales has no assigned Leader — cannot create spinoff legacy link'
    );
  END IF;

  -- Validate mentor is still an active Leader/Admin with spinoff_right_active
  IF NOT EXISTS (
    SELECT 1 FROM staff
     WHERE id                  = v_mentor_id
       AND status              = 'Active'
       AND role                IN ('Leader', 'Admin')
       AND spinoff_right_active = TRUE
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Mentor has lost spinoff right or is no longer active — cannot create legacy link'
    );
  END IF;

  -- Fetch legacy percentage
  SELECT (value #>> '{}')::NUMERIC INTO v_legacy_pct
    FROM system_params WHERE key = 'spinoff_legacy_pct';

  -- ── Execute spinoff ───────────────────────────────────────────────────────

  -- 1. Lock spinoff legacy map (with approved_by + gmv_at_split audit trail)
  INSERT INTO spinoff_legacy_map
    (mentor_id, protege_id, approved_by, approved_at, gmv_at_split)
  VALUES (
    v_mentor_id,
    p_sales_id,
    (SELECT id FROM staff WHERE auth_user_id = auth.uid()),
    NOW(),
    v_cumulative_gmv
  );

  -- 2. Promote Sales → Leader, unlink from mentor, stamp mentor_id
  --    PATCH vs Migration 006: added mentor_id = v_mentor_id
  --    mentor_id column was added in Migration 007; 006 predated it and left it NULL.
  UPDATE staff
     SET role      = 'Leader',
         leader_id = NULL,
         mentor_id = v_mentor_id    -- ← PATCH: denormalized mentor reference on staff row
   WHERE id = p_sales_id;

  RAISE LOG
    '[Spinoff] protege_id=% promoted to Leader, mentor_id=%, gmv_at_split=%, legacy_pct=%',
    p_sales_id, v_mentor_id, v_cumulative_gmv, v_legacy_pct;

  RETURN jsonb_build_object(
    'success',      true,
    'protege_name', v_sales.name,
    'mentor_id',    v_mentor_id,
    'gmv_at_split', v_cumulative_gmv,
    'legacy_pct',   v_legacy_pct,
    'message',      format(
      '%s has been promoted to Leader. Mentor retains %.1f%% legacy commission.',
      v_sales.name, v_legacy_pct * 100
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_request_spinoff(UUID) TO authenticated;

-- ── Verification markers ──────────────────────────────────────────────────────
-- Section A: fn_first_blood_claim, trg_aa_first_blood
-- Section C: fn_neglect_index_update, trg_bb_neglect_index
-- Section E: fn_evaluate_leader_month — consecutive_fail_months, leader_frozen write-back
-- Section G: fn_request_spinoff — mentor_id stamped on promotion (gap from 006 closed)
-- system_params keys consumed: leader_death_line_months, spinoff_threshold, spinoff_legacy_pct
