-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 036: Convert entire system to unit-based pricing
--
-- Before (mixed):
--   invoice_items.qty            = cartons (e.g. 4)
--   invoice_items.selling_price  = per carton (e.g. RM 199)
--   invoice_items.cost_price_snapshot = per carton (RM 169, set by M035)
--   purchase_order_items.qty     = cartons (e.g. 4)
--   purchase_order_items.unit_cost = per unit (e.g. RM 16.90)  ← inconsistent!
--
-- After (uniform):
--   invoice_items.qty            = units/boxes (e.g. 40)
--   invoice_items.selling_price  = per unit (e.g. RM 19.90)
--   invoice_items.cost_price_snapshot = per unit (e.g. RM 16.90)
--   purchase_order_items.qty     = units/boxes (e.g. 40)
--   purchase_order_items.unit_cost = per unit (e.g. RM 16.90)  ← now consistent!
--
-- GP formula: (selling_price - cost_price_snapshot) × qty
--   = (19.90 - 16.90) × 40 = RM 120 ✓  (same result, all same units)
--
-- Invoice total unchanged:
--   Old: 4 × 199 = 796
--   New: 40 × 19.90 = 796  ✓
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Step 1: Convert Carton invoice_items → unit-based ────────────────────────
-- For rows stored as "Carton": multiply qty by upc, divide selling_price by upc.
-- Change unit label to 'Box'.
UPDATE invoice_items ii
SET
  qty           = ii.qty * COALESCE(p.units_per_carton, 1),
  selling_price = ROUND(
                    ii.selling_price / NULLIF(p.units_per_carton::NUMERIC, 0),
                    4
                  ),
  unit          = 'Box'
FROM products p
WHERE ii.product_id = p.id
  AND ii.unit       = 'Carton';


-- ── Step 2: Fix cost_price_snapshot for ALL invoice_items ────────────────────
-- M035 set snapshot = cost_price × upc (per carton).
-- We revert to per-unit = products.cost_price.
-- Rows where cost_price = 0 / NULL are left at 0 (no data to work with).
UPDATE invoice_items ii
SET   cost_price_snapshot = COALESCE(p.cost_price, 0)
FROM  products p
WHERE ii.product_id = p.id;


-- ── Step 3: Recompute invoices.total_amount ──────────────────────────────────
-- Values are mathematically identical (qty_units × sp_per_unit = qty_cartons × sp_per_carton).
-- Run anyway to guard against any rounding drift.
-- Skip Cancelled invoices (locked totals).
UPDATE invoices inv
SET total_amount = GREATEST(0,
  (
    SELECT COALESCE(SUM(ii.qty::NUMERIC * ii.selling_price), 0)
    FROM   invoice_items ii
    WHERE  ii.invoice_id = inv.id
  )
  - COALESCE(inv.discount,        0)
  + COALESCE(inv.delivery_charge, 0)
)
WHERE inv.status != 'Cancelled';


-- ── Step 4: Convert purchase_order_items.qty to units ───────────────────────
-- unit_cost is already per-unit — no change needed there.
UPDATE purchase_order_items poi
SET   qty = poi.qty * COALESCE(p.units_per_carton, 1)
FROM  products p
WHERE poi.product_id = p.id;


-- ── Step 5: Rewrite sync_open_doc_prices ─────────────────────────────────────
-- Remove upc multiplication. selling_price and cost_price_snapshot are both
-- now stored per-unit, same as the source columns on products.
CREATE OR REPLACE FUNCTION sync_open_doc_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- ── 1. PO items (Draft / Approved) — unit_cost stays per-unit ──────────────
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    UPDATE purchase_order_items poi
    SET    unit_cost = NEW.cost_price
    FROM   purchase_orders po
    WHERE  poi.po_id      = po.id
      AND  poi.product_id = NEW.id
      AND  po.status     IN ('Draft', 'Approved');
  END IF;

  -- ── 2. Invoice items (Active) ───────────────────────────────────────────────
  -- selling_price = suggested_price (per unit, direct — no × upc)
  IF NEW.suggested_price IS DISTINCT FROM OLD.suggested_price THEN
    UPDATE invoice_items ii
    SET    selling_price = NEW.suggested_price
    FROM   invoices inv
    WHERE  ii.invoice_id = inv.id
      AND  ii.product_id = NEW.id
      AND  inv.status    = 'Active';
  END IF;

  -- cost_price_snapshot = cost_price (per unit, direct — no × upc)
  IF NEW.cost_price IS DISTINCT FROM OLD.cost_price THEN
    UPDATE invoice_items ii
    SET    cost_price_snapshot = NEW.cost_price
    FROM   invoices inv
    WHERE  ii.invoice_id = inv.id
      AND  ii.product_id = NEW.id
      AND  inv.status    = 'Active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_open_doc_prices ON products;

