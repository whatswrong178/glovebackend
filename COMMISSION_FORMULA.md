# MediGlove ERP — Commission & Reward Formula (v10)

> Version 10.0 · Effective 2026-04-27 · Based on MediGlove Supply v10 Ultimate Spec
> For internal reference only — All rates read from Settings, zero hardcoded values.

---

## Financial Bottom Line (财务底线)

```
Revenue (总营收)
- Cost of Goods Sold (销售成本 COGS)
= Gross Profit (毛利润 GP)
- Expenses (佣金支出: Base + KAM + Bounty + Step + Leader + Mentor + Tug-of-War)
= Net Profit (净利润) → 必须 > 0
```

All commission components are subsets of Expenses. The commission engine exists to ensure **Net Profit stays positive**.

---

## 10-Step Commission Pipeline Overview

```
Step 0  → Revenue Isolation (营收隔离)
Step 1  → Per-item GP with Discount Allocation & GP Floor (毛利计算)
Step 2  → Base Commission (基础提成)
Step 3  → KAM Old Client Allowance (老客津贴)
Step 4  → New Client Bounty — 4-Tier (新客悬赏)
Step 5  → Step Bonus / Ladder with A-Ratio Guard (阶梯奖金)
Step 6  → Leader Override with Death Line (领袖分红)
Step 7  → Mentor Reward (裂变伯乐奖)
Step 8  → Tug-of-War Split (拔河分润)
Step 9  → Final Payout Aggregation (最终佣金汇总)
```

---

## § 0 · Revenue Isolation (营收隔离)

```
Net Revenue = Invoice Total − Delivery Charge

Revenue_A = Σ (Selling Price × Qty) for all Category A line items
Revenue_B = Σ (Selling Price × Qty) for all Category B line items

Total_Net_Revenue = Revenue_A + Revenue_B
```

| Rule | Detail |
|------|--------|
| Delivery Charge | Excluded from revenue, excluded from commission calculation |
| Free delivery | West Malaysia + ≥ 5 boxes → delivery charge = RM 0 |
| Category A | Medical consumables (gloves, masks, etc.) |
| Category B | Other products |

---

## § 1 · Per-item Gross Profit & GP Floor (毛利计算)

### 1a. Raw GP per line item

```
Per Item Raw GP = (Selling Price − Cost Price) × Qty
```

### 1b. Discount allocation (折扣按营收比例分摊)

```
Discount_A = Total Discount × (Revenue_A / (Revenue_A + Revenue_B))
Discount_B = Total Discount × (Revenue_B / (Revenue_A + Revenue_B))
```

### 1c. Category GP with floor (分类毛利汇总)

```
GP_A = Math.max(0, Σ(A-item Raw GPs) − Discount_A)
GP_B = Math.max(0, Σ(B-item Raw GPs) − Discount_B)
```

> **GP Floor = 0 (熔断机制):** GP can never be negative. This is the critical safety valve protecting Net Profit > 0.

### Worked Example

```
Invoice Items:
  A类: Selling RM 10 × 200 = RM 2,000 / Cost RM 6 × 200 = RM 1,200 → Raw GP = RM 800
  B类: Selling RM 8 × 100  = RM 800   / Cost RM 5 × 100 = RM 500   → Raw GP = RM 300

Total Discount = RM 100
Revenue_A = RM 2,000, Revenue_B = RM 800
Discount_A = 100 × (2,000 / 2,800) = RM 71.43
Discount_B = 100 × (800 / 2,800)   = RM 28.57

GP_A = max(0, 800 − 71.43) = RM 728.57
GP_B = max(0, 300 − 28.57) = RM 271.43
```

---

## § 2 · Base Commission (基础提成)

```
Base_Comm = (GP_A × BASE_A_RATE) + (GP_B × BASE_B_RATE)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| BASE_A_RATE | 20% | Category A base commission rate |
| BASE_B_RATE | 15% | Category B base commission rate |

> Only invoices with `status = Paid` count toward **Actual Commission (实发佣金)**. Active invoices contribute to **Estimated Commission (预估佣金)** only.

### Worked Example

```
GP_A = RM 5,000, GP_B = RM 2,000
Base_Comm = (5,000 × 0.20) + (2,000 × 0.15)
         = 1,000 + 300
         = RM 1,300
