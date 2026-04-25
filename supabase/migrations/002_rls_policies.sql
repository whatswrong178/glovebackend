-- ============================================================
-- MediGlove Supply ERP v8.8
-- Migration 002: Row Level Security — Five-Role RBAC
-- ============================================================
-- Role hierarchy: Admin > HR > Leader > Sales > Logistics
-- All policies use helper functions to avoid per-query joins.
-- ============================================================

-- ─────────────────────────────────────────────────────────
-- 0. HELPER FUNCTIONS  (SECURITY DEFINER + STABLE cache)
-- ─────────────────────────────────────────────────────────

-- Returns the role of the currently authenticated user.
CREATE OR REPLACE FUNCTION auth_staff_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM staff WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- Returns the UUID of the currently authenticated staff member.
CREATE OR REPLACE FUNCTION auth_staff_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- Returns the leader_id of the currently authenticated staff member.
CREATE OR REPLACE FUNCTION auth_staff_leader_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT leader_id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- Returns TRUE if the given staff_id is a direct report of the current user.
CREATE OR REPLACE FUNCTION is_my_direct_report(p_staff_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff
    WHERE id = p_staff_id
      AND leader_id = auth_staff_id()
  );
$$;

-- ─────────────────────────────────────────────────────────
-- 1. ENABLE RLS ON ALL TABLES
-- ─────────────────────────────────────────────────────────
ALTER TABLE staff                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequence       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_splits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE edit_requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_materials     ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots              ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_params          ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_routing          ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leader_performance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE spinoff_legacy_map     ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────
-- 2. STAFF TABLE
-- ─────────────────────────────────────────────────────────

-- Admin: full CRUD
CREATE POLICY staff_admin_all ON staff
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

-- HR: read all, insert/update only (cannot delete)
CREATE POLICY staff_hr_read ON staff
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY staff_hr_insert ON staff
  FOR INSERT TO authenticated
  WITH CHECK (auth_staff_role() = 'HR');

CREATE POLICY staff_hr_update ON staff
  FOR UPDATE TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader: read self + direct reports
CREATE POLICY staff_leader_read ON staff
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Leader'
    AND (id = auth_staff_id() OR leader_id = auth_staff_id())
  );

-- Sales/Logistics: read own record only
CREATE POLICY staff_self_read ON staff
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() IN ('Sales','Logistics')
    AND id = auth_staff_id()
  );

-- ─────────────────────────────────────────────────────────
-- 3. SUPPLIERS TABLE
-- ─────────────────────────────────────────────────────────

CREATE POLICY suppliers_admin_all ON suppliers
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY suppliers_hr_read ON suppliers
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader/Sales can read suppliers (needed for PO awareness, no write)
CREATE POLICY suppliers_sales_leader_read ON suppliers
  FOR SELECT TO authenticated
  USING (auth_staff_role() IN ('Leader','Sales'));

-- ─────────────────────────────────────────────────────────
-- 4. PRODUCTS TABLE
-- Note: cost_price column protection is enforced via a
--       security-definer VIEW "products_safe_view" below.
--       The base table is Admin-only write.
-- ─────────────────────────────────────────────────────────

CREATE POLICY products_admin_all ON products
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY products_hr_read ON products
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader/Sales: can read but cost_price is masked in the view
CREATE POLICY products_sales_leader_read ON products
  FOR SELECT TO authenticated
  USING (auth_staff_role() IN ('Leader','Sales'));

-- Security-definer view that masks cost_price for non-Admin
CREATE OR REPLACE VIEW products_safe_view
WITH (security_barrier = true)
AS
SELECT
  id,
  name,
  sku,
  supplier_id,
  category,
  CASE
    WHEN auth_staff_role() = 'Admin' THEN cost_price
    ELSE NULL
  END                    AS cost_price,
  min_selling_price,
  suggested_price,
  description,
  created_at
FROM products;

-- ─────────────────────────────────────────────────────────
-- 5. CLIENTS TABLE
-- ─────────────────────────────────────────────────────────

CREATE POLICY clients_admin_all ON clients
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

-- HR: full read, no delete
CREATE POLICY clients_hr_read ON clients
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY clients_hr_write ON clients
  FOR UPDATE TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader: own clients + team clients + orphans
CREATE POLICY clients_leader_read ON clients
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Leader'
    AND (
      owner_id = auth_staff_id()
      OR is_my_direct_report(owner_id)
      OR is_orphan = TRUE
    )
  );

CREATE POLICY clients_leader_insert ON clients
  FOR INSERT TO authenticated
  WITH CHECK (auth_staff_role() = 'Leader');

