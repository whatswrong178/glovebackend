/**
 * calculateLeaderBonus — Pure Leader Bonus Engine (EPIC-06 / T-06.5)
 *
 * Leader 1% Team Bonus Rules:
 *   - Leader must achieve personal Net Revenue >= LEADER_REVENUE_THRESHOLD (RM 50,000)
 *     OR qualify for the Exemption threshold (RM 35,000) if leader_exemption=TRUE on staff row.
 *   - If threshold met: leaderBonus = directTeamNetRevenue * 0.01
 *   - If threshold NOT met this month: consecutive_fail_months increments.
 *   - consecutive_fail_months >= 2 → leader_frozen = TRUE → leaderBonus = 0 (full stop).
 *   - Admin manually resets leader_frozen + consecutive_fail_months via Settings.
 *
 * This function is PURE: no DB calls, no side effects.
 * fn_evaluate_leader_month (SQL) handles the stateful side-effects (writing back to staff).
 */

export interface LeaderBonusParams {
  /** Leader's own personal Net Revenue for the month (Paid invoices, created_by = leader) */
  personalNetRevenue: number;
  /** Sum of all direct-report Net Revenues for the month */
  directTeamNetRevenue: number;
  /** Whether this leader has the RM 35k exemption (vs standard RM 50k) */
  leaderExemption: boolean;
  /** Current consecutive_fail_months value BEFORE this month's evaluation */
  consecutiveFailMonths: number;
  /** Whether leader_frozen flag is currently TRUE (set by prior evaluation) */
  leaderFrozen: boolean;
  /** Overridable thresholds from system_params */
  params?: {
    standardThreshold:  number;  // default 50000
    exemptionThreshold: number;  // default 35000
    bonusRate:          number;  // default 0.01
    freezeAfterFails:   number;  // default 2
  };
}

export interface LeaderBonusResult {
  /** Effective revenue threshold applied (standard or exemption) */
  thresholdApplied:    number;
  /** Whether personal revenue meets the threshold */
  thresholdMet:        boolean;
  /** Updated consecutive_fail_months after this month */
  newConsecutiveFails: number;
  /** Whether leader should be frozen after this month */
  shouldFreeze:        boolean;
  /** 1% of directTeamNetRevenue, or 0 if frozen/not qualified */
  leaderBonus:         number;
  /** Human-readable explanation for audit trail */
  reason:              string;
}

const DEFAULT_PARAMS = {
  standardThreshold:  50000,
  exemptionThreshold: 35000,
  bonusRate:          0.01,
  freezeAfterFails:   2,
};

export function calculateLeaderBonus(params: LeaderBonusParams): LeaderBonusResult {
  const {
    personalNetRevenue,
    directTeamNetRevenue,
    leaderExemption,
    consecutiveFailMonths,
    leaderFrozen,
  } = params;

  // ── INPUT GUARD ───────────────────────────────────────────────────────────
  // BUG-06: Infinity team revenue → leaderBonus=Infinity → NUMERIC write failure
  //         or silent financial corruption in fn_evaluate_leader_month.
  if (!Number.isFinite(personalNetRevenue) || !Number.isFinite(directTeamNetRevenue)) {
    throw new RangeError(
      `calculateLeaderBonus: revenues must be finite. ` +
      `Got personal=${personalNetRevenue}, team=${directTeamNetRevenue}.`
    );
  }
  if (personalNetRevenue < 0 || directTeamNetRevenue < 0) {
    throw new RangeError(
      `calculateLeaderBonus: revenues cannot be negative. ` +
      `Got personal=${personalNetRevenue}, team=${directTeamNetRevenue}.`
    );
  }

  const p = { ...DEFAULT_PARAMS, ...(params.params ?? {}) };

  const thresholdApplied = leaderExemption
    ? p.exemptionThreshold
    : p.standardThreshold;

  // ── Guard: already frozen ─────────────────────────────────────────────────
  if (leaderFrozen) {
    return {
      thresholdApplied,
      thresholdMet:        false,
      newConsecutiveFails: consecutiveFailMonths,
      shouldFreeze:        true,
      leaderBonus:         0,
      reason:              "leader_frozen=TRUE — bonus suspended until Admin resets.",
    };
  }

  // ── Threshold check ───────────────────────────────────────────────────────
  const thresholdMet = personalNetRevenue >= thresholdApplied;

  let newConsecutiveFails: number;
  let shouldFreeze: boolean;
  let leaderBonus: number;
  let reason: string;

  if (thresholdMet) {
    // Reset fail counter on success
    newConsecutiveFails = 0;
    shouldFreeze        = false;
    leaderBonus         = directTeamNetRevenue * p.bonusRate;
    reason = `Personal revenue RM ${personalNetRevenue.toFixed(2)} >= threshold RM ${thresholdApplied.toFixed(2)}. Bonus = ${(p.bonusRate * 100).toFixed(0)}% × RM ${directTeamNetRevenue.toFixed(2)}.`;
  } else {
    // Increment fail counter
    newConsecutiveFails = consecutiveFailMonths + 1;
    shouldFreeze        = newConsecutiveFails >= p.freezeAfterFails;
    leaderBonus         = 0;
    reason = shouldFreeze
      ? `Personal revenue RM ${personalNetRevenue.toFixed(2)} < threshold RM ${thresholdApplied.toFixed(2)}. consecutive_fail_months=${newConsecutiveFails} >= ${p.freezeAfterFails} → leader_frozen=TRUE.`
      : `Personal revenue RM ${personalNetRevenue.toFixed(2)} < threshold RM ${thresholdApplied.toFixed(2)}. consecutive_fail_months=${newConsecutiveFails}. Bonus = RM 0 this month.`;
  }

  return {
    thresholdApplied,
    thresholdMet,
    newConsecutiveFails,
    shouldFreeze,
    leaderBonus,
    reason,
  };
}
