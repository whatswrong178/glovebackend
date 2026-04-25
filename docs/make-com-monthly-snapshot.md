# Make.com — 月末不可篡改财务快照自动化 (T-08.1)

## 触发器
- **类型**: Scheduled (Cron)
- **时间**: 每月 1 日 00:01 KL 时间 (UTC+8) → UTC = `01 16 * * *` (即前一天 16:01 UTC)
- **场景名称**: `MediGlove_Monthly_Payout_Snapshot`

---

## Scenario 流程

### Module 1 — Compute Last Month (Tools > Set Variables)
```
last_month_year  = {{formatDate(addMonths(now; -1); "YYYY")}}
last_month_month = {{formatDate(addMonths(now; -1); "M")}}
```

### Module 2 — Get All Active Staff (HTTP > Make a Request)
- **URL**: `https://<PROJECT_REF>.supabase.co/rest/v1/staff`
- **Method**: GET
- **Headers**:
  - `apikey`: `{{SUPABASE_SERVICE_KEY}}`
  - `Authorization`: `Bearer {{SUPABASE_SERVICE_KEY}}`
  - `Accept`: `application/json`
- **Query String**: `select=id,full_name,role&offboarded=eq.false`

### Module 3 — Iterator (Flow Control > Iterator)
- **Array**: `{{2.data}}` (staff array from Module 2)

### Module 4 — Evaluate Leader Month (HTTP > Make a Request)
- **URL**: `https://<PROJECT_REF>.supabase.co/rest/v1/rpc/fn_evaluate_leader_month`
- **Method**: POST
- **Headers**:
  - `apikey`: `{{SUPABASE_SERVICE_KEY}}`
  - `Authorization`: `Bearer {{SUPABASE_SERVICE_KEY}}`
  - `Content-Type`: `application/json`
- **Body** (raw JSON):
```json
{
  "p_staff_id": "{{3.id}}",
  "p_year": "{{1.last_month_year}}",
  "p_month": "{{1.last_month_month}}"
}
```
> ⚠️ This writes back `consecutive_fail_months` and `leader_frozen` to the staff row.

### Module 5 — Calculate Monthly Payout (HTTP > Make a Request)
- **URL**: `https://<PROJECT_REF>.supabase.co/rest/v1/rpc/fn_calculate_monthly_payout`
- **Method**: POST
- **Headers**: (same as Module 4)
- **Body**:
```json
{
  "p_staff_id": "{{3.id}}",
  "p_year": "{{1.last_month_year}}",
  "p_month": "{{1.last_month_month}}"
}
```

### Module 6 — Insert Snapshot (HTTP > Make a Request)
- **URL**: `https://<PROJECT_REF>.supabase.co/rest/v1/snapshots`
- **Method**: POST
- **Headers**:
  - `apikey`: `{{SUPABASE_SERVICE_KEY}}`
  - `Authorization`: `Bearer {{SUPABASE_SERVICE_KEY}}`
  - `Content-Type`: `application/json`
  - `Prefer`: `return=minimal`
- **Body**:
```json
{
  "staff_id":   "{{3.id}}",
  "year":       "{{1.last_month_year}}",
  "month":      "{{1.last_month_month}}",
  "payload":    {{5.data}},
  "created_by": "make.com"
}
```
> ℹ️ The `snapshots_staff_month_uniq` index prevents duplicate runs from double-inserting. Use `Prefer: resolution=ignore-duplicates` if needed.

### Module 7 — Send Finance Summary Email (Resend > Send an Email)
- **From**: `finance@mediglove.com`
- **To**: `admin@mediglove.com`
- **Subject**: `[MediGlove] Monthly Payout Snapshot — {{1.last_month_year}}/{{1.last_month_month}}`
- **Body** (HTML): Summary table of all staff payouts from Module 5 aggregated results.

---

## Error Handling
- Set **Break** on Module 4 and 5 with **Rollback** if staff_id is invalid.
- Set **Ignore** on Module 6 if unique constraint error (duplicate snapshot).
- Route all errors to a **Slack #finance-alerts** or email.

## Environment Variables (stored in Make.com > Connections)
| Variable | Value |
|---|---|
| `SUPABASE_SERVICE_KEY` | Service Role key from Supabase Dashboard > API |
| `PROJECT_REF` | Your Supabase project reference ID |

---

## Immutability Guarantee
Snapshots are write-once. The database enforces this via:
```sql
CREATE RULE snapshots_no_update AS ON UPDATE TO snapshots DO INSTEAD NOTHING;
CREATE RULE snapshots_no_delete AS ON DELETE TO snapshots DO INSTEAD NOTHING;
```
Even if Make.com re-runs, existing snapshot rows cannot be overwritten.
