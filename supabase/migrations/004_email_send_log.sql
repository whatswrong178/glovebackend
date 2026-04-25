-- ============================================================
-- MediGlove Supply ERP v8.8
-- Migration 004: Email Send Log (audit trail for Edge Function)
-- ============================================================

CREATE TABLE IF NOT EXISTS email_send_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resend_id      TEXT        NOT NULL,          -- Resend email ID for delivery tracking
  module         TEXT        NOT NULL,          -- finance | operations | hr | purchasing
  template_name  TEXT        NOT NULL,
  recipients     TEXT[]      NOT NULL,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin/HR can read the send log; write is Edge-Function-only (service role)
ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_log_admin_read ON email_send_log
  FOR SELECT TO authenticated
  USING (auth_staff_role() IN ('Admin','HR'));

-- Index for date-range queries on the audit log
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at ON email_send_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_module  ON email_send_log(module);