```

---

## § 3 · KAM Old Client Allowance (老客津贴)

Triggered by **customer tenure** (days since first paid invoice), NOT by monthly revenue tiers.

```
IF (CurrentDate − Customer.FirstOrderDate) ≥ KAM_PERIOD:
    KAM_Comm = (GP_A × KAM_A_RATE) + (GP_B × KAM_B_RATE)
ELSE:
    KAM_Comm = 0
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| KAM_PERIOD | 180 days | Minimum tenure to qualify as Key Account |
| KAM_A_RATE | +5% | Additional rate on GP_A for qualified accounts |
| KAM_B_RATE | +3% | Additional rate on GP_B for qualified accounts |

> KAM is an **additive** bonus on top of Base Commission (not multiplicative). It rewards long-term client relationships.

### Worked Example

```
Customer first order: 2025-06-01
Current date: 2026-01-15
Tenure: 228 days ≥ 180 days → KAM triggered

GP_A = RM 5,000, GP_B = RM 2,000
KAM_Comm = (5,000 × 0.05) + (2,000 × 0.03)
         = 250 + 60
         = RM 310
```

---

## § 4 · New Client Bounty — 4-Tier (新客悬赏)

> Controlled by `BOUNTY_ENABLED` toggle in Settings. Each tier claimed **once per client**.

| Tier | Condition | Reward | Window |
|------|-----------|--------|--------|
| Tier 1 — 首单破冰 | First order ≥ **3 cartons** | RM 50 | On first order |
| Tier 2 — 90天锁定 | Cumulative orders ≥ **RM 1,000** | RM 50 | Within 90 days of first order |
| Tier 3 — 180天深耕 | Cumulative orders ≥ **RM 2,000** | RM 100 | Within 180 days of first order |
| Tier 4 — 365天铁粉 | Cumulative orders ≥ **RM 6,000** | RM 200 | Within 365 days of first order |

```
Maximum Bounty per new client = RM 50 + 50 + 100 + 200 = RM 400
```

### Anti-Fraud Rules

- **SSM Dedup:** Client SSM number must be unique system-wide. Prevents same clinic registering under different names.
- **License Dedup:** Client license number also checked for duplicates.
- Each tier tracked by `tierXClaimed` boolean flags — once claimed, cannot be re-triggered.

### Worked Example

```
New client first order: 5 cartons (≥ 3)   → Tier 1 = RM 50
Day 60: cumulative RM 1,400 (≥ RM 1,000)  → Tier 2 = RM 50
Day 150: cumulative RM 2,200 (≥ RM 2,000) → Tier 3 = RM 100
Day 300: cumulative RM 6,200 (≥ RM 6,000) → Tier 4 = RM 200

Total Bounty = 50 + 50 + 100 + 200 = RM 400 (max reached)
```

---

## § 5 · Step Bonus / Ladder with A-Ratio Guard (阶梯奖金)

### 5a. A-Ratio Health Check

```
A_Ratio = Revenue_A / Total_Net_Revenue

IF A_Ratio ≥ 70%:
    Use full ladder (正常阶梯)
ELSE:
    Downgrade one tier (降一级)
```

> A-Ratio ensures sales staff do not neglect Category A (medical consumables) in favour of Category B. The threshold is **70%**, not 20%.

### 5b. Ladder Matrix (configurable in Settings)

| Tier | Monthly Personal Revenue Threshold | Reward |
|------|-----------------------------------|--------|
| Starter (起步) | RM 0 | RM 0 |
| Bronze (铜牌) | RM 10,000 | RM 0 (honor only) |
| Silver (银牌) | RM 20,000 | RM 400 |
| Gold (金牌) | RM 50,000 | RM 1,000 |
| Platinum (白金) | RM 120,000 | RM 2,500 |
| Diamond (钻石) | RM 200,000 | RM 4,000 |

### 5c. Calculation Logic

```
Step_Bonus = Reward of highest matched tier

IF A_Ratio < 70% (health check fails):
    Step_Bonus = Reward of (matched tier − 1)
    e.g. qualified for Gold → downgraded to Silver reward
```

### Worked Example

