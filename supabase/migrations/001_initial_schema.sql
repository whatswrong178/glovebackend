-- ============================================================
-- MediGlove Supply ERP v8.8
-- Migration 001: Full Relational Schema
-- ============================================================

-- ─────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- 1. STAFF  (employees & auth bridge)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    UUID        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT        NOT NULL,
  email           TEXT        UNIQUE NOT NULL,
  role            TEXT        NOT NULL
                              CHECK (role IN ('Admin','HR','Leader','Sales','Logistics')),
  department      TEXT,
  job_title       TEXT,
  status          TEXT        NOT NULL DEFAULT 'Active'
                              CHECK (status IN ('Active','Inactive')),
  leader_id       UUID        REFERENCES staff(id) ON DELETE SET NULL,
  birthday        DATE,
  join_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN staff.role IS 'Admin | HR | Leader | Sales | Logistics';
COMMENT ON COLUMN staff.leader_id IS 'Direct manager. NULL for top-level Admin/HR.';

-- ─────────────────────────────────────────────────────────
-- 2. SUPPLIERS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  email           TEXT,
  contact_phone   TEXT,
  address         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────
-- 3. PRODUCTS  (cost_price is top-secret)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT          NOT NULL,
  sku                TEXT          UNIQUE NOT NULL,
  supplier_id        UUID          REFERENCES suppliers(id) ON DELETE SET NULL,
  category           TEXT          NOT NULL CHECK (category IN ('A','B')),
  cost_price         NUMERIC(12,2) NOT NULL CHECK (cost_price >= 0),
  min_selling_price  NUMERIC(12,2) NOT NULL CHECK (min_selling_price >= 0),
  suggested_price    NUMERIC(12,2) NOT NULL CHECK (suggested_price >= 0),
  description        TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT products_price_order
    CHECK (cost_price <= min_selling_price AND min_selling_price <= suggested_price)
);

COMMENT ON COLUMN products.cost_price IS 'TOP SECRET — visible to Admin only via RLS + view';
COMMENT ON COLUMN products.category   IS 'A = 20% commission, B = 15% commission';

-- ─────────────────────────────────────────────────────────
-- 4. CLIENTS  (CRM core table)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  ssm_no           TEXT        UNIQUE,
  region           TEXT        NOT NULL
                               CHECK (region IN ('West Malaysia','East Malaysia')),
  owner_id         UUID        REFERENCES staff(id) ON DELETE SET NULL,
  created_by       UUID        NOT NULL REFERENCES staff(id),
  is_orphan        BOOLEAN     NOT NULL DEFAULT FALSE,
  credit_terms     TEXT        NOT NULL DEFAULT 'Cash Term'
                               CHECK (credit_terms IN
                                      ('Cash Term','30 Days','60 Days','90 Days')),
  neglect_index    INTEGER     NOT NULL DEFAULT 0
                               CHECK (neglect_index BETWEEN 0 AND 6),
  last_assisted_by UUID        REFERENCES staff(id) ON DELETE SET NULL,
  first_order_date DATE,
  contact_person   TEXT,
  contact_email    TEXT,
  contact_phone    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN clients.neglect_index    IS '0-6: drives tug-of-war commission split';
COMMENT ON COLUMN clients.is_orphan        IS 'TRUE when owner is Inactive — visible in Public Pool';
COMMENT ON COLUMN clients.last_assisted_by IS 'Last non-owner who raised an invoice for this client';

-- ─────────────────────────────────────────────────────────
-- 5. INVOICE SEQUENCE  (pessimistic-lock counter)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_sequence (
  date      TEXT    PRIMARY KEY,   -- YYMMDD in Asia/Kuala_Lumpur timezone
  last_seq  INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE invoice_sequence IS
  'Single row per calendar day. Locked with SELECT FOR UPDATE to prevent duplicate invoice numbers.';

-- ─────────────────────────────────────────────────────────
-- 6. INVOICES
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no       TEXT          UNIQUE NOT NULL,  -- YYMMDD-XXXX
  client_id        UUID          NOT NULL REFERENCES clients(id),
  created_by       UUID          NOT NULL REFERENCES staff(id),
  status           TEXT          NOT NULL DEFAULT 'Active'
                                 CHECK (status IN ('Active','Paid','Cancelled')),
  region           TEXT          NOT NULL,   -- snapshot from client at creation time
  delivery_charge  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  discount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_paid_requires_timestamp
    CHECK (status <> 'Paid' OR paid_at IS NOT NULL)
);

COMMENT ON COLUMN invoices.status IS 'Active = unpaid/open | Paid = commission unlocked | Cancelled = void';

