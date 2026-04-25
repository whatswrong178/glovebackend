-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 013: Settings + Supplier + Email Templates (EPIC-09)
--
-- 1. Suppliers table: add is_active, contact_person columns.
-- 2. Email templates: seed all missing templates (Invoice, DO, Receipt,
--    Welcome, PO, Dunning Reminder x4 stages).
-- 3. System params: seed LADDER_MATRIX JSON param.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Suppliers: extend schema
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'contact_person'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN contact_person TEXT;
  END IF;
END;
$$;

-- Supplier RLS (Admin full control, others read-only)
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_admin_all  ON suppliers;
DROP POLICY IF EXISTS suppliers_staff_read ON suppliers;

CREATE POLICY suppliers_admin_all ON suppliers
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  );

CREATE POLICY suppliers_staff_read ON suppliers
  FOR SELECT TO authenticated
  USING (TRUE);  -- all staff can read supplier list for product forms

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Email Templates: seed all standard templates
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO email_templates (name, subject, html_body) VALUES

-- Invoice
('invoice', 'Invoice {{invoiceNo}} from MediGlove',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#2563eb">Invoice {{invoiceNo}}</h2>
<p>Dear {{clientName}},</p>
<p>Please find your invoice details below:</p>
<table style="width:100%;border-collapse:collapse;margin-top:16px">
  <tr style="background:#f1f5f9"><th style="text-align:left;padding:8px;border:1px solid #e2e8f0">Description</th><th style="text-align:right;padding:8px;border:1px solid #e2e8f0">Amount</th></tr>
  <tr><td style="padding:8px;border:1px solid #e2e8f0">{{invoiceItems}}</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:right">RM {{total}}</td></tr>
</table>
<p style="margin-top:16px"><strong>Total: RM {{total}}</strong></p>
<p>Credit Terms: {{creditTerms}} | Due: {{dueDate}}</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">MediGlove Sdn Bhd · finance@mediglove.com</p>
</body></html>'),

-- E-DO (Delivery Order)
('delivery_order', 'Delivery Order {{doNo}} — MediGlove',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#059669">Delivery Order {{doNo}}</h2>
<p>Dear {{clientName}},</p>
<p>Your delivery has been dispatched. Details:</p>
<table style="width:100%;border-collapse:collapse;margin-top:16px">
  <tr style="background:#f0fdf4"><th style="padding:8px;border:1px solid #bbf7d0;text-align:left">DO No.</th><td style="padding:8px;border:1px solid #bbf7d0">{{doNo}}</td></tr>
  <tr><th style="padding:8px;border:1px solid #bbf7d0;text-align:left">Invoice Ref</th><td style="padding:8px;border:1px solid #bbf7d0">{{invoiceNo}}</td></tr>
  <tr style="background:#f0fdf4"><th style="padding:8px;border:1px solid #bbf7d0;text-align:left">Logistics</th><td style="padding:8px;border:1px solid #bbf7d0">{{logisticsName}}</td></tr>
</table>
<p style="margin-top:24px;color:#64748b;font-size:12px">MediGlove Sdn Bhd · info@mediglove.com</p>
</body></html>'),

-- Receipt
('receipt', 'Payment Receipt — Invoice {{invoiceNo}}',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#059669">✓ Payment Received</h2>
<p>Dear {{clientName}},</p>
<p>We confirm receipt of your payment for Invoice <strong>{{invoiceNo}}</strong>.</p>
<p><strong>Amount Paid: RM {{total}}</strong></p>
<p>Payment Date: {{paidAt}}</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">MediGlove Sdn Bhd · finance@mediglove.com</p>
</body></html>'),

-- Welcome
('welcome', 'Welcome to MediGlove, {{staffName}}!',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#2563eb">Welcome to MediGlove! 🎉</h2>
<p>Dear {{staffName}},</p>
<p>We are thrilled to have you join the MediGlove family as <strong>{{role}}</strong>.</p>
<p>Your login credentials will be sent separately. Please change your password on first login.</p>
<p>Your team lead is <strong>{{leaderName}}</strong>. Do not hesitate to reach out for guidance.</p>
<p style="margin-top:24px">Welcome aboard,<br/>MediGlove HR Team</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">care@mediglove.com</p>
</body></html>'),

-- Purchase Order
('purchase_order', 'Purchase Order {{poNo}} — MediGlove',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#7c3aed">Purchase Order {{poNo}}</h2>
<p>Dear {{supplierName}},</p>
<p>Please process the following purchase order:</p>
<table style="width:100%;border-collapse:collapse;margin-top:16px">
  <tr style="background:#f5f3ff"><th style="padding:8px;border:1px solid #ddd8fe;text-align:left">SKU</th><th style="padding:8px;border:1px solid #ddd8fe">Product</th><th style="padding:8px;border:1px solid #ddd8fe">Qty</th><th style="padding:8px;border:1px solid #ddd8fe">Unit Cost</th></tr>
  {{poItems}}
</table>
<p style="margin-top:16px"><strong>Total: RM {{poTotal}}</strong></p>
<p>Deliver to: {{deliveryAddress}}</p>
<p>Required By: {{requiredBy}}</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">MediGlove Sdn Bhd · admin@mediglove.com</p>
</body></html>'),

-- Dunning T-7
('dunning_t-7', 'Friendly Reminder: Invoice {{invoiceNo}} Due in 7 Days',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#2563eb">Payment Reminder</h2>
<p>Dear {{clientName}},</p>
<p>This is a friendly reminder that Invoice <strong>{{invoiceNo}}</strong> for <strong>RM {{total}}</strong> is due on <strong>{{dueDate}}</strong>.</p>
<p>Please arrange payment at your earliest convenience to maintain your account in good standing.</p>
<p>If you have already made payment, please disregard this notice.</p>
<p style="margin-top:24px">Thank you for your continued business.</p>
<p>MediGlove Finance Team</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">finance@mediglove.com</p>
</body></html>'),

-- Dunning T+0
('dunning_t0', 'Payment Due Today: Invoice {{invoiceNo}}',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#d97706">⚠ Payment Due Today</h2>
<p>Dear {{clientName}},</p>
<p>Invoice <strong>{{invoiceNo}}</strong> for <strong>RM {{total}}</strong> is due <strong>today ({{dueDate}})</strong>.</p>
<p>Please process payment immediately or contact us to arrange an extension.</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">finance@mediglove.com</p>
</body></html>'),

-- Dunning T+3
('dunning_t+3', '⚠️ Overdue: Invoice {{invoiceNo}} — {{overdueDays}} Days Past Due',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#dc2626">Overdue Payment Notice</h2>
<p>Dear {{clientName}},</p>
<p>Invoice <strong>{{invoiceNo}}</strong> for <strong>RM {{total}}</strong> is now <strong>{{overdueDays}} days overdue</strong> (due: {{dueDate}}).</p>
<p>Please settle immediately to avoid service disruption.</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">finance@mediglove.com</p>
</body></html>'),

-- Dunning T+7
('dunning_t+7', '🔴 FINAL NOTICE: Invoice {{invoiceNo}} — {{overdueDays}} Days Overdue',
'<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e293b;padding:32px">
<h2 style="color:#991b1b">🔴 FINAL NOTICE</h2>
<p>Dear {{clientName}},</p>
<p>Invoice <strong>{{invoiceNo}}</strong> for <strong>RM {{total}}</strong> remains unpaid <strong>{{overdueDays}} days</strong> after due date ({{dueDate}}).</p>
<p><strong>Failure to settle within 3 business days may result in account suspension and referral to collections.</strong></p>
<p>Please contact finance@mediglove.com immediately.</p>
<p style="color:#64748b;font-size:12px;margin-top:32px">finance@mediglove.com</p>
</body></html>')

ON CONFLICT (name) DO UPDATE
  SET subject   = EXCLUDED.subject,
      html_body = EXCLUDED.html_body,
      updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. System params: LADDER_MATRIX JSON seed
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO system_params (key, value) VALUES
  ('LADDER_MATRIX', '[
    {"name":"Starter",  "minRevenue":0,       "bonus":0   },
    {"name":"Bronze",   "minRevenue":10000,   "bonus":0   },
    {"name":"Silver",   "minRevenue":20000,   "bonus":400 },
    {"name":"Gold",     "minRevenue":50000,   "bonus":1000},
    {"name":"Platinum", "minRevenue":120000,  "bonus":2500},
    {"name":"Diamond",  "minRevenue":200000,  "bonus":4000}
  ]')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value;

-- Email routing RLS
ALTER TABLE email_routing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_routing_admin_all  ON email_routing;
DROP POLICY IF EXISTS email_routing_staff_read ON email_routing;

CREATE POLICY email_routing_admin_all ON email_routing
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  );

CREATE POLICY email_routing_staff_read ON email_routing
  FOR SELECT TO authenticated USING (TRUE);

-- Email templates RLS
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_templates_admin_all  ON email_templates;
DROP POLICY IF EXISTS email_templates_staff_read ON email_templates;

CREATE POLICY email_templates_admin_all ON email_templates
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'Admin')
  );

CREATE POLICY email_templates_staff_read ON email_templates
  FOR SELECT TO authenticated USING (TRUE);