```
Example 1 — Health check PASS:
  Personal Revenue: RM 55,000 → qualifies for Gold
  A_Ratio = 75% ≥ 70% → pass
  Step_Bonus = RM 1,000 (Gold)

Example 2 — Health check FAIL:
  Personal Revenue: RM 55,000 → qualifies for Gold
  A_Ratio = 60% < 70% → fail → downgrade one tier
  Step_Bonus = RM 400 (Silver)
```

### Progress Bar Formula (Dashboard display)

```
Progress % = (Personal_Revenue − Current_Tier.threshold)
           / (Next_Tier.threshold − Current_Tier.threshold)
           × 100

If already at Diamond (max): Progress = 100%, no next target shown.
```

---

## § 6 · Leader Override (领袖分红)

Applicable to staff with role = **Leader** only.

### 6a. Override Calculation

```
Effective_Threshold = IF Leader.hasExemption THEN 35,000 ELSE 50,000

IF Leader_Personal_Net_Revenue ≥ Effective_Threshold:
    Leader_Bonus = Team_Total_Net_Revenue × LEADER_RATE
ELSE:
    Leader_Bonus = 0
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| LEADER_THRESHOLD | RM 50,000 | Standard monthly personal revenue threshold |
| LEADER_THRESHOLD_EXEMPTION | RM 35,000 | Reduced threshold (Admin-granted per Leader) |
| LEADER_RATE | 1% | Override rate on team Net Revenue |

> `Team_Total_Net_Revenue` = sum of all direct subordinate Sales' Net Revenue. Leader's **own** revenue is excluded from the team total.

### 6b. Death Line (生死底线)

```
Monthly settlement check:

IF Leader_Personal_Net_Revenue < Effective_Threshold:
    consecutiveFailMonths += 1
ELSE:
    consecutiveFailMonths = 0

IF consecutiveFailMonths ≥ DEATH_LINE_MONTHS (default: 2):
    Leader.leaderFrozen = true
    Leader_Bonus = 0        ← Override frozen
    Mentor_Reward = 0       ← Mentor also frozen

Unfreeze: Admin manual operation only, after Leader achieves threshold in a month.
```

### Worked Example

```
Leader personal revenue: RM 55,000 ≥ RM 50,000 → qualified
Team members:
  Sales 1: RM 25,000
  Sales 2: RM 18,000
  Sales 3: RM 32,000
  Team_Total = RM 75,000

Leader_Bonus = 75,000 × 0.01 = RM 750

--- Death Line Example ---
Jan 2026: revenue RM 28,000 < RM 50,000 → consecutiveFailMonths = 1
Feb 2026: revenue RM 30,000 < RM 50,000 → consecutiveFailMonths = 2 → FROZEN
Mar 2026: leaderFrozen = true → Leader_Bonus = 0, Mentor_Reward = 0
```

---

## § 7 · Mentor Reward (裂变伯乐奖)

Triggered when a Leader successfully incubates a Sales rep into a new Leader (spin-off).

```
Conditions:
  1. Mentor (original Leader) is Active AND leaderFrozen = false
  2. Mentee (promoted Sales → new Leader) has active team

Mentor_Reward = Mentee_Team_Total_Net_Revenue × MENTOR_RATE
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| MENTOR_RATE | 0.5% | Permanent rate on mentee's team Net Revenue |
| Duration | **Permanent** | As long as Mentor remains Active and not frozen |
| Spin-off threshold | RM 50,000 | Sales cumulative revenue required for Leader promotion |

> Mentor Reward is **stackable**: if a Leader incubates multiple new Leaders, each one generates a separate Mentor Reward stream.
>
> `Mentee_Team_Total_Net_Revenue` = sum of all Sales under the Mentee Leader. The Mentee Leader's own personal revenue is excluded.

### Worked Example

```
Leader A incubated Leader B:
  Leader B's team:
    Sales X: RM 20,000
    Sales Y: RM 15,000
    Team_Total = RM 35,000
  Mentor_Reward(B) = 35,000 × 0.005 = RM 175

Leader A also incubated Leader C:
  Leader C's team Net Revenue = RM 40,000
  Mentor_Reward(C) = 40,000 × 0.005 = RM 200

Total Mentor_Reward for Leader A = 175 + 200 = RM 375
```

