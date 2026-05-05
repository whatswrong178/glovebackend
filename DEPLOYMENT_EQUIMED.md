# Equimed Supply Enterprise — Deployment Guide

**Domain:** equimedsupply.com  
**ERP:** erp.equimedsupply.com  
**Email:** @equimedsupply.com  
**Stack:** Supabase (backend) · Vercel (ERP) · GitHub Pages or Vercel (marketing site) · Resend (transactional email) · Zoho Mail (company email)

---

## Phase 1 — DNS Baseline (Do This First)

All DNS changes are made at your domain registrar (e.g. Cloudflare, Namecheap, GoDaddy).

### 1.1 Point root domain to marketing website

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | 76.76.21.21 | Auto |
| CNAME | www | cname.vercel-dns.com | Auto |

> Use Vercel's IPs above if hosting the site on Vercel. If using GitHub Pages replace with `185.199.108.153` (and add CNAME `www → <username>.github.io`).

### 1.2 ERP subdomain

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | erp | cname.vercel-dns.com | Auto |

---

## Phase 2 — Supabase Project

You likely already have a Supabase project. Verify the following:

### 2.1 Run pending migrations

```bash
# Install Supabase CLI if not present
npm install -g supabase

# Link to your project
supabase link --project-ref <YOUR_PROJECT_REF>

# Push all migrations (001 → 029)
supabase db push
```

### 2.2 Create Storage bucket for product images

1. Go to **Supabase Dashboard → Storage → New bucket**
2. Name: `product-images`
3. Toggle **Public bucket: ON**
4. Click **Create bucket**
5. Go to **Policies tab** → Add policy:
   - Policy name: `Public read product-images`
   - Operation: SELECT
   - Target roles: (leave blank = all)
   - Expression: `bucket_id = 'product-images'`

### 2.3 Set Edge Function environment variables

Go to **Supabase Dashboard → Edge Functions → Manage secrets**:

```
RESEND_API_KEY        = re_xxxxxxxxxxxxxx      (from resend.com)
FRONTEND_URL          = https://erp.equimedsupply.com
```

### 2.4 Deploy Edge Functions

```bash
supabase functions deploy send-email
supabase functions deploy create-staff-user
```

---

## Phase 3 — ERP on Vercel (erp.equimedsupply.com)

### 3.1 Push code to GitHub

```bash
cd "Glove Backend Official"
git add -A
git commit -m "chore: deploy Equimed ERP v1"
git push origin main
```

### 3.2 Create Vercel project

1. Go to **vercel.com → New Project → Import Git Repository**
2. Select your repo
3. Framework preset: **Vite**
4. Root directory: `.` (the repo root, where `package.json` lives)
5. Build command: `npm run build`
6. Output directory: `dist`

### 3.3 Add environment variables in Vercel

Go to **Project → Settings → Environment Variables**:

```
VITE_SUPABASE_URL          = https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY     = eyJ...
```

> These are safe to expose — they're the public anon key, protected by Row Level Security.

### 3.4 Add custom domain

1. **Project → Settings → Domains**
2. Add `erp.equimedsupply.com`
3. Vercel will prompt you to add a CNAME record — you already did this in Phase 1
4. Wait for SSL certificate provisioning (~2 min)

### 3.5 Verify vercel.json headers

Your `vercel.json` already has security headers and a wildcard rewrite for the SPA. No changes needed.

---

## Phase 4 — Marketing Website (equimedsupply.com)

The file is at `website/index.html`. It is a single self-contained HTML file — no build step needed.

### Option A: Deploy with Vercel (recommended — same account)

1. In Vercel, create a **second project** (or use a monorepo config)
2. Root directory: `website`
3. Framework: **Other** (static site)
4. Output: `.` (the website folder itself)
5. Add domain `equimedsupply.com` and `www.equimedsupply.com`

**OR** add this to your existing Vercel project's `vercel.json` to serve the website folder at the root and the ERP at `/erp` (more complex, not recommended).

### Option B: GitHub Pages (free)

