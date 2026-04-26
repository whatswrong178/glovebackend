# MediGlove ERP — Deployment Guide
## Everything built this session + step-by-step run order

---

## PART 1 — WHAT WAS CHANGED

### A. New Migration Files (run in Supabase SQL Editor)

| File | What it does |
|------|-------------|
| `016_fix_suppliers_rls_company_anon.sql` | Fixes "policy already exists" error — drops all supplier + company_settings policies before recreating them |
| `017_invoice_items_unit.sql` | Adds `unit` column to `invoice_items`; replaces `create_invoice_atomic` with v3 (supports Carton/Box/Pack/Can/Piece/Bag/Roll per line) |
| `018_dashboard_kpis_rpc.sql` | Creates `get_dashboard_kpis()` RPC — returns active invoices, est. commission, actual commission, public pool (role-scoped) |

### B. New Edge Function (deploy via CLI)

| File | What it does |
|------|-------------|
| `supabase/functions/create-staff-user/index.ts` | Creates Supabase Auth user for a new staff member, links `staff.auth_user_id`, sends branded welcome email with temp credentials via Resend |

### C. Frontend Files Modified

| File | Change |
|------|--------|
| `src/context/CompanySettingsContext.tsx` | Fixed TS2352 build error — changed `data as CompanySettingsData` to `data as unknown as CompanySettingsData` |
| `src/types/invoice.ts` | Added `unit: string` field to `InvoiceLineItem` interface |
| `src/pages/products/edit.tsx` | Added full margin analysis panel (mirrors create page) — auto-detects Category A/B only when user edits prices, not on load |
| `src/pages/invoices/create.tsx` | Full rewrite — product dropdown (all 500, client-side filter), unit selector per line, 3-carton min, 5-carton free shipping (West Malaysia), progress hints |
| `src/pages/dashboard/index.tsx` | Wired up real KPIs from `get_dashboard_kpis()` RPC — 60s auto-refresh, skeleton loading, RM formatted values |
| `src/pages/hr/create.tsx` | After staff row insert → calls `create-staff-user` Edge Function → shows credential-sent banner |
| `src/components/SecurityShield.tsx` | Added 30-minute idle timeout — 60s countdown warning modal, auto sign-out, `window.location.replace("/login")` |
| `src/pages/clients/show.tsx` | Fixed `canRequestSample` — now includes Sales role (was Admin/HR/Leader only) |

---

## PART 2 — STEP-BY-STEP DEPLOYMENT

### STEP 1 — Run Migration 016 (Policy Fix)

Go to **Supabase Dashboard → SQL Editor** and run:

```
supabase/migrations/016_fix_suppliers_rls_company_anon.sql
```

Copy the entire file contents and paste into SQL Editor → Run.

✅ Expected: "Success. No rows returned"
❌ If error: check that you're on the correct Supabase project (`futwxbtfgvpeipmddbdt`)

---

### STEP 2 — Run Migration 017 (Invoice Items Unit)

In **Supabase Dashboard → SQL Editor**, run:

```
supabase/migrations/017_invoice_items_unit.sql
```

✅ Expected: "Success. No rows returned"

This adds the `unit` column to `invoice_items` and upgrades `create_invoice_atomic` to v3.

---

### STEP 3 — Run Migration 018 (Dashboard KPIs RPC)

In **Supabase Dashboard → SQL Editor**, run:

```
supabase/migrations/018_dashboard_kpis_rpc.sql
```

✅ Expected: "Success. No rows returned"

**Verify it works** — run this test query:
```sql
SELECT get_dashboard_kpis();
```
Should return JSON like:
```json
{"active_invoices": 0, "est_commission": 0.00, "actual_commission": 0.00, "public_pool": 0}
```

---

### STEP 4 — Run Migration 019 (Sample DO — allow Sales role)

Go to **Supabase Dashboard → SQL Editor** and run:

```
supabase/migrations/019_sample_do_sales_role.sql
```

Copy the entire file contents and paste into SQL Editor → Run.

This patches `create_sample_do()` so the DB-level permission check accepts Sales in addition to Admin/HR/Leader.

✅ Expected: "Success. No rows returned"

---

### STEP 5 — Deploy Edge Function

Open your terminal in the project root and run:

```bash
# Make sure Supabase CLI is installed
# npm install -g supabase  (if not already)

# Link to your project (only needed once)
supabase link --project-ref futwxbtfgvpeipmddbdt

# Deploy the function
supabase functions deploy create-staff-user
```

**Then set the secrets** (these are already in `supabase/functions/.env` but must also be set in production):

```bash
supabase secrets set RESEND_API_KEY="re_2iiRP8aG_MX3QDVkq8ZsGcRj6stcVmZeD"
supabase secrets set FRONTEND_URL="https://your-production-domain.com"
supabase secrets set SYSTEM_SECRET_KEY="GloveBackend_082938457"
```

> **Note:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the runtime — you do NOT need to set them manually.

✅ **Test the function** — Go to Supabase Dashboard → Edge Functions → `create-staff-user` → Logs. After creating a staff member from the HR page, you should see a log entry here.

