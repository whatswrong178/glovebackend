# Make.com — 账期智能连环催款引擎 (Auto-Dunning T-08.3)

## 触发器
- **类型**: Scheduled (Cron)
- **时间**: 每日 09:00 KL (UTC+8 = 01:00 UTC) → `0 1 * * *`
- **场景名称**: `MediGlove_Auto_Dunning_Engine`

---

## Credit Terms → Due Days Mapping
| Credit Terms | Due Days |
|---|---|
| Cash Term | 0 (due on invoice date) |
| 30 Days | 30 |
| 60 Days | 60 |
| 90 Days | 90 |

---

## Scenario 流程

### Module 1 — Fetch All Active Invoices (HTTP > Make a Request)
- **URL**: `https://<PROJECT_REF>.supabase.co/rest/v1/invoices`
- **Method**: GET
- **Headers**:
  - `apikey`: `{{SUPABASE_SERVICE_KEY}}`
  - `Authorization`: `Bearer {{SUPABASE_SERVICE_KEY}}`
- **Query String**:
  - `select=id,invoice_no,created_at,total_amount,client_id,client(name,credit_terms,contact_email,contact_person)`
  - `status=eq.Active`

### Module 2 — Iterator (Flow Control > Iterator)
Array: `{{1.data}}`

### Module 3 — Compute Due Date & Overdue Days (Tools > Set Variables)
```
credit_days  = {{switch(2.client.credit_terms; "Cash Term"; 0; "30 Days"; 30; "60 Days"; 60; "90 Days"; 90; 0)}}
due_date     = {{addDays(parseDate(2.created_at; "YYYY-MM-DD"); credit_days)}}
overdue_days = {{dateDifference(now; due_date; "days")}}
due_date_fmt = {{formatDate(due_date; "D MMM YYYY")}}
```

### Module 4 — Router (Flow Control > Router)
4 branches based on `overdue_days`:

---

#### Branch A — T-7 (Friendly Reminder, 7 days before due)
- **Filter**: `{{overdue_days}} = -7`
- **Module**: Resend > Send Email
  - **From**: `finance@mediglove.com`
  - **To**: `{{2.client.contact_email}}`
  - **Subject**: `Friendly Reminder: Invoice {{2.invoice_no}} Due in 7 Days`
  - **Template**: `dunning_t-7`

```html
Dear {{clientName}},

This is a friendly reminder that Invoice <strong>{{invoiceNo}}</strong> 
for RM {{totalAmount}} is due on <strong>{{dueDate}}</strong>.

Please arrange payment at your earliest convenience to maintain your account in good standing.

Thank you for your business.

MediGlove Finance Team
```

---

#### Branch B — T+0 (Due Date Notification)
- **Filter**: `{{overdue_days}} = 0`
- **Subject**: `Payment Due Today: Invoice {{2.invoice_no}}`
- **Template**: `dunning_t0`

```html
Dear {{clientName}},

Invoice <strong>{{invoiceNo}}</strong> for RM {{totalAmount}} is due <strong>today ({{dueDate}})</strong>.

Please process payment immediately or contact us to arrange an extension.
```

---

#### Branch C — T+3 (Overdue Warning)
- **Filter**: `{{overdue_days}} = 3`
- **Subject**: `⚠️ Overdue: Invoice {{2.invoice_no}} — 3 Days Past Due`
- **Template**: `dunning_t+3`

```html
Dear {{clientName}},

Invoice <strong>{{invoiceNo}}</strong> for RM {{totalAmount}} is now 
<strong>{{overdueDays}} days overdue</strong> (due: {{dueDate}}).

Please settle immediately to avoid service disruption.
If payment has been made, please disregard this notice.
```

---

#### Branch D — T+7 (Final Notice)
- **Filter**: `{{overdue_days}} = 7`
- **Subject**: `🔴 FINAL NOTICE: Invoice {{2.invoice_no}} — 7 Days Overdue`
- **Template**: `dunning_t+7`
- **CC**: `sales@mediglove.com` (alert account owner)

```html
Dear {{clientName}},

This is a FINAL NOTICE. Invoice <strong>{{invoiceNo}}</strong> for RM {{totalAmount}} 
remains unpaid <strong>{{overdueDays}} days</strong> after due date ({{dueDate}}).

Failure to settle within 3 business days may result in account suspension and referral to collections.

Please contact finance@mediglove.com immediately.
```

---

## Template Variables Reference
| Variable | Source |
|---|---|
| `{{clientName}}` | `client.name` |
| `{{invoiceNo}}` | `invoice_no` |
| `{{totalAmount}}` | `total_amount` formatted as RM |
| `{{dueDate}}` | Computed `due_date_fmt` |
| `{{overdueDays}}` | Computed `overdue_days` |

---

## Cash Term Special Handling
Cash Term invoices have `credit_days = 0`, so `due_date = invoice.created_at`.
- T-7 branch will never fire for Cash Term (due date is same as invoice date).
- T+0 fires on the **same day** the invoice is created.
- Typical for walk-in or COD clients.

---

## Idempotency / Deduplication
Make.com does not have built-in deduplication for email sends. To prevent duplicate emails on re-runs:
1. Create a `dunning_log` table in Supabase: `(invoice_id, stage, sent_at)`.
2. Add a Module 3b **HTTP GET** to check if `(invoice_id, stage)` already exists.
3. Add a **Filter** before the Resend module to skip if already logged.
4. After send, **HTTP POST** to insert into `dunning_log`.

## Error Handling
- Set **Resume** on email failures (client email may be invalid).
- Route HTTP errors to **Slack #finance-alerts**.
- Log all sends to `dunning_log` for audit trail.

## Environment Variables
| Variable | Value |
|---|---|
| `SUPABASE_SERVICE_KEY` | Supabase Service Role key |
| `PROJECT_REF` | Supabase project reference |
| `RESEND_API_KEY` | Resend API key |