-- ─────────────────────────────────────────────────────────
-- 7. INVOICE ITEMS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id            UUID          NOT NULL REFERENCES products(id),
  qty                   INTEGER       NOT NULL CHECK (qty > 0),
  selling_price         NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
  cost_price_snapshot   NUMERIC(12,2) NOT NULL CHECK (cost_price_snapshot >= 0),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN invoice_items.cost_price_snapshot IS
  'Immutable snapshot of cost_price at invoice creation. Prevents retroactive GP manipulation.';

-- ─────────────────────────────────────────────────────────
-- 8. DELIVERY ORDERS  (Invoice DO + Sample DO)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_orders (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  do_no                 TEXT        UNIQUE NOT NULL,
  type                  TEXT        NOT NULL CHECK (type IN ('Invoice','Sample')),
  invoice_id            UUID        REFERENCES invoices(id) ON DELETE SET NULL,
  client_id             UUID        NOT NULL REFERENCES clients(id),
  created_by            UUID        NOT NULL REFERENCES staff(id),
  assigned_logistics_id UUID        REFERENCES staff(id) ON DELETE SET NULL,
  status                TEXT        NOT NULL DEFAULT 'Pending'
                                    CHECK (status IN ('Pending','In Transit','Delivered','Cancelled')),
  signature_base64      TEXT,
  photo_url             TEXT,
  geo_lat               NUMERIC(10,7),
  geo_lng               NUMERIC(10,7),
  delivered_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT do_sample_no_invoice
    CHECK (type <> 'Sample' OR invoice_id IS NULL),
  CONSTRAINT do_invoice_has_invoice
    CHECK (type <> 'Invoice' OR invoice_id IS NOT NULL)
);

COMMENT ON COLUMN delivery_orders.type IS 'Invoice = normal shipment | Sample = SDO, not counted in sales GP';

-- ─────────────────────────────────────────────────────────
-- 9. PURCHASE ORDERS  (Auto-PO, split by supplier)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no        TEXT        UNIQUE NOT NULL,
  supplier_id  UUID        NOT NULL REFERENCES suppliers(id),
  invoice_id   UUID        REFERENCES invoices(id) ON DELETE SET NULL,
  status       TEXT        NOT NULL DEFAULT 'Draft'
                           CHECK (status IN ('Draft','Approved','Sent')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id       UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id  UUID          NOT NULL REFERENCES products(id),
  qty         INTEGER       NOT NULL CHECK (qty > 0),
  unit_cost   NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0)
);

-- ─────────────────────────────────────────────────────────
-- 10. COMMISSIONS  (Est → Actual on Paid)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID          NOT NULL REFERENCES invoices(id),
  staff_id    UUID          NOT NULL REFERENCES staff(id),
  type        TEXT          NOT NULL
              CHECK (type IN ('Base','KAM','Bounty','Ladder','Management','Spinoff')),
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  status      TEXT          NOT NULL DEFAULT 'Est'
              CHECK (status IN ('Est','Actual','Frozen')),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN commissions.status IS
  'Est = locked until Invoice.status=Paid | Actual = disbursable | Frozen = penalty/suspend';

-- ─────────────────────────────────────────────────────────
-- 11. COMMISSION SPLITS  (Tug-of-War model)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commission_splits (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            UUID          NOT NULL REFERENCES invoices(id),
  owner_id              UUID          NOT NULL REFERENCES staff(id),
  assistant_id          UUID          NOT NULL REFERENCES staff(id),
  owner_ratio           NUMERIC(5,2)  NOT NULL CHECK (owner_ratio BETWEEN 0 AND 100),
  assistant_ratio       NUMERIC(5,2)  NOT NULL CHECK (assistant_ratio BETWEEN 0 AND 100),
  neglect_index_at_time INTEGER       NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT split_ratios_sum_100
    CHECK (owner_ratio + assistant_ratio = 100)
);

-- ─────────────────────────────────────────────────────────
-- 12. EDIT REQUESTS  (防篡改审批流)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edit_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID        NOT NULL REFERENCES clients(id),
  requested_by        UUID        NOT NULL REFERENCES staff(id),
  requested_changes   JSONB       NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'Pending'
                                  CHECK (status IN ('Pending','Approved','Rejected')),
  reviewed_by         UUID        REFERENCES staff(id) ON DELETE SET NULL,
  review_note         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────