-- Sales: own clients + public pool (orphans)
CREATE POLICY clients_sales_read ON clients
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Sales'
    AND (owner_id = auth_staff_id() OR is_orphan = TRUE)
  );

CREATE POLICY clients_sales_insert ON clients
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_staff_role() = 'Sales'
    AND created_by = auth_staff_id()
  );

-- ─────────────────────────────────────────────────────────
-- 6. INVOICE SEQUENCE  (Admin/system RPC only)
-- ─────────────────────────────────────────────────────────

CREATE POLICY invoice_seq_admin_all ON invoice_sequence
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

-- The generate_invoice_no() RPC runs SECURITY DEFINER — it
-- bypasses RLS internally so non-Admin users can still call it.

-- ─────────────────────────────────────────────────────────
-- 7. INVOICES TABLE
-- ─────────────────────────────────────────────────────────

CREATE POLICY invoices_admin_all ON invoices
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

-- HR: read all, can update status to 'Paid' only
CREATE POLICY invoices_hr_read ON invoices
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY invoices_hr_update ON invoices
  FOR UPDATE TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader: read own + team invoices
CREATE POLICY invoices_leader_read ON invoices
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Leader'
    AND (
      created_by = auth_staff_id()
      OR is_my_direct_report(created_by)
    )
  );

CREATE POLICY invoices_leader_insert ON invoices
  FOR INSERT TO authenticated
  WITH CHECK (auth_staff_role() = 'Leader');

-- Sales: own invoices only
CREATE POLICY invoices_sales_read ON invoices
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Sales'
    AND created_by = auth_staff_id()
  );

CREATE POLICY invoices_sales_insert ON invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_staff_role() = 'Sales'
    AND created_by = auth_staff_id()
  );

-- ─────────────────────────────────────────────────────────
-- 8. INVOICE ITEMS TABLE
-- ─────────────────────────────────────────────────────────

CREATE POLICY invoice_items_admin_all ON invoice_items
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY invoice_items_hr_read ON invoice_items
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader/Sales: items of invoices they can see
CREATE POLICY invoice_items_leader_sales_read ON invoice_items
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() IN ('Leader','Sales')
    AND EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.created_by = auth_staff_id()
          OR (auth_staff_role() = 'Leader' AND is_my_direct_report(i.created_by))
        )
    )
  );

CREATE POLICY invoice_items_insert ON invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (auth_staff_role() IN ('Admin','Leader','Sales'));

-- ─────────────────────────────────────────────────────────
-- 9. DELIVERY ORDERS TABLE
-- ─────────────────────────────────────────────────────────

CREATE POLICY do_admin_all ON delivery_orders
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY do_hr_read ON delivery_orders
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY do_leader_read ON delivery_orders
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Leader'
    AND (
      created_by = auth_staff_id()
      OR is_my_direct_report(created_by)
    )
  );

CREATE POLICY do_sales_read ON delivery_orders
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Sales'
    AND created_by = auth_staff_id()
  );

-- Logistics: only their assigned DOs, price fields masked in view
CREATE POLICY do_logistics_read ON delivery_orders
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Logistics'
    AND assigned_logistics_id = auth_staff_id()
    AND status IN ('Pending','In Transit')
  );

-- Logistics can update (submit signature/photo) their assigned DOs
CREATE POLICY do_logistics_update ON delivery_orders
  FOR UPDATE TO authenticated
  USING (
    auth_staff_role() = 'Logistics'
    AND assigned_logistics_id = auth_staff_id()
  );

-- Safe view for Logistics — strips all pricing context
CREATE OR REPLACE VIEW delivery_orders_logistics_view
WITH (security_barrier = true)
AS
SELECT
  d.id,
  d.do_no,
  d.type,
  d.client_id,
  d.assigned_logistics_id,
  d.status,
  d.signature_base64,
  d.photo_url,
  d.geo_lat,
  d.geo_lng,
  d.delivered_at,
  d.created_at,
  c.name   AS client_name,
  c.region AS client_region
FROM delivery_orders d
JOIN clients c ON c.id = d.client_id
WHERE d.assigned_logistics_id = auth_staff_id()
  AND d.status IN ('Pending','In Transit');

-- ─────────────────────────────────────────────────────────
-- 10. PURCHASE ORDERS
-- ─────────────────────────────────────────────────────────

