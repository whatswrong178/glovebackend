-- ============================================================
-- MediGlove Supply ERP v8.8
-- Migration 003: Core RPCs, Triggers & Pessimistic Lock Engine
-- ============================================================

-- ─────────────────────────────────────────────────────────
-- 1. generate_invoice_no()  ← THE PESSIMISTIC LOCK
-- ─────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can write to invoice_sequence
-- regardless of the caller's RLS context.
-- MUST be called inside an explicit BEGIN/COMMIT transaction.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_invoice_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date    TEXT    := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYMMDD');
  v_seq     INTEGER;
  v_inv_no  TEXT;
BEGIN
  -- Ensure today's row exists (idempotent upsert)
  INSERT INTO invoice_sequence (date, last_seq)
  VALUES (v_date, 0)
  ON CONFLICT (date) DO NOTHING;

  -- *** PESSIMISTIC LOCK ***
  -- SELECT FOR UPDATE acquires an exclusive row-level lock.
  -- Any concurrent call on the same date row BLOCKS here
  -- until the current transaction commits or rolls back.
  -- This guarantees strict serial sequence numbers — zero collisions.
  SELECT last_seq + 1
  INTO   v_seq
  FROM   invoice_sequence
  WHERE  date = v_date
  FOR UPDATE;          -- <── core pessimistic lock

  UPDATE invoice_sequence
  SET    last_seq = v_seq
  WHERE  date = v_date;

  v_inv_no := v_date || '-' || LPAD(v_seq::TEXT, 4, '0');
  RETURN v_inv_no;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 2. generate_do_no()  (similar lock pattern for DO numbers)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS do_sequence (
  date     TEXT    PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION generate_do_no(p_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date   TEXT    := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYMMDD');
  v_prefix TEXT    := CASE WHEN p_type = 'Sample' THEN 'SDO' ELSE 'DO' END;
  v_seq    INTEGER;
BEGIN
  INSERT INTO do_sequence (date, last_seq)
  VALUES (v_date, 0)
  ON CONFLICT (date) DO NOTHING;

  SELECT last_seq + 1
  INTO   v_seq
  FROM   do_sequence
  WHERE  date = v_date
  FOR UPDATE;

  UPDATE do_sequence SET last_seq = v_seq WHERE date = v_date;

  RETURN v_prefix || '-' || v_date || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 3. generate_po_no()  (PO number generator)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_sequence (
  date     TEXT    PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION generate_po_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date TEXT    := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYMMDD');
  v_seq  INTEGER;
BEGIN
  INSERT INTO po_sequence (date, last_seq)
  VALUES (v_date, 0)
  ON CONFLICT (date) DO NOTHING;

  SELECT last_seq + 1
  INTO   v_seq
  FROM   po_sequence
  WHERE  date = v_date
  FOR UPDATE;

  UPDATE po_sequence SET last_seq = v_seq WHERE date = v_date;

  RETURN 'PO-' || v_date || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 4. create_invoice_atomic()
--    THE CENTRAL TRANSACTION RPC
--    Atomically:
--      (a) Validates promo rules (3-box minimum, 5-box free shipping)
--      (b) Handles First-Blood Ownership Override for orphan clients
--      (c) Handles Neglect Index tug-of-war + Owner Transfer at index=6
--      (d) Generates invoice_no with pessimistic lock
--      (e) Inserts Invoice + Invoice Items
--      (f) Inserts DO (same atomic tx)
--      (g) Inserts Draft POs split by supplier
--      (h) Writes commission split record
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_invoice_atomic(
  p_client_id      UUID,
  p_items          JSONB,   -- [{product_id, qty, selling_price}]
  p_discount       NUMERIC DEFAULT 0,
  p_delivery_charge NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id        UUID    := auth_staff_id();
  v_client           clients%ROWTYPE;
  v_item             JSONB;
  v_product          products%ROWTYPE;
  v_total_qty        INTEGER := 0;
  v_total_amount     NUMERIC := 0;
  v_delivery_charge  NUMERIC := p_delivery_charge;
  v_invoice_no       TEXT;
  v_invoice_id       UUID    := gen_random_uuid();
  v_do_id            UUID    := gen_random_uuid();
  v_do_no            TEXT;
  v_owner_id_before  UUID;
  v_neglect_idx      INTEGER;
  v_split_owner_pct  NUMERIC;
  v_split_asst_pct   NUMERIC;
  v_ownership_transferred BOOLEAN := FALSE;
BEGIN
  -- ── 4.1  Load client (lock row for update)
  SELECT * INTO v_client
  FROM clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found: %', p_client_id;
  END IF;

  v_owner_id_before := v_client.owner_id;
  v_neglect_idx     := v_client.neglect_index;

  -- ── 4.2  Validate & aggregate items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::UUID;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id';
    END IF;

    -- Price floor guard
    IF (v_item->>'selling_price')::NUMERIC < v_product.min_selling_price THEN
      RAISE EXCEPTION
        'Selling price % is below min_selling_price % for SKU %',
        v_item->>'selling_price',
        v_product.min_selling_price,
        v_product.sku;
    END IF;

    v_total_qty    := v_total_qty + (v_item->>'qty')::INTEGER;
    v_total_amount := v_total_amount
                    + ((v_item->>'selling_price')::NUMERIC * (v_item->>'qty')::INTEGER);
  END LOOP;

  -- ── 4.3  Promo rule: 3-box minimum
  IF v_total_qty < 3 THEN
    RAISE EXCEPTION
      'Order rejected: minimum 3 boxes required. Current total: % box(es).',
      v_total_qty;
  END IF;

  -- ── 4.4  Promo rule: West Malaysia >= 5 boxes → free shipping
  IF v_client.region = 'West Malaysia' AND v_total_qty >= 5 THEN
    v_delivery_charge := 0;
  END IF;

  v_total_amount := v_total_amount - p_discount + v_delivery_charge;
  IF v_total_amount < 0 THEN v_total_amount := 0; END IF;

  -- ── 4.5  First-Blood Ownership Override (orphan client)
  IF v_client.is_orphan = TRUE THEN
    UPDATE clients
    SET
      owner_id     = v_caller_id,
      is_orphan    = FALSE,
      neglect_index = 0
    WHERE id = p_client_id;

    v_owner_id_before := v_caller_id;
    v_neglect_idx     := 0;
  END IF;

  -- ── 4.6  Tug-of-War Neglect Index Engine
  IF v_owner_id_before IS NOT NULL AND v_caller_id <> v_owner_id_before THEN
    -- Non-owner is creating this invoice
    IF v_neglect_idx < 6 THEN
      v_neglect_idx := v_neglect_idx + 1;
    END IF;

    -- Determine split ratios (index BEFORE increment reflects current state)
    CASE v_neglect_idx
      WHEN 1 THEN v_split_owner_pct := 50; v_split_asst_pct := 50;
      WHEN 2 THEN v_split_owner_pct := 40; v_split_asst_pct := 60;
      WHEN 3 THEN v_split_owner_pct := 30; v_split_asst_pct := 70;
      WHEN 4 THEN v_split_owner_pct := 20; v_split_asst_pct := 80;
      WHEN 5 THEN v_split_owner_pct := 10; v_split_asst_pct := 90;
      WHEN 6 THEN v_split_owner_pct :=  0; v_split_asst_pct := 100;
      ELSE        v_split_owner_pct := 50; v_split_asst_pct := 50;
    END CASE;

    -- Index = 6 → Permanent Ownership Transfer
    IF v_neglect_idx = 6 THEN
      UPDATE clients
      SET owner_id = v_caller_id, neglect_index = 0
      WHERE id = p_client_id;
      v_ownership_transferred := TRUE;
    ELSE
      UPDATE clients
      SET neglect_index = v_neglect_idx, last_assisted_by = v_caller_id
      WHERE id = p_client_id;
    END IF;

    -- Write split record
    INSERT INTO commission_splits
      (invoice_id, owner_id, assistant_id, owner_ratio, assistant_ratio, neglect_index_at_time)
    VALUES
      (v_invoice_id, v_owner_id_before, v_caller_id,
       v_split_owner_pct, v_split_asst_pct, v_neglect_idx);

  ELSIF v_owner_id_before = v_caller_id AND v_neglect_idx > 0 THEN
    -- Owner is redeeming service debt (index--)
    v_neglect_idx := v_neglect_idx - 1;

    -- Split at current (pre-decrement) index (owner is disadvantaged)
    CASE v_neglect_idx + 1
      WHEN 1 THEN v_split_owner_pct := 50; v_split_asst_pct := 50;
      WHEN 2 THEN v_split_owner_pct := 40; v_split_asst_pct := 60;
      WHEN 3 THEN v_split_owner_pct := 30; v_split_asst_pct := 70;
      WHEN 4 THEN v_split_owner_pct := 20; v_split_asst_pct := 80;
      WHEN 5 THEN v_split_owner_pct := 10; v_split_asst_pct := 90;
      ELSE        v_split_owner_pct := 50; v_split_asst_pct := 50;
    END CASE;

    UPDATE clients
    SET neglect_index = v_neglect_idx
    WHERE id = p_client_id;

    -- Write split: owner is the "assistant" buying back, last_assisted_by is the beneficiary
    INSERT INTO commission_splits
      (invoice_id, owner_id, assistant_id, owner_ratio, assistant_ratio, neglect_index_at_time)
    VALUES
      (v_invoice_id, v_caller_id, v_client.last_assisted_by,
       v_split_owner_pct, v_split_asst_pct, v_neglect_idx + 1);
  END IF;

  -- ── 4.7  Generate invoice number (pessimistic lock)
  v_invoice_no := generate_invoice_no();

  -- ── 4.8  Insert Invoice
  INSERT INTO invoices
    (id, invoice_no, client_id, created_by, status, region,
     delivery_charge, discount, total_amount)
  VALUES
    (v_invoice_id, v_invoice_no, p_client_id, v_caller_id, 'Active',
     v_client.region, v_delivery_charge, p_discount, v_total_amount);

  -- ── 4.9  Insert Invoice Items + Draft POs per supplier
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID;

    INSERT INTO invoice_items
      (invoice_id, product_id, qty, selling_price, cost_price_snapshot)
    VALUES
      (v_invoice_id,
       v_product.id,
       (v_item->>'qty')::INTEGER,
       (v_item->>'selling_price')::NUMERIC,
       v_product.cost_price);

    -- Upsert Draft PO per supplier (one PO per supplier per invoice)
    WITH existing_po AS (
      SELECT id FROM purchase_orders
      WHERE invoice_id = v_invoice_id AND supplier_id = v_product.supplier_id
      LIMIT 1
    ),
    new_po AS (
      INSERT INTO purchase_orders (po_no, supplier_id, invoice_id, status)
      SELECT generate_po_no(), v_product.supplier_id, v_invoice_id, 'Draft'
      WHERE NOT EXISTS (SELECT 1 FROM existing_po)
      RETURNING id
    ),
    resolved_po AS (
      SELECT id FROM existing_po
      UNION ALL
      SELECT id FROM new_po
    )
    INSERT INTO purchase_order_items (po_id, product_id, qty, unit_cost)
    SELECT r.id, v_product.id, (v_item->>'qty')::INTEGER, v_product.cost_price
    FROM resolved_po r;
  END LOOP;

  -- ── 4.10  Insert Delivery Order
  v_do_no := generate_do_no('Invoice');

  INSERT INTO delivery_orders
    (id, do_no, type, invoice_id, client_id, created_by, status)
  VALUES
    (v_do_id, v_do_no, 'Invoice', v_invoice_id, p_client_id, v_caller_id, 'Pending');

  -- ── 4.11  Set first_order_date on client if this is their first invoice
  UPDATE clients
  SET first_order_date = CURRENT_DATE
  WHERE id = p_client_id AND first_order_date IS NULL;

  RETURN jsonb_build_object(
    'invoice_id',             v_invoice_id,
    'invoice_no',             v_invoice_no,
    'do_id',                  v_do_id,
    'do_no',                  v_do_no,
    'total_amount',           v_total_amount,
    'delivery_charge',        v_delivery_charge,
    'neglect_index_applied',  v_neglect_idx,
    'ownership_transferred',  v_ownership_transferred
  );
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 5. TRIGGER: Staff Offboarding → Cascade Orphan Release
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_staff_offboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fires when status changes FROM Active TO Inactive
  IF NEW.status = 'Inactive' AND OLD.status = 'Active' THEN
    UPDATE clients
    SET
      is_orphan = TRUE,
      owner_id  = NULL
    WHERE
      owner_id = OLD.id
      AND is_orphan = FALSE;

    -- Log for audit trail
    RAISE LOG
      'Offboarding trigger: % clients orphaned for staff_id=%',
      (SELECT COUNT(*) FROM clients WHERE owner_id IS NULL AND is_orphan = TRUE AND created_by = OLD.id),
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_staff_offboarding
  AFTER UPDATE OF status ON staff
  FOR EACH ROW
  EXECUTE FUNCTION fn_staff_offboarding();

-- ─────────────────────────────────────────────────────────
-- 6. TRIGGER: Commission Unlock on Invoice Paid
--    When HR sets Invoice.status = 'Paid', all Est commissions
--    for that invoice automatically flip to Actual.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_unlock_commissions_on_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Paid' AND OLD.status <> 'Paid' THEN
    UPDATE commissions
    SET status = 'Actual'
    WHERE invoice_id = NEW.id AND status = 'Est';

    -- Stamp the paid timestamp
    NEW.paid_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_invoice_commission_unlock
  BEFORE UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION fn_unlock_commissions_on_paid();

-- ─────────────────────────────────────────────────────────
-- 7. RPC: compute_base_commission()
--    Pure calculation — writes commission rows for a given invoice.
--    Called after create_invoice_atomic() succeeds.
--    Handles: Base GP commission, KAM loyalty bonus.
--    (Bounty, Ladder, Management handled in separate RPCs — EPIC-06)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_base_commission(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv              invoices%ROWTYPE;
  v_item             invoice_items%ROWTYPE;
  v_product          products%ROWTYPE;
  v_client           clients%ROWTYPE;
  v_split            commission_splits%ROWTYPE;
  v_gp               NUMERIC := 0;
  v_base_rate        NUMERIC;
  v_kam_rate         NUMERIC := 0;
  v_commission       NUMERIC;
  v_total_gp         NUMERIC := 0;
  v_total_discount   NUMERIC;
  v_items_count      INTEGER;
  v_param_kam_days   INTEGER;
  v_param_kam_a      NUMERIC;
  v_param_kam_b      NUMERIC;
BEGIN
  SELECT * INTO v_inv    FROM invoices WHERE id = p_invoice_id;
  SELECT * INTO v_client FROM clients  WHERE id = v_inv.client_id;
  SELECT COUNT(*) INTO v_items_count FROM invoice_items WHERE invoice_id = p_invoice_id;

  -- Load params
  SELECT (value #>> '{}')::INTEGER INTO v_param_kam_days
  FROM system_params WHERE key = 'kam_threshold_days';

  SELECT (value #>> '{}')::NUMERIC INTO v_param_kam_a
  FROM system_params WHERE key = 'kam_bonus_rate_a';

  SELECT (value #>> '{}')::NUMERIC INTO v_param_kam_b
  FROM system_params WHERE key = 'kam_bonus_rate_b';

  -- Per-item discount split equally
  v_total_discount := v_inv.discount / GREATEST(v_items_count, 1);

  FOR v_item IN
    SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id;

    -- GP熔断: GP = max(0, (selling - cost) * qty) - pro-rated discount
    v_gp := GREATEST(
      0,
      ((v_item.selling_price - v_item.cost_price_snapshot) * v_item.qty)
      - v_total_discount
    );

    v_total_gp := v_total_gp + v_gp;
  END LOOP;

  -- Loop again to write commission rows per item category
  FOR v_item IN
    SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id
  LOOP
    SELECT * INTO v_product FROM products WHERE id = v_item.product_id;

    v_gp := GREATEST(
      0,
      ((v_item.selling_price - v_item.cost_price_snapshot) * v_item.qty)
      - (v_inv.discount / GREATEST(v_items_count, 1))
    );

    -- Base commission rate by category
    IF v_product.category = 'A' THEN
      SELECT (value #>> '{}')::NUMERIC INTO v_base_rate
      FROM system_params WHERE key = 'commission_rate_a';
    ELSE
      SELECT (value #>> '{}')::NUMERIC INTO v_base_rate
      FROM system_params WHERE key = 'commission_rate_b';
    END IF;

    -- KAM loyalty bonus: client cooperation >= 180 days
    v_kam_rate := 0;
    IF v_client.first_order_date IS NOT NULL
       AND (CURRENT_DATE - v_client.first_order_date) >= v_param_kam_days
    THEN
      IF v_product.category = 'A' THEN
        v_kam_rate := v_param_kam_a;
      ELSE
        v_kam_rate := v_param_kam_b;
      END IF;
    END IF;

    v_commission := v_gp * (v_base_rate + v_kam_rate);

    -- Check for tug-of-war split
    SELECT * INTO v_split
    FROM commission_splits
    WHERE invoice_id = p_invoice_id
    LIMIT 1;

    IF FOUND THEN
      -- Split Base commission between owner and assistant
      INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
      VALUES
        (p_invoice_id, v_split.owner_id,     'Base',
         v_commission * (v_split.owner_ratio / 100), 'Est'),
        (p_invoice_id, v_split.assistant_id, 'Base',
         v_commission * (v_split.assistant_ratio / 100), 'Est');

      -- KAM bonus goes to the commission owner (original owner)
      IF v_kam_rate > 0 THEN
        INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
        VALUES
          (p_invoice_id, v_split.owner_id, 'KAM',
           v_gp * v_kam_rate * (v_split.owner_ratio / 100), 'Est');
      END IF;
    ELSE
      -- Full commission to creator
      INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
      VALUES
        (p_invoice_id, v_inv.created_by, 'Base', v_commission, 'Est');

      IF v_kam_rate > 0 THEN
        INSERT INTO commissions (invoice_id, staff_id, type, amount, status)
        VALUES
          (p_invoice_id, v_inv.created_by, 'KAM', v_gp * v_kam_rate, 'Est');
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 8. RPC: get_public_pool()
--    Returns all orphan clients with their last order date.
--    Callable by any active Sales/Leader.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_public_pool()
RETURNS TABLE (
  client_id        UUID,
  client_name      TEXT,
  region           TEXT,
  credit_terms     TEXT,
  contact_person   TEXT,
  contact_email    TEXT,
  first_order_date DATE,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, name, region, credit_terms,
    contact_person, contact_email,
    first_order_date, created_at
  FROM clients
  WHERE is_orphan = TRUE
  ORDER BY created_at DESC;
$$;

-- ─────────────────────────────────────────────────────────
-- 9. RPC: mark_invoice_paid()
--    HR-only: marks Invoice as Paid, stamps timestamp,
--    unlocks commissions (handled by trigger in §6).
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_invoice_paid(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth_staff_role() NOT IN ('Admin','HR') THEN
    RAISE EXCEPTION 'Permission denied: only Admin or HR can mark invoices as Paid.';
  END IF;

  UPDATE invoices
  SET status = 'Paid'
  WHERE id = p_invoice_id AND status = 'Active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found or already Paid/Cancelled.', p_invoice_id;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 10. RPC: get_leader_team_gmv(p_month, p_year)
--     Returns a Leader's personal GMV + team GMV for
--     management commission validation.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_leader_team_gmv(p_month INTEGER, p_year INTEGER)
RETURNS TABLE (
  staff_id     UUID,
  staff_name   TEXT,
  personal_gmv NUMERIC,
  team_gmv     NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH paid_invoices AS (
    SELECT i.created_by, SUM(i.total_amount) AS gmv
    FROM invoices i
    WHERE i.status = 'Paid'
      AND EXTRACT(MONTH FROM i.paid_at) = p_month
      AND EXTRACT(YEAR  FROM i.paid_at) = p_year
    GROUP BY i.created_by
  )
  SELECT
    s.id                                      AS staff_id,
    s.name                                    AS staff_name,
    COALESCE(pi_self.gmv, 0)                  AS personal_gmv,
    COALESCE(SUM(pi_team.gmv), 0)             AS team_gmv
  FROM staff s
  LEFT JOIN paid_invoices pi_self ON pi_self.created_by = s.id
  LEFT JOIN staff          reports ON reports.leader_id = s.id
  LEFT JOIN paid_invoices pi_team  ON pi_team.created_by = reports.id
  WHERE s.role = 'Leader'
  GROUP BY s.id, s.name, pi_self.gmv;
$$;

-- ─────────────────────────────────────────────────────────
-- 11. TRIGGER: Prevent editing Completed Invoices
--     Once Paid or Cancelled, the record is immutable.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_guard_completed_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('Paid','Cancelled') THEN
    RAISE EXCEPTION
      'Invoice % is % and cannot be modified.',
      OLD.invoice_no, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_completed_invoice
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  WHEN (OLD.status IN ('Paid','Cancelled'))
  EXECUTE FUNCTION fn_guard_completed_invoice();

-- ─────────────────────────────────────────────────────────
-- 12. TRIGGER: Auto-update email_templates.updated_at
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_updated_at();

-- ─────────────────────────────────────────────────────────
-- 13. RPC: create_sample_do()
--     Creates a Sample DO (no invoice, no GP, finance-only)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_sample_do(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth_staff_id();
  v_do_no     TEXT;
  v_do_id     UUID := gen_random_uuid();
BEGIN
  IF auth_staff_role() NOT IN ('Admin','HR','Leader') THEN
    RAISE EXCEPTION 'Permission denied: only Admin, HR or Leader can request samples.';
  END IF;

  v_do_no := generate_do_no('Sample');

  INSERT INTO delivery_orders
    (id, do_no, type, invoice_id, client_id, created_by, status)
  VALUES
    (v_do_id, v_do_no, 'Sample', NULL, p_client_id, v_caller_id, 'Pending');

  RETURN jsonb_build_object('do_id', v_do_id, 'do_no', v_do_no);
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 14. RPC: submit_epod()
--     Logistics submits signature + photo to close a DO.
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_epod(
  p_do_id           UUID,
  p_signature_base64 TEXT,
  p_photo_url        TEXT,
  p_geo_lat          NUMERIC,
  p_geo_lng          NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth_staff_role() <> 'Logistics' AND auth_staff_role() <> 'Admin' THEN
    RAISE EXCEPTION 'Only Logistics or Admin can submit e-POD.';
  END IF;

  UPDATE delivery_orders
  SET
    status           = 'Delivered',
    signature_base64 = p_signature_base64,
    photo_url        = p_photo_url,
    geo_lat          = p_geo_lat,
    geo_lng          = p_geo_lng,
    delivered_at     = NOW()
  WHERE id = p_do_id
    AND (assigned_logistics_id = auth_staff_id() OR auth_staff_role() = 'Admin')
    AND status IN ('Pending','In Transit');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DO % not found or not assigned to you.', p_do_id;
  END IF;
END;
$$;
