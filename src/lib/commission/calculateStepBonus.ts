/**
 * calculateStepBonus — Pure Step Bonus Engine (EPIC-06 / T-06.4)
 *
 * Ladder matrix (from system_params LADDER_MATRIX):
 *   Starter  : revenue >= 0      → RM 0
 *   Bronze   : revenue >= 10,000 → RM 0
 *   Silver   : revenue >= 20,000 → RM 400
 *   Gold     : revenue >= 50,000 → RM 1,000
 *   Platinum : revenue >= 120,000→ RM 2,500
 *   Diamond  : revenue >= 200,000→ RM 4,000
 *
 * A-Ratio Health Check:
 *   A_Ratio = Revenue_A / Total_Net_Revenue
 *   >= a_ratio_threshold (default 70%) → use full ladder
 *   <  a_ratio_threshold              → drop one tier (demote)
 *
 * This function is PURE: no DB calls, no side effects.
 */

export interface StepBonusLadderTier {
  name:       string;    // e.g. "Silver"
  minRevenue: number;    // RM threshold
  bonus:      number;    // RM reward
}

export interface StepBonusParams {
  totalNetRevenue: number;      // total paid invoice revenue this month
  revenueA:        number;      // revenue from Cat-A products
  params?: {
    aRatioThreshold: number;    // default 0.70
    ladder:          StepBonusLadderTier[];
  };
}

export interface StepBonusResult {
  tier:            string;    // achieved tier name
  aRatio:          number;    // Revenue_A / Total_Net_Revenue
  aRatioHealthy:   boolean;   // >= threshold
  bonusBeforeDemote: number;  // bonus at full ladder
  demoted:         boolean;   // true if A-Ratio caused demotion
  finalBonus:      number;    // after demotion if applicable
}

const DEFAULT_LADDER: StepBonusLadderTier[] = [
  { name: "Starter",  minRevenue: 0,       bonus: 0     },
  { name: "Bronze",   minRevenue: 10000,   bonus: 0     },
  { name: "Silver",   minRevenue: 20000,   bonus: 400   },
  { name: "Gold",     minRevenue: 50000,   bonus: 1000  },
  { name: "Platinum", minRevenue: 120000,  bonus: 2500  },
  { name: "Diamond",  minRevenue: 200000,  bonus: 4000  },
];

const DEFAULT_A_RATIO_THRESHOLD = 0.70;

export function calculateStepBonus(params: StepBonusParams): StepBonusResult {
  const { totalNetRevenue, revenueA } = params;

  const ladder    = params.params?.ladder ?? DEFAULT_LADDER;
  const threshold = params.params?.aRatioThreshold ?? DEFAULT_A_RATIO_THRESHOLD;

  // Sort ladder descending by minRevenue for binary search
  const sorted = [...ladder].sort((a, b) => b.minRevenue - a.minRevenue);

  // Find achieved tier
  const achievedIdx = sorted.findIndex((t) => totalNetRevenue >= t.minRevenue);
  const achieved = achievedIdx === -1 ? sorted[sorted.length - 1] : sorted[achievedIdx];

  // A-Ratio health check
  // BUG-07: revenueA > totalNetRevenue → rawRatio > 1.0 → aRatioHealthy always true
  //         → demotion guard permanently disabled. Clamp to [0, 1] to fix.
  const rawRatio      = totalNetRevenue > 0 ? revenueA / totalNetRevenue : 0;
  const aRatio        = Math.min(1, Math.max(0, rawRatio));
  const aRatioHealthy = aRatio >= threshold;

  // Demotion: drop one tier if unhealthy
  let demoted = false;
  let finalTier = achieved;
  if (!aRatioHealthy && achievedIdx !== -1) {
    // Next tier down (one index higher in descending array)
    const demotedIdx = achievedIdx + 1;
    if (demotedIdx < sorted.length) {
      finalTier = sorted[demotedIdx];
      demoted = true;
    } else {
      // Already at bottom
      finalTier = sorted[sorted.length - 1];
    }
  }

  return {
    tier:              achieved.name,
    aRatio,
    aRatioHealthy,
    bonusBeforeDemote: achieved.bonus,
    demoted,
    finalBonus:        finalTier.bonus,
  };
}