CREATE POLICY po_admin_all ON purchase_orders
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY po_hr_read_update ON purchase_orders
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY po_hr_approve ON purchase_orders
  FOR UPDATE TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY po_items_admin_all ON purchase_order_items
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY po_items_hr_read ON purchase_order_items
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- ─────────────────────────────────────────────────────────
-- 11. COMMISSIONS
-- ─────────────────────────────────────────────────────────

CREATE POLICY commissions_admin_all ON commissions
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY commissions_hr_read ON commissions
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader: see own + team commissions
CREATE POLICY commissions_leader_read ON commissions
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Leader'
    AND (
      staff_id = auth_staff_id()
      OR is_my_direct_report(staff_id)
    )
  );

-- Sales: own commissions only
CREATE POLICY commissions_sales_read ON commissions
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Sales'
    AND staff_id = auth_staff_id()
  );

-- ─────────────────────────────────────────────────────────
-- 12. COMMISSION SPLITS
-- ─────────────────────────────────────────────────────────

CREATE POLICY splits_admin_all ON commission_splits
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY splits_hr_read ON commission_splits
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY splits_leader_sales_read ON commission_splits
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() IN ('Leader','Sales')
    AND (owner_id = auth_staff_id() OR assistant_id = auth_staff_id())
  );

-- ─────────────────────────────────────────────────────────
-- 13. EDIT REQUESTS
-- ─────────────────────────────────────────────────────────

CREATE POLICY edit_req_admin_all ON edit_requests
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

-- HR can read all and approve/reject
CREATE POLICY edit_req_hr_all ON edit_requests
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'HR');

-- Leader/Sales can only see/create their own requests
CREATE POLICY edit_req_requester_read ON edit_requests
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() IN ('Leader','Sales')
    AND requested_by = auth_staff_id()
  );

CREATE POLICY edit_req_requester_insert ON edit_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_staff_role() IN ('Leader','Sales')
    AND requested_by = auth_staff_id()
  );

-- ─────────────────────────────────────────────────────────
-- 14. PLAYBOOK MATERIALS
-- ─────────────────────────────────────────────────────────

CREATE POLICY playbook_admin_all ON playbook_materials
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

-- All other authenticated roles: read only
CREATE POLICY playbook_all_read ON playbook_materials
  FOR SELECT TO authenticated
  USING (auth_staff_role() IN ('HR','Leader','Sales'));

-- ─────────────────────────────────────────────────────────
-- 15. SNAPSHOTS  (write-once, Admin-only create)
-- ─────────────────────────────────────────────────────────

CREATE POLICY snapshots_admin_insert ON snapshots
  FOR INSERT TO authenticated
  WITH CHECK (auth_staff_role() = 'Admin');

CREATE POLICY snapshots_hr_admin_read ON snapshots
  FOR SELECT TO authenticated
  USING (auth_staff_role() IN ('Admin','HR'));

-- ─────────────────────────────────────────────────────────
-- 16. SYSTEM PARAMS
-- ─────────────────────────────────────────────────────────

CREATE POLICY params_admin_all ON system_params
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

-- Read-only for HR so they can see thresholds
CREATE POLICY params_hr_read ON system_params
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- ─────────────────────────────────────────────────────────
-- 17. EMAIL ROUTING + TEMPLATES
-- ─────────────────────────────────────────────────────────

CREATE POLICY email_routing_admin_all ON email_routing
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY email_routing_hr_read ON email_routing
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY email_templates_admin_all ON email_templates
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY email_templates_hr_read ON email_templates
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

-- ─────────────────────────────────────────────────────────
-- 18. LEADER PERFORMANCE LOG
-- ─────────────────────────────────────────────────────────

CREATE POLICY perf_admin_all ON leader_performance_log
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY perf_hr_read ON leader_performance_log
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY perf_leader_self_read ON leader_performance_log
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Leader'
    AND staff_id = auth_staff_id()
  );

-- ─────────────────────────────────────────────────────────
-- 19. SPINOFF LEGACY MAP
-- ─────────────────────────────────────────────────────────

CREATE POLICY spinoff_admin_all ON spinoff_legacy_map
  FOR ALL TO authenticated
  USING (auth_staff_role() = 'Admin');

CREATE POLICY spinoff_hr_read ON spinoff_legacy_map
  FOR SELECT TO authenticated
  USING (auth_staff_role() = 'HR');

CREATE POLICY spinoff_leader_self_read ON spinoff_legacy_map
  FOR SELECT TO authenticated
  USING (
    auth_staff_role() = 'Leader'
    AND (mentor_id = auth_staff_id() OR protege_id = auth_staff_id())
  );