-- 13. PLAYBOOK MATERIALS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS playbook_materials (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  category     TEXT        NOT NULL,
  subcategory  TEXT,
  file_url     TEXT        NOT NULL,
  type         TEXT        NOT NULL CHECK (type IN ('PDF','Video','Image','Script')),
  uploaded_by  UUID        NOT NULL REFERENCES staff(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────
-- 14. FINANCIAL SNAPSHOTS  (immutable month-end lock)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_month  INTEGER     NOT NULL CHECK (snapshot_month BETWEEN 1 AND 12),
  snapshot_year   INTEGER     NOT NULL CHECK (snapshot_year >= 2024),
  data            JSONB       NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_month, snapshot_year)
);

-- Snapshots are write-once: block any UPDATE or DELETE at DB level
CREATE RULE snapshots_no_update AS ON UPDATE TO snapshots DO INSTEAD NOTHING;
CREATE RULE snapshots_no_delete AS ON DELETE TO snapshots DO INSTEAD NOTHING;

-- ─────────────────────────────────────────────────────────
-- 15. SYSTEM PARAMS  (Admin-only global config)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_params (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL,
  updated_by  UUID        REFERENCES staff(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defaults
INSERT INTO system_params (key, value) VALUES
  ('commission_rate_a',         '"0.20"'),
  ('commission_rate_b',         '"0.15"'),
  ('kam_bonus_rate_a',          '"0.05"'),
  ('kam_bonus_rate_b',          '"0.03"'),
  ('kam_threshold_days',        '"180"'),
  ('leader_standard_threshold', '"50000"'),
  ('leader_minimum_threshold',  '"35000"'),
  ('leader_mgmt_pct',           '"0.01"'),
  ('spinoff_legacy_pct',        '"0.005"'),
  ('min_order_boxes',           '"3"'),
  ('free_shipping_boxes',       '"5"'),
  ('bounty_first_order',        '"50"'),
  ('bounty_90d_amount',         '"1000"'),
  ('bounty_90d_reward',         '"50"'),
  ('bounty_180d_amount',        '"2000"'),
  ('bounty_180d_reward',        '"100"'),
  ('bounty_365d_amount',        '"6000"'),
  ('bounty_365d_reward',        '"200"')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 16. EMAIL ROUTING
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_routing (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module        TEXT NOT NULL UNIQUE,
  sender_email  TEXT NOT NULL,
  sender_name   TEXT NOT NULL
);

INSERT INTO email_routing (module, sender_email, sender_name) VALUES
  ('finance',   'finance@yourdomain.com',   'MediGlove Finance'),
  ('operations','info@yourdomain.com',       'MediGlove Operations'),
  ('hr',        'care@yourdomain.com',       'MediGlove HR'),
  ('purchasing','admin@yourdomain.com',      'MediGlove Purchasing')
ON CONFLICT (module) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 17. EMAIL TEMPLATES  (variable-injection HTML store)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  subject     TEXT        NOT NULL,
  html_body   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────
-- 18. LEADER PERFORMANCE LOG  (monthly snapshot for demotion logic)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leader_performance_log (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id          UUID          NOT NULL REFERENCES staff(id),
  log_month         INTEGER       NOT NULL CHECK (log_month BETWEEN 1 AND 12),
  log_year          INTEGER       NOT NULL,
  personal_gmv      NUMERIC(14,2) NOT NULL DEFAULT 0,
  threshold_used    NUMERIC(14,2) NOT NULL,  -- 50k standard or 35k admin-exempted
  is_exempted       BOOLEAN       NOT NULL DEFAULT FALSE,
  passed            BOOLEAN       NOT NULL,
  consecutive_fails INTEGER       NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, log_month, log_year)
);

-- ─────────────────────────────────────────────────────────
-- 19. SPINOFF LEGACY MAP  (permanent 0.5% link after team split)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spinoff_legacy_map (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id       UUID        NOT NULL REFERENCES staff(id),
  protege_id      UUID        NOT NULL REFERENCES staff(id),
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mentor_id, protege_id)
);

COMMENT ON TABLE spinoff_legacy_map IS
  'When a Sales reaches RM50k and spins off, mentor retains 0.5% from protegeʼs team GMV forever.';

-- ─────────────────────────────────────────────────────────
-- 20. INDEXES  (query performance)
-- ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clients_owner_id       ON clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_clients_is_orphan      ON clients(is_orphan) WHERE is_orphan = TRUE;
CREATE INDEX IF NOT EXISTS idx_invoices_client_id     ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by    ON invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_status        ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice  ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_commissions_invoice    ON commissions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_commissions_staff      ON commissions(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_leader_id        ON staff(leader_id);
CREATE INDEX IF NOT EXISTS idx_staff_auth_user_id     ON staff(auth_user_id);