1. In your repo, go to **Settings → Pages**
2. Source: Deploy from a branch
3. Branch: `main`, folder: `/website`
4. GitHub will serve it at `<username>.github.io/<repo>`
5. Add your custom domain `equimedsupply.com` in the Pages settings
6. Update DNS: A record → `185.199.108.153` (and 3 more GitHub IPs for redundancy)

### Website environment config

The `website/index.html` fetches products from Supabase. Update the two constants near the top of the `<script>` block:

```js
const SUPABASE_URL  = "https://<YOUR_PROJECT_REF>.supabase.co";
const SUPABASE_ANON = "eyJ...your-anon-key...";
```

Replace with your actual values.

---

## Phase 5 — Company Email (@equimedsupply.com)

You need two separate email systems:
- **Zoho Mail** — for human mailboxes (edward@equimedsupply.com, info@equimedsupply.com, hr@equimedsupply.com)
- **Resend** — for transactional email sent by the ERP (invoices, staff credentials, etc.)

### 5.1 Zoho Mail setup (free plan supports 5 users)

1. Go to **zoho.com/mail** → Sign up with your domain
2. Verify domain ownership: Zoho will give you a TXT record to add to DNS
3. Add MX records:

| Type | Name | Value | Priority |
|------|------|-------|----------|
| MX | @ | mx.zoho.com | 10 |
| MX | @ | mx2.zoho.com | 20 |
| MX | @ | mx3.zoho.com | 50 |

4. Create mailboxes:
   - `info@equimedsupply.com` (general enquiries)
   - `hr@equimedsupply.com` (staff credentials sender)
   - `edward@equimedsupply.com` (or your name)

5. Access mail at **mail.zoho.com** or configure your email client (Outlook, Apple Mail) with IMAP.

### 5.2 Resend — transactional email

1. Go to **resend.com** → Create account → Add domain `equimedsupply.com`
2. Add the DNS records Resend provides (SPF TXT + DKIM CNAME × 3)
3. In Resend dashboard → **API Keys → Create** → Copy key
4. Add to Supabase secrets: `RESEND_API_KEY = re_xxxxxx`

### 5.3 Update email routing in ERP database

In Supabase SQL editor, update the email routing row to use your new domain:

```sql
UPDATE email_routing
SET
  sender_email = 'info@equimedsupply.com',
  sender_name  = 'Equimed Supply Enterprise'
WHERE id = (SELECT id FROM email_routing LIMIT 1);
```

### 5.4 SPF record (prevents spoofing, required)

Add a single TXT record that covers both Zoho and Resend:

| Type | Name | Value |
|------|------|-------|
| TXT | @ | `v=spf1 include:zoho.com include:_spf.resend.com ~all` |

> If Zoho already created an SPF record, merge them into one — you cannot have two SPF TXT records on the same name.

---

## Phase 6 — Post-Deployment Checklist

- [ ] `https://equimedsupply.com` loads the marketing site
- [ ] `https://erp.equimedsupply.com` loads the ERP login page
- [ ] ERP login works (Supabase Auth)
- [ ] Products page shows real data
- [ ] Print invoice PDF — company name shows "Equimed Supply Enterprise"
- [ ] Create a test staff user — welcome email arrives at their inbox
- [ ] Send a test invoice email — arrives from `info@equimedsupply.com`
- [ ] `info@equimedsupply.com` receives the enquiry form submissions from the website
- [ ] SSL certificates are green on both domains
- [ ] `robots.txt` is accessible at `equimedsupply.com/robots.txt`

---

## Quick Reference — Credentials to Keep Safe

| Service | Where to find |
|---------|--------------|
| Supabase project ref + anon key | Supabase Dashboard → Project Settings → API |
| Supabase service role key | Same page — never expose in frontend |
| Resend API key | resend.com → API Keys |
| Vercel deployment token | vercel.com → Account Settings → Tokens |
| Zoho admin password | zoho.com account |

---

*Generated: 2026-05-05 · Equimed Supply Enterprise ERP*
