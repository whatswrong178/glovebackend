/**
 * calculateBaseCommission — Pure Financial Function
 * Skill 3 (TDD): No DB calls. No side effects. Fully testable.
 *
 * Formula (mirrors commission engine in 003_functions_triggers.sql):
 *   GP        = max(0, (sellingPrice - costPrice) * qty - proRatedDiscount)
 *   base_comm = GP * rate  (A=20%, B=15%)
 *   kam_comm  = GP * kamBonus  (if cooperationDays >= 180)
 *
 * All monetary values are in MYR, computed with NUMERIC precision.
 * Caller is responsible for rounding to 2 decimal places before persistence.
 */

export type ProductCategory = "A" | "B";

export interface CommissionParams {
  sellingPrice:     number;   // per unit
  costPrice:        number;   // per unit (secret, DB-sourced)
  qty:              number;   // boxes
  discount:         number;   // total invoice-level discount, pro-rated per item
  category:         ProductCategory;
  cooperationDays:  number;   // days since first_order_date
  /** Overridable rates from system_params (defaults match DB seeds) */
  rates?: {
    commissionA:  number;  // default 0.20
    commissionB:  number;  // default 0.15
    kamBonusA:    number;  // default 0.05
    kamBonusB:    number;  // default 0.03
    kamThreshold: number;  // default 180 days
  };
}

export interface CommissionResult {
  grossProfit:    number;   // raw GP before commission (RM)
  baseCommission: number;   // GP × base rate
  kamBonus:       number;   // GP × KAM bonus rate (0 if not eligible)
  totalCommission: number;  // baseCommission + kamBonus
}

const DEFAULT_RATES = {
  commissionA:  0.20,
  commissionB:  0.15,
  kamBonusA:    0.05,
  kamBonusB:    0.03,
  kamThreshold: 180,
} as const;

// ── IEEE-754 drift elimination ────────────────────────────────────────────────
// Round to 6 decimal places before returning. Eliminates accumulated floating-
// point drift (e.g. (10.1-6.3)*10 = 38.00000000000001). Callers round to 2dp
// before DB persistence — that contract is unchanged.
const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

export function calculateBaseCommission(params: CommissionParams): CommissionResult {
  const {
    sellingPrice,
    costPrice,
    qty,
    discount,
    category,
    cooperationDays,
    rates = DEFAULT_RATES,
  } = params;

  // ── INPUT GUARD ───────────────────────────────────────────────────────────
  // BUG-01: NaN/Infinity inputs propagate silently through all arithmetic,
  //         producing NaN/Infinity results that corrupt Supabase NUMERIC fields.
  // BUG-02: Negative qty silently produces GP=0 (Math.max fuse), masking returns.
  // BUG-05: Invalid category silently falls back to B-rate with no audit trail.
  if (
    !Number.isFinite(sellingPrice) || !Number.isFinite(costPrice) ||
    !Number.isFinite(qty)          || !Number.isFinite(discount)  ||
    !Number.isFinite(cooperationDays)
  ) {
    throw new RangeError(
      `calculateBaseCommission: all numeric inputs must be finite. ` +
      `Received qty=${qty}, sellingPrice=${sellingPrice}, costPrice=${costPrice}.`
    );
  }
  if (qty < 0) {
    throw new RangeError(
      `calculateBaseCommission: qty cannot be negative (${qty}). ` +
      `Use a credit note flow for returns.`
    );
  }
  if (category !== "A" && category !== "B") {
    throw new RangeError(
      `calculateBaseCommission: invalid category "${category}". Must be "A" or "B".`
    );
  }

  const r = { ...DEFAULT_RATES, ...rates };

  // ── GP Fuse (核心熔断逻辑) ───────────────────────────────────────────────
  // GP can never be negative. Discount is pro-rated per item by caller.
  const rawGP       = (sellingPrice - costPrice) * qty;
  const grossProfit = Math.max(0, rawGP - discount);

  // ── Base commission rate ──────────────────────────────────────────────────
  const baseRate       = category === "A" ? r.commissionA : r.commissionB;
  const baseCommission = grossProfit * baseRate;

  // ── KAM loyalty bonus ─────────────────────────────────────────────────────
  const isKAM   = cooperationDays >= r.kamThreshold;
  const kamRate = isKAM
    ? (category === "A" ? r.kamBonusA : r.kamBonusB)
    : 0;
  const kamBonus = grossProfit * kamRate;

  // ── BUG-04: Apply round6 to eliminate IEEE-754 drift ─────────────────────
  return {
    grossProfit:     round6(grossProfit),
    baseCommission:  round6(baseCommission),
    kamBonus:        round6(kamBonus),
    totalCommission: round6(baseCommission + kamBonus),
  };
}
