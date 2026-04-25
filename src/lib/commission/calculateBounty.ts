/**
 * calculateBounty — Pure Function: 4-Tier New Client Bounty Engine (v10)
 * EPIC-06 / T-06.3
 *
 * v10 changes vs v8.8:
 *   Tier 1: "first order >= RM 500" → "first order total_boxes >= 3" → RM 50
 *   Tier 4: NEW — 365d cumulative Paid >= RM 6,000 → RM 200
 *   Max bounty per new client: RM 400 (50+50+100+200)
 *
 * Rules:
 *   - Only applies to NEW clients (zero prior Paid invoices before this one)
 *   - Each tier is redeemable ONCE per client (tracked by tier{n}_claimed flags)
 *   - All tiers are cumulative and independent
 *   - Calculation windows start from the client's first_order_date
 *   - bountyEnabled gate: if false, all tiers return 0
 *
 * This function is PURE: no DB calls, no side effects, fully testable.
 * Caller is responsible for persisting tier{n}_claimed flags after payment.
 */

export interface BountyClientState {
  /** True when this is the very first Paid invoice for this client */
  isNewClient:      boolean;
  /** Boxes count on the qualifying first order (for Tier 1 check) */
  firstOrderBoxes:  number;
  /** Days since first_order_date at time of evaluation */
  daysSinceFirst:   number;
  /** Cumulative Paid invoice total (RM) for this client, including current invoice */
  cumulativePaidGMV: number;
  /** Per-tier claimed state — prevents double-dipping */
  tier1Claimed: boolean;
  tier2Claimed: boolean;
  tier3Claimed: boolean;
  tier4Claimed: boolean;
}

export interface BountyParams {
  client:  BountyClientState;
  /** Overridable thresholds from system_params (defaults match DB seeds) */
  config?: {
    bountyEnabled:    boolean;  // default true
    tier1MinBoxes:    number;   // default 3
    tier1Reward:      number;   // default 50
    tier2DaysWindow:  number;   // default 90
    tier2MinGMV:      number;   // default 1000
    tier2Reward:      number;   // default 50
    tier3DaysWindow:  number;   // default 180
    tier3MinGMV:      number;   // default 2000
    tier3Reward:      number;   // default 100
    tier4DaysWindow:  number;   // default 365
    tier4MinGMV:      number;   // default 6000
    tier4Reward:      number;   // default 200
    maxBounty:        number;   // default 400
  };
}

export interface BountyResult {
  tier1Unlocked: boolean;
  tier2Unlocked: boolean;
  tier3Unlocked: boolean;
  tier4Unlocked: boolean;
  tier1Amount:   number;
  tier2Amount:   number;
  tier3Amount:   number;
  tier4Amount:   number;
  totalBounty:   number;  // capped at maxBounty
}

const DEFAULT_CONFIG = {
  bountyEnabled:   true,
  tier1MinBoxes:   3,
  tier1Reward:     50,
  tier2DaysWindow: 90,
  tier2MinGMV:     1000,
  tier2Reward:     50,
  tier3DaysWindow: 180,
  tier3MinGMV:     2000,
  tier3Reward:     100,
  tier4DaysWindow: 365,
  tier4MinGMV:     6000,
  tier4Reward:     200,
  maxBounty:       400,
} as const;

export function calculateBounty(params: BountyParams): BountyResult {
  const cfg = { ...DEFAULT_CONFIG, ...(params.config ?? {}) };
  const { client } = params;

  const zero: BountyResult = {
    tier1Unlocked: false, tier2Unlocked: false,
    tier3Unlocked: false, tier4Unlocked: false,
    tier1Amount: 0, tier2Amount: 0, tier3Amount: 0, tier4Amount: 0,
    totalBounty: 0,
  };

  // Gate: bounty system disabled or not a new client
  if (!cfg.bountyEnabled || !client.isNewClient) return zero;

  // ── Tier 1: First order >= N boxes ───────────────────────────────────────
  const tier1Unlocked = !client.tier1Claimed
    && client.firstOrderBoxes >= cfg.tier1MinBoxes;

  // ── Tier 2: Within 90d, cumulative Paid >= RM 1,000 ─────────────────────
  const tier2Unlocked = !client.tier2Claimed
    && client.daysSinceFirst <= cfg.tier2DaysWindow
    && client.cumulativePaidGMV >= cfg.tier2MinGMV;

  // ── Tier 3: Within 180d, cumulative Paid >= RM 2,000 ────────────────────
  const tier3Unlocked = !client.tier3Claimed
    && client.daysSinceFirst <= cfg.tier3DaysWindow
    && client.cumulativePaidGMV >= cfg.tier3MinGMV;

  // ── Tier 4 (NEW v10): Within 365d, cumulative Paid >= RM 6,000 ──────────
  const tier4Unlocked = !client.tier4Claimed
    && client.daysSinceFirst <= cfg.tier4DaysWindow
    && client.cumulativePaidGMV >= cfg.tier4MinGMV;

  const rawTotal =
    (tier1Unlocked ? cfg.tier1Reward : 0) +
    (tier2Unlocked ? cfg.tier2Reward : 0) +
    (tier3Unlocked ? cfg.tier3Reward : 0) +
    (tier4Unlocked ? cfg.tier4Reward : 0);

  const totalBounty = Math.min(rawTotal, cfg.maxBounty);

  return {
    tier1Unlocked,
    tier2Unlocked,
    tier3Unlocked,
    tier4Unlocked,
    tier1Amount: tier1Unlocked ? cfg.tier1Reward : 0,
    tier2Amount: tier2Unlocked ? cfg.tier2Reward : 0,
    tier3Amount: tier3Unlocked ? cfg.tier3Reward : 0,
    tier4Amount: tier4Unlocked ? cfg.tier4Reward : 0,
    totalBounty,
  };
}