CREATE TRIGGER trg_sync_open_doc_prices
AFTER UPDATE OF cost_price, min_selling_price, suggested_price
ON products
FOR EACH ROW
EXECUTE FUNCTION sync_open_doc_prices();


-- ── Step 6: Rewrite create_invoice_atomic (v4 — unit-based) ──────────────────
-- Changes vs v3:
--   • Unit defaults to 'Box' (was 'Carton')
--   • Minimum order check removed (was 3 cartons — now a UI-only soft warning)
--   • Free-shipping threshold now based on units (≥ 50 units for West Malaysia)
--   • min_selling_price check is now dimensionally correct (both per-unit)
--   • PO qty stored in units (same as invoice qty)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS create_invoice_atomic(UUID, JSONB, NUMERIC, NUMERIC, BOOLEAN, UUID);

CREATE OR REPLACE FUNCTION create_invoice_atomic(
  p_client_id       UUID,
  p_items           JSONB,     -- [{product_id, qty, selling_price, unit?}]
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
  v_unit                  TEXT;
BEGIN
  -- ── 0. Joint order pre-validation ──────────────────────────────────────────
  IF p_is_joint_order = TRUE AND p_co_created_by IS NULL THEN
    RAISE EXCEPTION 'Joint order requires co_created_by to be specified.';
  END IF;

  v_effective_co_created := CASE WHEN p_is_joint_order THEN p_co_created_by ELSE NULL END;

  -- ── 4.1 Load client (lock row for update) ──────────────────────────────────
  SELECT * INTO v_client FROM clients WHERE id = p_client_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found: %', p_client_id;
  END IF;

  v_owner_id_before := v_client.owner_id;
  v_neglect_idx     := v_client.neglect_index;

  -- ── 4.2 Validate & aggregate items ─────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id';
    END IF;

    -- selling_price and min_selling_price are both per-unit → comparison is correct
    IF (v_item->>'selling_price')::NUMERIC < v_product.min_selling_price THEN
      RAISE EXCEPTION
        'Selling price % is below min_selling_price % for SKU %',
        v_item->>'selling_price',
        v_product.min_selling_price,
        v_product.sku;
    END IF;

    v_total_qty    := v_total_qty    + (v_item->>'qty')::INTEGER;
    v_total_amount := v_total_amount + ((v_item->>'selling_price')::NUMERIC * (v_item->>'qty')::INTEGER);
  END LOOP;

  -- ── 4.3 Promo rule: West Malaysia ≥ 50 units → free shipping ───────────────
  -- (≈ 5 cartons × 10 units/carton — adjust constant as needed)
  IF v_client.region = 'West Malaysia' AND v_total_qty >= 50 THEN
    v_delivery_charge := 0;
  END IF;

  v_total_amount := v_total_amount - p_discount + v_delivery_charge;
  IF v_total_amount < 0 THEN v_total_amount := 0; END IF;

  -- ── 4.5 First-Blood Ownership Override (orphan client) ──────────────────────
  IF v_client.is_orphan = TRUE THEN
    UPDATE clients SET owner_id = v_caller_id, is_orphan = FALSE, neglect_index = 0
    WHERE id = p_client_id;
    v_owner_id_before := v_caller_id;
    v_neglect_idx     := 0;
  END IF;

  -- ── 4.6 Tug-of-War Neglect Index Engine ─────────────────────────────────────
  IF v_owner_id_before IS NOT NULL AND v_caller_id <> v_owner_id_before THEN
    IF v_neglect_idx < 6 THEN v_neglect_idx := v_neglect_idx + 1; END IF;

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
      UPDATE clients SET owner_id = v_caller_id, neglect_index = 0 WHERE id = p_client_id;
      v_ownership_transferred := TRUE;
    ELSE
      UPDATE clients SET neglect_index = v_neglect_idx, last_assisted_by = v_caller_id WHERE id = p_client_id;
    END IF;

    INSERT INTO commission_splits
      (invoice_id, owner_id, assistant_id, owner_ratio, assistant_ratio, neglect_index_at_time)
    VALUES
      (v_invoice_id, v_owner_id_before, v_caller_id,
       v_split_owner_pct, v_split_asst_pct, v_neglect_idx);

  ELSIF v_owner_id_before = v_caller_id AND v_neglect_idx > 0 THEN
    v_neglect_idx := v_neglect_idx - 1;

    CASE v_neglect_idx + 1
      WHEN 1 THEN v_split_owner_pct := 50; v_split_asst_pct := 50;
      WHEN 2 THEN v_split_owner_pct := 40; v_split_asst_pct := 60;
      WHEN 3 THEN v_split_owner_pct := 30; v_split_asst_pct := 70;
      WHEN 4 THEN v_split_owner_pct := 20; v_split_asst_pct := 80;
      WHEN 5 THEN v_split_owner_pct := 10; v_split_asst_pct := 90;
      ELSE        v_split_owner_pct := 50; v_split_asst_pct := 50;
    END CASE;

    UPDATE clients SET neglect_index = v_neglect_idx WHERE id = p_client_id;

    INSERT INTO commission_splits
      (invoice_id, owner_id, assistant_id, owner_ratio, assistant_ratio, neglect_index_at_time)
    VALUES
      (v_invoice_id, v_caller_id, v_client.last_assisted_by,
       v_split_owner_pct, v_split_asst_pct, v_neglect_idx + 1);
  END IF;

  -- ── 4.7 Generate invoice number ─────────────────────────────────────────────
  v_invoice_no := generate_invoice_no();

  -- ── 4.8 Insert Invoice ───────────────────────────────────────────────────────
  INSERT INTO invoices
    (id, invoice_no, client_id, created_by, status, region,
     delivery_charge, discount, total_amount,
     total_boxes, is_joint_order, co_created_by)
  VALUES
    (v_invoice_id, v_invoice_no, p_client_id, v_caller_id, 'Active',
     v_client.region, v_delivery_charge, p_discount, v_total_amount,
     v_total_qty, p_is_joint_order, v_effective_co_created);

  -- ── 4.9 Insert Invoice Items + Draft POs ────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID;

    -- Default unit = 'Box' (unit-based system)
    v_unit := COALESCE(NULLIF(v_item->>'unit', ''), 'Box');

    INSERT INTO invoice_items
      (invoice_id, product_id, qty, selling_price, cost_price_snapshot, unit)
    VALUES
      (v_invoice_id,
       v_product.id,
       (v_item->>'qty')::INTEGER,
       (v_item->>'selling_price')::NUMERIC,
       v_product.cost_price,     -- per-unit cost snapshot
       v_unit);

    -- Upsert Draft PO per supplier
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
      UNION ALL SELECT id FROM new_po
    )
    INSERT INTO purchase_order_items (po_id, product_id, qty, unit_cost)
    SELECT r.id, v_product.id, (v_item->>'qty')::INTEGER, v_product.cost_price
    FROM resolved_po r;
  END LOOP;

  -- ── 4.10 Insert Delivery Order ───────────────────────────────────────────────
  v_do_no := generate_do_no('Invoice');

  INSERT INTO delivery_orders
    (id, do_no, type, invoice_id, client_id, created_by, status)
  VALUES
    (v_do_id, v_do_no, 'Invoice', v_invoice_id, p_client_id, v_caller_id, 'Pending');

  -- ── 4.11 Set first_order_date ────────────────────────────────────────────────
  UPDATE clients SET first_order_date = CURRENT_DATE
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


-- ── Verification ─────────────────────────────────────────────────────────────
-- Spot-check invoice items:
-- SELECT ii.qty, ii.selling_price, ii.cost_price_snapshot, ii.unit,
--        ii.qty * ii.selling_price AS line_total,
--        (ii.selling_price - ii.cost_price_snapshot) * ii.qty AS gp
-- FROM invoice_items ii LIMIT 20;
--
-- Spot-check PO items:
-- SELECT poi.qty, poi.unit_cost, poi.qty * poi.unit_cost AS line_total
-- FROM purchase_order_items poi LIMIT 20;
