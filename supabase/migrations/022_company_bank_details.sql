-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 022 — Company Bank Account Details
-- Adds four bank columns to company_settings singleton.
-- These are rendered on printed invoices and sent in invoice email templates.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS bank_name         TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no   TEXT,
  ADD COLUMN IF NOT EXISTS bank_swift_code   TEXT;

COMMENT ON COLUMN company_settings.bank_name         IS 'e.g. Maybank / CIMB / Public Bank';
COMMENT ON COLUMN company_settings.bank_account_name IS 'Account holder name exactly as registered';
COMMENT ON COLUMN company_settings.bank_account_no   IS 'Bank account number';
COMMENT ON COLUMN company_settings.bank_swift_code   IS 'SWIFT/BIC code for international transfers';