---

## § 8 · Tug-of-War Split (拔河分润 / Neglect Index)

A dynamic ownership dispute mechanism. When a client's Owner (A) neglects service and another Sales (B) invoices on their behalf, the Neglect Index shifts commission from A to B until ownership transfers.

### 8a. Neglect Index State Machine

```
Initial: Client.neglectIndex = 0

INCREMENT (+1):
  When Invoice.createdBy (B) ≠ Client.createdBy (A):
    neglectIndex = MIN(neglectIndex + 1, 6)

DECREMENT (−1) — Service Debt Redemption (服务债赎回):
  When Invoice.createdBy (A) = Client.createdBy (A) AND neglectIndex > 0:
    neglectIndex = MAX(neglectIndex − 1, 0)

FORCE TRANSFER (主权易主):
  When neglectIndex reaches 6:
    Client.createdBy = B (transfer ownership to invoicer)
    neglectIndex = 0 (reset)
    Current invoice commission: 100% to B
```

### 8b. Revenue Split Ratio Table

| Neglect Index | Owner (A) Share | Invoicer (B) Share | Status |
|:---:|:---:|:---:|---|
| 0 | 100% | 0% | Owner has full control |
| 1 | 50% | 50% | First neglect — even split |
| 2 | 40% | 60% | Owner losing ground |
| 3 | 30% | 70% | Invoicer dominant |
| 4 | 20% | 80% | Owner severely marginalized |
| 5 | 10% | 90% | Owner nearly lost |
| 6 | 0% | 100% | **Force transfer** — ownership changes to B |

### 8c. Split Application

```
Owner_Comm  = Total_Comm × Owner_Share_Ratio
Invoicer_Comm = Total_Comm × Invoicer_Share_Ratio
```

### 8d. Service Debt Redemption (服务债赎回)

When Owner personally invoices while `neglectIndex > 0`:
1. `neglectIndex -= 1`
2. Since invoicer IS the owner, 100% commission goes to Owner
3. Owner must serve **consecutively** to bring index back to 0
4. e.g. Index 3 → requires 3 consecutive personal invoices to fully redeem

### Worked Example

```
Scenario 1 — First neglect:
  Owner = A, Invoicer = B, Index: 0 → 1
  Base_Comm = RM 1,000
  A gets: 1,000 × 50% = RM 500
  B gets: 1,000 × 50% = RM 500

Scenario 2 — Third neglect:
  Index: 2 → 3
  Base_Comm = RM 1,000
  A gets: 1,000 × 30% = RM 300
  B gets: 1,000 × 70% = RM 700

Scenario 3 — Owner redeems (服务债赎回):
  Index: 3 → 2 (Owner invoices personally)
  Base_Comm = RM 1,000
  A gets: 1,000 × 100% = RM 1,000 (Owner IS the invoicer)

Scenario 4 — Force transfer:
  Index: 5 → 6 → TRANSFER
  Client.createdBy changes from A to B
  B gets 100% of current invoice commission
  Index resets to 0, B is now the new Owner
```

---

## § 9 · Final Monthly Payout (最终月度佣金)

```
Total_Payout = Base_Comm           ← § 2
             + KAM_Comm            ← § 3
             + Bounty              ← § 4
             + Step_Bonus          ← § 5
             + Leader_Bonus        ← § 6 (Leaders only)
             + Mentor_Reward       ← § 7 (Leaders with spin-offs only)
             + TugOfWar_Adjustment ← § 8 (when applicable)
```

> **Settlement rule (见款发佣):** Only invoices with `status = Paid` within the calendar month are included in Actual Commission payout. Active invoices only count toward Estimated Commission (preview).

### Full Worked Example