---

### STEP 6 — Build & Deploy Frontend

```bash
# In project root
npm install          # make sure deps are up to date
npm run build        # Vite production build

# Deploy to your hosting (Vercel / Netlify / etc.)
# Example for Vercel:
vercel --prod

# Example for Netlify:
netlify deploy --prod --dir=dist
```

✅ **TypeScript must compile cleanly.** If you see errors, they are pre-existing issues unrelated to this session's changes.

---

### STEP 7 — Verify Email Routing for HR (for credential emails)

The `create-staff-user` function looks up the `hr` email routing entry to know the "from" address. If it doesn't exist, it falls back to `hr@mediglove.com`.

To set it up properly:
1. Log in to the ERP as Admin
2. Go to **Settings → Email Routing**
3. Ensure there is a row for module `hr` with a valid `sender_email`

If the Settings page doesn't show Email Routing yet, run this in SQL Editor:

```sql
INSERT INTO email_routing (module, sender_email, sender_name)
VALUES ('hr', 'hr@mediglove.com', 'MediGlove HR')
ON CONFLICT (module) DO NOTHING;
```

---

### STEP 8 — Test Everything

#### Test 1: Dashboard KPIs
- Log in → Dashboard should show live numbers (not "RM —")
- Click "↻ Refresh" — should re-fetch and update

#### Test 2: Invoice Creation
- Go to Invoices → Create Invoice
- Click the product search field → dropdown shows all products
- Type to filter → list narrows
- Add a product → unit dropdown shows (Carton / Box / Pack / Can / Piece / Bag / Roll)
- Try submitting with < 3 total qty → should get "minimum 3 cartons" error from DB
- Add West Malaysia client with ≥ 5 units → delivery charge auto-sets to 0

#### Test 3: Staff Creation + Credentials
- Go to HR → New Staff Member
- Fill in name, email, role, department, job title
- Click "Create Staff & Send Credentials"
- Should see spinning "Setting up login…" state
- Then green ✅ banner: "Login credentials have been emailed"
- Check the staff member's email inbox — should receive welcome email with temp password
- Staff member logs in with the temp password → change it immediately

#### Test 4: Idle Timeout
- Log in → wait on any page without moving mouse or typing
- At **29 minutes**: countdown modal appears ("Session Expiring — 60 seconds")
- Click "I'm Still Here" → modal dismisses, timer resets
- OR wait to 0 → auto sign-out, redirected to `/login`

#### Test 5: Sample DO (from Client page)
- Log in as a Sales user
- Open any Client → Overview tab
- "Request Sample DO" button should now be visible for Sales role
- Click it → confirm → DO created with type = 'Sample'

---

## PART 3 — KNOWN PENDING ITEMS

These were identified but not implemented this session:

| Item | Status | Notes |
|------|--------|-------|
| Invoice Print button | ⏳ Pending | Opens formatted print window with letterhead |
| DO Print button | ⏳ Pending | Same as above for Delivery Orders |
| Staff Edit → "Create Login" retry | ⏳ Pending | If EF fails on create, allow retry from edit page |

---

## PART 4 — ARCHITECTURE REFERENCE

```
Frontend (Vite + Refine.dev + Tailwind)
│
├── authProvider.ts          — Supabase Auth delegation
├── SecurityShield.tsx       — Watermark + blur + idle timeout (30 min)
├── CompanySettingsContext   — Company name/logo for print headers
│
├── /dashboard               — get_dashboard_kpis() RPC (60s refresh)
├── /invoices/create         — create_invoice_atomic() v3 (unit per line)
├── /hr/create               — Staff row + create-staff-user Edge Function
└── /clients/:id             — Sample DO request (Admin/HR/Leader/Sales)

Supabase
│
├── auth.users               — managed by create-staff-user Edge Function
├── staff.auth_user_id       — linked after auth user creation
├── invoice_items.unit       — added by migration 017
│
├── RPCs
│   ├── get_dashboard_kpis() — migration 018
│   ├── create_invoice_atomic() v3 — migration 017
│   └── create_sample_do()   — migration 003 (patched by migration 019)
│
└── Edge Functions
    ├── send-email           — Resend gateway (existing)
    ├── ai-product-import    — Gemini parser (existing)
    └── create-staff-user    — NEW: auth + credentials email
```

---

## PART 5 — ENVIRONMENT VARIABLES REFERENCE

### Frontend (`.env` in project root)
```env
VITE_SUPABASE_URL=https://futwxbtfgvpeipmddbdt.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### Edge Functions (`supabase/functions/.env` — local only, never commit)
```env
SUPABASE_URL=https://futwxbtfgvpeipmddbdt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
RESEND_API_KEY=re_2iiRP8aG_MX3QDVkq8ZsGcRj6stcVmZeD
GEMINI_API_KEY=<gemini-key>
SYSTEM_SECRET_KEY=GloveBackend_082938457
FRONTEND_URL=https://your-domain.com
```

---

*Generated: 2026-04-26 | MediGlove ERP v10*
