-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 010 — Invoice Atomic RPC v2: Joint Order + total_boxes
-- MediGlove ERP · EPIC-05 / T-05.2 / T-05.5
--
-- Extends create_invoice_atomic() to:
--   (a) Accept p_is_joint_order + p_co_created_by for 50/50 HR代开单 flow
--   (b) Stamp total_boxes (= sum of all item qty) into invoices row
--   (c) Validate joint order constraint at RPC level
--
-- All other logic (promo rules, neglect engine, pessimistic lock, PO upsert)
-- is preserved identically from Migration 003.
--
-- NOTE: CREATE OR REPLACE FUNCTION changes the signature (adds 2 params with
-- DEFAULT values) — backward-compatible; old callers without the new args
-- continue to work with is_joint_order=FALSE, co_created_by=NULL.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Drop old overload (Postgres tracks distinct function signatures) ──────────
-- The old signature had 4 params; new has 6. DROP + recreate is safest.
DROP FUNCTION IF EXISTS create_invoice_atomic(UUID, JSONB, NUMERIC, NUMERIC);

-- ── create_invoice_atomic v2 ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_invoice_atomic(
  p_client_id       UUID,
  p_items           JSONB,     -- [{product_id, qty, selling_price}]
  p_discount        NUMERIC  DEFAULT 0,
  p_delivery_charge NUMERIC  DEFAULT 0,
  p_is_joint_order  BOOLEAN  DEFAULT FALSE,
  p_co_created_by   UUID     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id             UUID    := auth_staff_id();
  v_client                clients%ROWTYPE;
  v_item                  JSONB;
  v_product               products%ROWTYPE;
  v_total_qty             INTEGER := 0;
  v_total_amount          NUMERIC := 0;
  v_delivery_charge       NUMERIC := p_delivery_charge;
  v_invoice_no            TEXT;
  v_invoice_id            UUID    := gen_random_uuid();
  v_do_id                 UUID    := gen_random_uuid();
  v_do_no                 TEXT;
  v_owner_id_before       UUID;
  v_neglect_idx           INTEGER;
  v_split_owner_pct       NUMERIC;
  v_split_asst_pct        NUMERIC;
  v_ownership_transferred BOOLEAN := FALSE;
  v_effective_co_created  UUID;
BEGIN
  -- ── 0.  Joint order pre-validation ─────────────────────────────────────────
  IF p_is_joint_order = TRUE AND p_co_created_by IS NULL THEN
    RAISE EXCEPTION 'Joint order requires co_created_by to be specified.';
  END IF;

  v_effective_co_created := CASE WHEN p_is_joint_order THEN p_co_created_by ELSE NULL END;

  -- ── 4.1  Load client (lock row for update) ──────────────────────────────────
  SELECT * INTO v_client
  FROM clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found: %', p_client_id;
  END IF;

  v_owner_id_before := v_client.owner_id;
  v_neglect_idx     := v_client.neglect_index;

  -- ── 4.2  Validate & aggregate items ─────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::UUID;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id';
    END IF;

    -- Price floor guard (fn_validate_price_guard logic inlined for atomicity)
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

  -- ── 4.3  Promo rule: 3-box minimum ──────────────────────────────────────────
  IF v_total_qty < 3 THEN
    RAISE EXCEPTION
      'Order rejected: minimum 3 boxes required. Current total: % box(es).',
      v_total_qty;
  END IF;

  -- ── 4.4  Promo rule: West Malaysia >= 5 boxes → free shipping ───────────────
  IF v_client.region = 'West Malaysia' AND v_total_qty >= 5 THEN
    v_delivery_charge := 0;
  END IF;

  v_total_amount := v_total_amount - p_discount + v_delivery_charge;
  IF v_total_amount < 0 THEN v_total_amount := 0; END IF;

  -- ── 4.5  First-Blood Ownership Override (orphan client) ──────────────────────
  IF v_client.is_orphan = TRUE THEN
    UPDATE clients
    SET
      owner_id      = v_caller_id,
      is_orphan     = FALSE,
      neglect_index = 0
    WHERE id = p_client_id;

    v_owner_id_before := v_caller_id;
    v_neglect_idx     := 0;
  END IF;

  -- ── 4.6  Tug-of-War Neglect Index Engine ────────────────────────────────────
  IF v_owner_id_before IS NOT NULL AND v_caller_id <> v_owner_id_before THEN
    -- Non-owner is creating this invoice
    IF v_neglect_idx < 6 THEN
      v_neglect_idx := v_neglect_idx + 1;
    END IF;

    CASE v_neglect_idx
      WHEN 1 THEN v_split_owner_pct := 50; v_split_asst_pct := 50;
      WHEN 2 THEN v_split_owner_pct := 40; v_split_asst_pct := 60;
      WHEN 3 THEN v_split_owner_pct := 30; v_split_asst_pct := 70;
      WHEN 4 THEN v_split_owner_pct := 20; v_split_asst_pct := 80;
      WHEN 5 THEN v_split_owner_pct := 10; v_split_asst_pct := 90;
      WHEN 6 THEN v_split_owner_pct :=  0; v_split_asst_pct := 100;
      ELSE        v_split_owner_pct := 50; v_split_asst_pct := 50;
    END CASE;

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

    INSERT INTO commission_splits
      (invoice_id, owner_id, assistant_id, owner_ratio, assistant_ratio, neglect_index_at_time)
    VALUES
      (v_invoice_id, v_owner_id_before, v_caller_id,
       v_split_owner_pct, v_split_asst_pct, v_neglect_idx);

  ELSIF v_owner_id_before = v_caller_id AND v_neglect_idx > 0 THEN
    -- Owner redeeming service debt (index--)
    v_neglect_idx := v_neglect_idx - 1;

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

    INSERT INTO commission_splits
      (invoice_id, owner_id, assistant_id, owner_ratio, assistant_ratio, neglect_index_at_time)
    VALUES
      (v_invoice_id, v_caller_id, v_client.last_assisted_by,
       v_split_owner_pct, v_split_asst_pct, v_neglect_idx + 1);
  END IF;

  -- ── 4.7  Generate invoice number (pessimistic lock) ──────────────────────────
  v_invoice_no := generate_invoice_no();

  -- ── 4.8  Insert Invoice (v2: includes total_boxes, is_joint_order, co_created_by) ──
  INSERT INTO invoices
    (id, invoice_no, client_id, created_by, status, region,
     delivery_charge, discount, total_amount,
     total_boxes, is_joint_order, co_created_by)
  VALUES
    (v_invoice_id, v_invoice_no, p_client_id, v_caller_id, 'Active',
     v_client.region, v_delivery_charge, p_discount, v_total_amount,
     v_total_qty, p_is_joint_order, v_effective_co_created);

  -- ── 4.9  Insert Invoice Items + Draft POs per supplier ───────────────────────
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

  -- ── 4.10  Insert Delivery Order ──────────────────────────────────────────────
  v_do_no := generate_do_no('Invoice');

  INSERT INTO delivery_orders
    (id, do_no, type, invoice_id, client_id, created_by, status)
  VALUES
    (v_do_id, v_do_no, 'Invoice', v_invoice_id, p_client_id, v_caller_id, 'Pending');

  -- ── 4.11  Set first_order_date on client ─────────────────────────────────────
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
    'total_boxes',            v_total_qty,
    'is_joint_order',         p_is_joint_order,
    'neglect_index_applied',  v_neglect_idx,
    'ownership_transferred',  v_ownership_transferred
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_invoice_atomic(UUID, JSONB, NUMERIC, NUMERIC, BOOLEAN, UUID)
  TO authenticated;

-- ── Verification marker ──────────────────────────────────────────────────────
-- create_invoice_atomic v2: total_boxes stamped, is_joint_order + co_created_by supported