```
Sales rep — monthly data:
  GP_A = RM 8,000, GP_B = RM 3,000
  Personal Net Revenue = RM 55,000
  A_Ratio = 72% (passes 70% health check)
  Has 1 KAM client (tenure > 180 days)
  Has 1 new client (Tier 1 + Tier 2 unlocked)
  No Tug-of-War adjustment

Step 0: Net Revenue = RM 55,000
Step 1: GP_A = RM 8,000, GP_B = RM 3,000
Step 2: Base_Comm   = (8,000 × 0.20) + (3,000 × 0.15)  = RM 2,050
Step 3: KAM_Comm    = (8,000 × 0.05) + (3,000 × 0.03)  = RM 490
Step 4: Bounty      = 50 + 50                            = RM 100
Step 5: Step_Bonus  = RM 1,000 (Gold, A_Ratio passes)
Step 6: Leader      = RM 0 (role = Sales, not Leader)
Step 7: Mentor      = RM 0 (no spin-off)
Step 8: Tug-of-War  = RM 0 (no split event)

Total_Payout = 2,050 + 490 + 100 + 1,000 + 0 + 0 + 0
             = RM 3,640
```

---

## § 10 · Company P&L Impact (公司损益表)

```
Gross Revenue     = Σ (Paid Invoice Total − Delivery Charge)
Total COGS        = Σ (Cost Price × Qty) for all items in Paid Invoices
Gross Profit      = Gross Revenue − Total COGS
Total Expenses    = Σ (all employee Total_Payouts)
Net Profit        = Gross Profit − Total Expenses → must be > 0
```

### Dual Commission Display (Dashboard)

| Display | Source | Purpose |
|---------|--------|---------|
| Est. Comm (预估佣金) | Active + Paid invoices | Shows potential earnings |
| Actual Comm (实发佣金) | **Paid invoices only** | Confirmed payout amount |

---

## § 11 · 50/50 Joint Order Rule (中台代开单)

When HR & Finance (middle office) creates an invoice on behalf of a Sales rep:

```
Commission split: 50/50 between HR & Finance staff and the Sales rep
Revenue credit:   50/50 split
New client bounty: 100% to original client developer (Client.createdBy)
```

---

## § 12 · Orphan Client Mechanism (公海孤儿机制)

```
Trigger: Employee status → Inactive
Effect:  All their clients → is_orphan = true → enter Public Pool

First-Blood Claim:
  Any Active employee creates invoice for orphan client →
    Client.createdBy = invoice creator
    Client.is_orphan = false
    Client.neglectIndex = 0
    Commission: 100% to new owner
```

---

## Appendix A · All Configurable Parameters

| Parameter | Default | Location | Description |
|-----------|---------|----------|-------------|
| BASE_A_RATE | 20% | Settings | Cat A base commission rate |
| BASE_B_RATE | 15% | Settings | Cat B base commission rate |
| KAM_A_RATE | 5% | Settings | Cat A old-client allowance rate |
| KAM_B_RATE | 3% | Settings | Cat B old-client allowance rate |
| KAM_PERIOD | 180 days | Settings | Old-client tenure threshold |
| BOUNTY_ENABLED | true | Settings | Master toggle for bounty system |
| BOUNTY_TIER_1 | RM 50 / ≥ 3 cartons | Settings | First-order reward |
| BOUNTY_TIER_2 | RM 50 / RM 1,000 / 90 days | Settings | 90-day lock reward |
| BOUNTY_TIER_3 | RM 100 / RM 2,000 / 180 days | Settings | 180-day reward |
| BOUNTY_TIER_4 | RM 200 / RM 6,000 / 365 days | Settings | 365-day loyalty reward |
| LADDER_MATRIX | 6 tiers (see § 5b) | Settings | Step bonus tiers and rewards |
| A_RATIO_THRESHOLD | 70% | Settings | Health check for step bonus |
| LEADER_THRESHOLD | RM 50,000 | Settings | Leader personal revenue threshold |
| LEADER_THRESHOLD_EXEMPTION | RM 35,000 | Settings | Reduced threshold (Admin-granted) |
| LEADER_RATE | 1% | Settings | Override rate on team Net Revenue |
| DEATH_LINE_MONTHS | 2 | Settings | Consecutive fail months to freeze |
| MENTOR_RATE | 0.5% | Settings | Mentor reward rate (permanent) |
| SPINOFF_THRESHOLD | RM 50,000 | Settings | Cumulative revenue for Leader promotion |
| MIN_BOXES | 3 | Settings | Minimum boxes per invoice |
| FREE_DELIVERY_BOXES | 5 | Settings | Threshold for free delivery (West MY) |

---

*Based on MediGlove Supply v10 Ultimate Specification · Last updated: 2026-04-27*
