/**
 * calculateMentorReward — Pure Mentor Reward Engine (EPIC-06 / T-06.6)
 *
 * Mentor (伯乐) Reward Rules:
 *   - When a sales staff member's mentee (recruited_by = mentor) generates paid invoices,
 *     the mentor earns 0.5% of the mentee's Net Revenue.
 *   - This reward is STOPPED if mentor's leader_frozen = TRUE.
 *   - If mentor has multiple mentees, rewards accumulate across all active mentees.
 *   - Mentee must be active (offboarded=FALSE) to generate reward.
 *
 * This function is PURE: no DB calls, no side effects.
 * fn_calculate_monthly_payout (SQL) aggregates this by querying staff.recruited_by.
 */

export interface MenteeRevenue {
  menteeId:       string;   // UUID for audit trail
  menteeName:     string;   // for human-readable breakdown
  netRevenue:     number;   // mentee's paid invoice net revenue this month
  isActive:       boolean;  // offboarded=FALSE check
}

export interface MentorRewardParams {
  /** Whether the mentor's leader_frozen flag is TRUE */
  mentorFrozen: boolean;
  /** Array of all mentees (recruited_by = mentor) */
  mentees: MenteeRevenue[];
  /** Overridable rate from system_params */
  params?: {
    rewardRate: number;   // default 0.005 (0.5%)
  };
}

export interface MenteeRewardBreakdown {
  menteeId:     string;
  menteeName:   string;
  netRevenue:   number;
  reward:       number;   // netRevenue × rewardRate, or 0 if inactive/frozen
  included:     boolean;  // false if mentee inactive or mentor frozen
}

export interface MentorRewardResult {
  mentorFrozen:   boolean;
  rewardRate:     number;
  breakdown:      MenteeRewardBreakdown[];
  totalReward:    number;
  activeMentees:  number;   // count of mentees who contributed
  reason:         string;
}

const DEFAULT_REWARD_RATE = 0.005;  // 0.5%

export function calculateMentorReward(params: MentorRewardParams): MentorRewardResult {
  const { mentorFrozen, mentees } = params;
  const rewardRate = params.params?.rewardRate ?? DEFAULT_REWARD_RATE;

  // ── Guard: mentor frozen — zero out all rewards ───────────────────────────
  if (mentorFrozen) {
    const breakdown: MenteeRewardBreakdown[] = mentees.map((m) => ({
      menteeId:   m.menteeId,
      menteeName: m.menteeName,
      netRevenue: m.netRevenue,
      reward:     0,
      included:   false,
    }));

    return {
      mentorFrozen: true,
      rewardRate,
      breakdown,
      totalReward:   0,
      activeMentees: 0,
      reason:        "leader_frozen=TRUE — mentor reward suspended until Admin resets.",
    };
  }

  // ── Compute per-mentee rewards ─────────────────────────────────────────────
  let totalReward   = 0;
  let activeMentees = 0;

  const breakdown: MenteeRewardBreakdown[] = mentees.map((m) => {
    if (!m.isActive || m.netRevenue <= 0) {
      return {
        menteeId:   m.menteeId,
        menteeName: m.menteeName,
        netRevenue: m.netRevenue,
        reward:     0,
        included:   false,
      };
    }

    const reward = m.netRevenue * rewardRate;
    totalReward  += reward;
    activeMentees++;

    return {
      menteeId:   m.menteeId,
      menteeName: m.menteeName,
      netRevenue: m.netRevenue,
      reward,
      included:   true,
    };
  });

  const reason = activeMentees === 0
    ? "No active mentees with paid revenue this month. Mentor reward = RM 0."
    : `${activeMentees} active mentee(s) contributed. Mentor reward = ${(rewardRate * 100).toFixed(1)}% × team revenue.`;

  return {
    mentorFrozen: false,
    rewardRate,
    breakdown,
    totalReward,
    activeMentees,
    reason,
  };
}
