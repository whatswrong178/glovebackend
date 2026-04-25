/**
 * Commission Engine Unit Tests — T-01.5 / EPIC-06
 * Skill 3 (TDD): 100% branch coverage required.
 * CI will fail if any assertion breaks or coverage drops below 100%.
 *
 * Test domains:
 *   A. calculateBaseCommission — GP fuse, base rates, KAM bonus
 *   B. validatePromoRules      — 3-box minimum, West Malaysia free shipping
 *   C. tugOfWarSplit           — full neglect index 0→6 state machine
 */

import { describe, it, expect } from "vitest";
import {
  calculateBaseCommission,
  type CommissionParams,
} from "../lib/commission/calculateBaseCommission";
import {
  validatePromoRules,
  type PromoInput,
} from "../lib/promo/validatePromoRules";
import {
  tugOfWarSplit,
  type TugOfWarInput,
} from "../lib/neglect/tugOfWarSplit";
import {
  calculateBounty,
  type BountyParams,
} from "../lib/commission/calculateBounty";
import {
  calculateStepBonus,
  type StepBonusParams,
} from "../lib/commission/calculateStepBonus";
import {
  calculateLeaderBonus,
  type LeaderBonusParams,
} from "../lib/commission/calculateLeaderBonus";
import {
  calculateMentorReward,
  type MentorRewardParams,
} from "../lib/commission/calculateMentorReward";

// A. calculateBaseCommission
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateBaseCommission", () => {
  const base: CommissionParams = {
    sellingPrice:    10,
    costPrice:       6,
    qty:             10,
    discount:        0,
    category:        "A",
    cooperationDays: 0,
  };

  it("A1 — normal A-class sale, no discount, new client", () => {
    // GP = (10-6)*10 = 40, base = 40*0.20 = 8, KAM = 0
    const r = calculateBaseCommission(base);
    expect(r.grossProfit).toBe(8 * 5);        // 40
    expect(r.baseCommission).toBeCloseTo(8);
    expect(r.kamBonus).toBe(0);
    expect(r.totalCommission).toBeCloseTo(8);
  });

  it("A2 — B-class product (15% rate)", () => {
    // GP = 40, base = 40*0.15 = 6
    const r = calculateBaseCommission({ ...base, category: "B" });
    expect(r.baseCommission).toBeCloseTo(6);
    expect(r.totalCommission).toBeCloseTo(6);
  });

  it("A3 — GP熔断: selling below cost → GP clamped to 0", () => {
    // Selling at a loss: GP = max(0, (5-6)*10) = 0
    const r = calculateBaseCommission({ ...base, sellingPrice: 5 });
    expect(r.grossProfit).toBe(0);
    expect(r.baseCommission).toBe(0);
    expect(r.totalCommission).toBe(0);
  });

  it("A4 — GP熔断: zero GP exactly (selling == cost)", () => {
    const r = calculateBaseCommission({ ...base, sellingPrice: 6 });
    expect(r.grossProfit).toBe(0);
    expect(r.totalCommission).toBe(0);
  });

  it("A5 — discount wipes out GP → clamp to 0", () => {
    // GP before discount = 40, discount = 50 → clamp to 0
    const r = calculateBaseCommission({ ...base, discount: 50 });
    expect(r.grossProfit).toBe(0);
    expect(r.totalCommission).toBe(0);
  });

  it("A6 — discount partially reduces GP", () => {
    // GP = 40 - 10 = 30, base = 30*0.20 = 6
    const r = calculateBaseCommission({ ...base, discount: 10 });
    expect(r.grossProfit).toBeCloseTo(30);
    expect(r.baseCommission).toBeCloseTo(6);
  });

  it("A7 — KAM bonus triggered at exactly 180 days (A-class: +5%)", () => {
    // GP = 40, base = 40*0.20 = 8, KAM = 40*0.05 = 2
    const r = calculateBaseCommission({ ...base, cooperationDays: 180 });
    expect(r.kamBonus).toBeCloseTo(2);
    expect(r.totalCommission).toBeCloseTo(10);
  });

  it("A8 — KAM bonus triggered at exactly 180 days (B-class: +3%)", () => {
    // GP = 40, base = 40*0.15 = 6, KAM = 40*0.03 = 1.2
    const r = calculateBaseCommission({
      ...base,
      category:        "B",
      cooperationDays: 180,
    });
    expect(r.kamBonus).toBeCloseTo(1.2);
    expect(r.totalCommission).toBeCloseTo(7.2);
  });

  it("A9 — KAM NOT triggered at 179 days", () => {
    const r = calculateBaseCommission({ ...base, cooperationDays: 179 });
    expect(r.kamBonus).toBe(0);
  });

  it("A10 — KAM NOT triggered when GP=0 (fused)", () => {
    const r = calculateBaseCommission({
      ...base,
      sellingPrice:    5,
      cooperationDays: 365,
    });
    expect(r.kamBonus).toBe(0);
    expect(r.totalCommission).toBe(0);
  });

  it("A11 — custom rate overrides respected", () => {
    // Admin changes commission_rate_a to 0.25
    const r = calculateBaseCommission({
      ...base,
      rates: {
        commissionA:  0.25,
        commissionB:  0.15,
        kamBonusA:    0.05,
        kamBonusB:    0.03,
        kamThreshold: 180,
      },
    });
    // GP = 40, base = 40*0.25 = 10
    expect(r.baseCommission).toBeCloseTo(10);
  });

  it("A12 — high qty, large invoice", () => {
    // RM 50 selling, RM 30 cost, 200 boxes = GP 4000, commission 800
    const r = calculateBaseCommission({
      sellingPrice:    50,
      costPrice:       30,
      qty:             200,
      discount:        0,
      category:        "A",
      cooperationDays: 0,
    });
    expect(r.grossProfit).toBe(4000);
    expect(r.baseCommission).toBeCloseTo(800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. validatePromoRules
// ─────────────────────────────────────────────────────────────────────────────
describe("validatePromoRules", () => {
  const base: PromoInput = {
    totalQty:       5,
    region:         "West Malaysia",
    deliveryCharge: 30,
  };

  it("B1 — exactly 3 boxes: valid, no free shipping", () => {
    const r = validatePromoRules({ ...base, totalQty: 3, region: "East Malaysia" });
    expect(r.valid).toBe(true);
    expect(r.finalDelivery).toBe(30);
    expect(r.freeShippingApplied).toBe(false);
  });

  it("B2 — 2 boxes: blocked", () => {
    const r = validatePromoRules({ ...base, totalQty: 2 });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Minimum order is 3");
    expect(r.finalDelivery).toBe(30);  // unchanged
  });

  it("B3 — 0 boxes: blocked", () => {
    const r = validatePromoRules({ ...base, totalQty: 0 });
    expect(r.valid).toBe(false);
  });

  it("B4 — West Malaysia, exactly 5 boxes: free shipping", () => {
    const r = validatePromoRules({ ...base, totalQty: 5 });
    expect(r.valid).toBe(true);
    expect(r.finalDelivery).toBe(0);
    expect(r.freeShippingApplied).toBe(true);
  });

  it("B5 — West Malaysia, 4 boxes: NOT free (delivery charged)", () => {
    const r = validatePromoRules({ ...base, totalQty: 4 });
    expect(r.valid).toBe(true);
    expect(r.finalDelivery).toBe(30);
    expect(r.freeShippingApplied).toBe(false);
  });

  it("B6 — East Malaysia, 10 boxes: valid but delivery NOT waived", () => {
    const r = validatePromoRules({ ...base, totalQty: 10, region: "East Malaysia" });
    expect(r.valid).toBe(true);
    expect(r.freeShippingApplied).toBe(false);
    expect(r.finalDelivery).toBe(30);
  });

  it("B7 — zero delivery charge + free shipping: stays 0", () => {
    const r = validatePromoRules({ ...base, totalQty: 5, deliveryCharge: 0 });
    expect(r.finalDelivery).toBe(0);
  });

  it("B8 — custom params: minOrder=5, freeShipping=10", () => {
    const r = validatePromoRules({
      totalQty:       4,
      region:         "West Malaysia",
      deliveryCharge: 50,
      params: { minOrderBoxes: 5, freeShippingBoxes: 10 },
    });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Minimum order is 5");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. tugOfWarSplit — full neglect index state machine
// ─────────────────────────────────────────────────────────────────────────────
describe("tugOfWarSplit", () => {
  const base: TugOfWarInput = {
    currentNeglectIndex: 0,
    callerIsOwner:       true,
    ownerId:             "owner-uuid",
    assistantId:         "asst-uuid",
  };

  // ── Owner scenarios ─────────────────────────────────────────────────────────

  it("C1 — index=0, owner sells: no split, full commission", () => {
    const r = tugOfWarSplit(base);
    expect(r.ownerRatio).toBe(100);
    expect(r.assistantRatio).toBe(0);
    expect(r.newNeglectIndex).toBe(0);
    expect(r.ownershipTransferred).toBe(false);
    expect(r.noSplitRequired).toBe(true);
  });

  it("C2 — index=1, owner redeems (service debt): 50/50 split, index→0", () => {
    const r = tugOfWarSplit({ ...base, currentNeglectIndex: 1 });
    expect(r.ownerRatio).toBe(50);
    expect(r.assistantRatio).toBe(50);
    expect(r.newNeglectIndex).toBe(0);
    expect(r.noSplitRequired).toBe(false);
  });

  it("C3 — index=3, owner redeems: 30/70 split (disadvantaged), index→2", () => {
    const r = tugOfWarSplit({ ...base, currentNeglectIndex: 3 });
    expect(r.ownerRatio).toBe(30);
    expect(r.assistantRatio).toBe(70);
    expect(r.newNeglectIndex).toBe(2);
  });

  it("C4 — index=5, owner redeems: 10/90 split, index→4", () => {
    const r = tugOfWarSplit({ ...base, currentNeglectIndex: 5 });
    expect(r.ownerRatio).toBe(10);
    expect(r.assistantRatio).toBe(90);
    expect(r.newNeglectIndex).toBe(4);
  });

  // ── Non-owner (assistant) scenarios ─────────────────────────────────────────

  it("C5 — index=0, non-owner sells: 50/50 split, index→1", () => {
    const r = tugOfWarSplit({ ...base, callerIsOwner: false });
    expect(r.ownerRatio).toBe(50);
    expect(r.assistantRatio).toBe(50);
    expect(r.newNeglectIndex).toBe(1);
    expect(r.ownershipTransferred).toBe(false);
  });

  it("C6 — index=1, non-owner: 40/60, index→2", () => {
    const r = tugOfWarSplit({ ...base, callerIsOwner: false, currentNeglectIndex: 1 });
    expect(r.ownerRatio).toBe(40);
    expect(r.assistantRatio).toBe(60);
    expect(r.newNeglectIndex).toBe(2);
  });

  it("C7 — index=2, non-owner: 30/70, index→3", () => {
    const r = tugOfWarSplit({ ...base, callerIsOwner: false, currentNeglectIndex: 2 });
    expect(r.ownerRatio).toBe(30);
    expect(r.newNeglectIndex).toBe(3);
  });

  it("C8 — index=3, non-owner: 20/80, index→4", () => {
    const r = tugOfWarSplit({ ...base, callerIsOwner: false, currentNeglectIndex: 3 });
    expect(r.ownerRatio).toBe(20);
    expect(r.newNeglectIndex).toBe(4);
  });

  it("C9 — index=4, non-owner: 10/90, index→5", () => {
    const r = tugOfWarSplit({ ...base, callerIsOwner: false, currentNeglectIndex: 4 });
    expect(r.ownerRatio).toBe(10);
    expect(r.newNeglectIndex).toBe(5);
  });

  it("C10 — index=5, non-owner: 0/100, index→6, ownership transfer triggered", () => {
    const r = tugOfWarSplit({ ...base, callerIsOwner: false, currentNeglectIndex: 5 });
    expect(r.ownerRatio).toBe(0);
    expect(r.assistantRatio).toBe(100);
    expect(r.newNeglectIndex).toBe(6);
    expect(r.ownershipTransferred).toBe(true);
  });

  it("C11 — index already at 6, non-owner: still capped at 6 (idempotent)", () => {
    // index cannot exceed 6
    const r = tugOfWarSplit({ ...base, callerIsOwner: false, currentNeglectIndex: 6 });
    expect(r.newNeglectIndex).toBe(6);
    expect(r.ownerRatio).toBe(0);
    expect(r.ownershipTransferred).toBe(true);
  });

  it("C12 — ratios always sum to 100", () => {
    for (let idx = 0; idx <= 5; idx++) {
      const r = tugOfWarSplit({ ...base, callerIsOwner: false, currentNeglectIndex: idx });
      expect(r.ownerRatio + r.assistantRatio).toBe(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. calculateBounty — 4-Tier New Client Bounty Engine (v10)
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateBounty (v10 4-tier)", () => {
  const freshClient: BountyParams["client"] = {
    isNewClient:       true,
    firstOrderBoxes:   5,
    daysSinceFirst:    0,
    cumulativePaidGMV: 0,
    tier1Claimed:      false,
    tier2Claimed:      false,
    tier3Claimed:      false,
    tier4Claimed:      false,
  };

  // ── Gate tests ──────────────────────────────────────────────────────────────

  it("D1 — non-new client: all tiers blocked", () => {
    const r = calculateBounty({ client: { ...freshClient, isNewClient: false } });
    expect(r.totalBounty).toBe(0);
    expect(r.tier1Unlocked).toBe(false);
  });

  it("D2 — bountyEnabled=false: all tiers blocked", () => {
    const r = calculateBounty({
      client: freshClient,
      config: { bountyEnabled: false } as any,
    });
    expect(r.totalBounty).toBe(0);
  });

  // ── Tier 1 (v10): boxes >= 3 → RM 50 ──────────────────────────────────────

  it("D3 — Tier 1: exactly 3 boxes → RM 50 unlocked", () => {
    const r = calculateBounty({
      client: { ...freshClient, firstOrderBoxes: 3 },
    });
    expect(r.tier1Unlocked).toBe(true);
    expect(r.tier1Amount).toBe(50);
  });

  it("D4 — Tier 1: 2 boxes → NOT unlocked (v10 threshold is 3 boxes)", () => {
    const r = calculateBounty({
      client: { ...freshClient, firstOrderBoxes: 2 },
    });
    expect(r.tier1Unlocked).toBe(false);
    expect(r.tier1Amount).toBe(0);
  });

  it("D5 — Tier 1: already claimed → skipped", () => {
    const r = calculateBounty({
      client: { ...freshClient, firstOrderBoxes: 10, tier1Claimed: true },
    });
    expect(r.tier1Unlocked).toBe(false);
    expect(r.tier1Amount).toBe(0);
  });

  // ── Tier 2: 90d window, cumulative >= RM 1,000 → RM 50 ───────────────────

  it("D6 — Tier 2: day 89, RM 1,200 cumulative → unlocked", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 89, cumulativePaidGMV: 1200 },
    });
    expect(r.tier2Unlocked).toBe(true);
    expect(r.tier2Amount).toBe(50);
  });

  it("D7 — Tier 2: day 91 → window expired, not unlocked", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 91, cumulativePaidGMV: 1500 },
    });
    expect(r.tier2Unlocked).toBe(false);
  });

  it("D8 — Tier 2: RM 999 cumulative → not unlocked", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 60, cumulativePaidGMV: 999 },
    });
    expect(r.tier2Unlocked).toBe(false);
  });

  it("D9 — Tier 2: exactly RM 1,000 on day 90 → unlocked (boundary)", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 90, cumulativePaidGMV: 1000 },
    });
    expect(r.tier2Unlocked).toBe(true);
  });

  // ── Tier 3: 180d, cumulative >= RM 2,000 → RM 100 ────────────────────────

  it("D10 — Tier 3: day 150, RM 2,200 → unlocked", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 150, cumulativePaidGMV: 2200 },
    });
    expect(r.tier3Unlocked).toBe(true);
    expect(r.tier3Amount).toBe(100);
  });

  it("D11 — Tier 3: day 181 → expired", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 181, cumulativePaidGMV: 5000 },
    });
    expect(r.tier3Unlocked).toBe(false);
  });

  // ── Tier 4 (NEW v10): 365d, cumulative >= RM 6,000 → RM 200 ──────────────

  it("D12 — Tier 4: day 300, RM 6,000 cumulative → unlocked (RM 200)", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 300, cumulativePaidGMV: 6000 },
    });
    expect(r.tier4Unlocked).toBe(true);
    expect(r.tier4Amount).toBe(200);
  });

  it("D13 — Tier 4: RM 5,999 → not unlocked (1 below threshold)", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 200, cumulativePaidGMV: 5999 },
    });
    expect(r.tier4Unlocked).toBe(false);
  });

  it("D14 — Tier 4: day 366 → window expired", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 366, cumulativePaidGMV: 10000 },
    });
    expect(r.tier4Unlocked).toBe(false);
  });

  it("D15 — Tier 4: already claimed → skipped", () => {
    const r = calculateBounty({
      client: { ...freshClient, daysSinceFirst: 200, cumulativePaidGMV: 8000, tier4Claimed: true },
    });
    expect(r.tier4Unlocked).toBe(false);
  });

  // ── Full stack: all 4 tiers unlock simultaneously ──────────────────────────

  it("D16 — all 4 tiers unlock: total = RM 400 (capped at max)", () => {
    const r = calculateBounty({
      client: {
        isNewClient:       true,
        firstOrderBoxes:   5,       // ≥ 3 → Tier 1
        daysSinceFirst:    89,      // within 90d + 180d + 365d
        cumulativePaidGMV: 6500,   // ≥ 1k + ≥ 2k + ≥ 6k
        tier1Claimed: false,
        tier2Claimed: false,
        tier3Claimed: false,
        tier4Claimed: false,
      },
    });
    expect(r.tier1Unlocked).toBe(true);
    expect(r.tier2Unlocked).toBe(true);
    expect(r.tier3Unlocked).toBe(true);
    expect(r.tier4Unlocked).toBe(true);
    expect(r.totalBounty).toBe(400);  // 50+50+100+200
  });

  it("D17 — partial: Tier 1 + Tier 2 only = RM 100", () => {
    const r = calculateBounty({
      client: {
        ...freshClient,
        firstOrderBoxes:   4,
        daysSinceFirst:    60,
        cumulativePaidGMV: 1200,  // ≥ RM 1k (T2) but < RM 2k (T3)
      },
    });
    expect(r.tier1Unlocked).toBe(true);
    expect(r.tier2Unlocked).toBe(true);
    expect(r.tier3Unlocked).toBe(false);
    expect(r.tier4Unlocked).toBe(false);
    expect(r.totalBounty).toBe(100);
  });

  it("D18 — maxBounty cap: custom config maxBounty=100 caps even if all unlock", () => {
    const r = calculateBounty({
      client: {
        isNewClient: true, firstOrderBoxes: 5, daysSinceFirst: 89,
        cumulativePaidGMV: 6500, tier1Claimed: false, tier2Claimed: false,
        tier3Claimed: false, tier4Claimed: false,
      },
      config: { ...({} as any), maxBounty: 100 },
    });
    expect(r.totalBounty).toBe(100);  // capped
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. calculateStepBonus — Ladder + A-Ratio demotion
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateStepBonus", () => {

  // ── Ladder tier resolution ─────────────────────────────────────────────────

  it("E01 — Starter: RM 0 revenue → tier=Starter, bonus=RM 0", () => {
    const r = calculateStepBonus({ totalNetRevenue: 0, revenueA: 0 });
    expect(r.tier).toBe("Starter");
    expect(r.finalBonus).toBe(0);
    expect(r.demoted).toBe(false);
  });

  it("E02 — Bronze: RM 10,000 exactly → tier=Bronze, bonus=RM 0", () => {
    const r = calculateStepBonus({ totalNetRevenue: 10000, revenueA: 10000 });
    expect(r.tier).toBe("Bronze");
    expect(r.finalBonus).toBe(0);
  });

  it("E03 — Silver: RM 20,000 exactly, healthy A-Ratio → bonus=RM 400", () => {
    const r = calculateStepBonus({ totalNetRevenue: 20000, revenueA: 15000 });
    expect(r.tier).toBe("Silver");
    expect(r.aRatioHealthy).toBe(true);
    expect(r.finalBonus).toBe(400);
    expect(r.demoted).toBe(false);
  });

  it("E04 — Gold: RM 50,000 exactly, healthy → bonus=RM 1,000", () => {
    const r = calculateStepBonus({ totalNetRevenue: 50000, revenueA: 40000 });
    expect(r.tier).toBe("Gold");
    expect(r.finalBonus).toBe(1000);
  });

  it("E05 — Platinum: RM 120,000, healthy → bonus=RM 2,500", () => {
    const r = calculateStepBonus({ totalNetRevenue: 120000, revenueA: 90000 });
    expect(r.tier).toBe("Platinum");
    expect(r.finalBonus).toBe(2500);
  });

  it("E06 — Diamond: RM 200,000, healthy → bonus=RM 4,000", () => {
    const r = calculateStepBonus({ totalNetRevenue: 200000, revenueA: 160000 });
    expect(r.tier).toBe("Diamond");
    expect(r.finalBonus).toBe(4000);
  });

  it("E07 — RM 19,999 → just below Silver → tier=Bronze, bonus=RM 0", () => {
    const r = calculateStepBonus({ totalNetRevenue: 19999, revenueA: 15000 });
    expect(r.tier).toBe("Bronze");
    expect(r.finalBonus).toBe(0);
  });

  it("E08 — RM 200,001 → above Diamond → tier=Diamond, bonus=RM 4,000", () => {
    const r = calculateStepBonus({ totalNetRevenue: 200001, revenueA: 160001 });
    expect(r.tier).toBe("Diamond");
    expect(r.finalBonus).toBe(4000);
  });

  // ── A-Ratio health check ───────────────────────────────────────────────────

  it("E09 — A-Ratio exactly 70% → healthy, no demotion", () => {
    const r = calculateStepBonus({ totalNetRevenue: 50000, revenueA: 35000 });
    expect(r.aRatio).toBeCloseTo(0.70, 5);
    expect(r.aRatioHealthy).toBe(true);
    expect(r.demoted).toBe(false);
    expect(r.finalBonus).toBe(1000);
  });

  it("E10 — A-Ratio 69.9% → unhealthy, Gold demoted to Silver → bonus=RM 400", () => {
    const r = calculateStepBonus({ totalNetRevenue: 50000, revenueA: 34950 });
    expect(r.aRatioHealthy).toBe(false);
    expect(r.tier).toBe("Gold");
    expect(r.bonusBeforeDemote).toBe(1000);
    expect(r.demoted).toBe(true);
    expect(r.finalBonus).toBe(400);   // demoted to Silver
  });

  it("E11 — A-Ratio 0%, Silver demoted to Bronze → bonus=RM 0", () => {
    const r = calculateStepBonus({ totalNetRevenue: 20000, revenueA: 0 });
    expect(r.aRatioHealthy).toBe(false);
    expect(r.tier).toBe("Silver");
    expect(r.bonusBeforeDemote).toBe(400);
    expect(r.demoted).toBe(true);
    expect(r.finalBonus).toBe(0);   // demoted to Bronze
  });

  it("E12 — A-Ratio unhealthy but already at Starter → no demotion possible, bonus=RM 0", () => {
    const r = calculateStepBonus({ totalNetRevenue: 5000, revenueA: 0 });
    expect(r.aRatioHealthy).toBe(false);
    expect(r.tier).toBe("Starter");
    expect(r.demoted).toBe(false);
    expect(r.finalBonus).toBe(0);
  });

  it("E13 — totalNetRevenue=0, revenueA=0 → aRatio=0, no division by zero", () => {
    const r = calculateStepBonus({ totalNetRevenue: 0, revenueA: 0 });
    expect(r.aRatio).toBe(0);
    expect(r.aRatioHealthy).toBe(false);
    expect(r.finalBonus).toBe(0);
  });

  it("E14 — Diamond unhealthy → demoted to Platinum → bonus=RM 2,500", () => {
    const r = calculateStepBonus({ totalNetRevenue: 200000, revenueA: 100000 });
    expect(r.tier).toBe("Diamond");
    expect(r.aRatioHealthy).toBe(false);
    expect(r.demoted).toBe(true);
    expect(r.finalBonus).toBe(2500);
  });

  it("E15 — custom ladder and custom aRatioThreshold are respected", () => {
    const r = calculateStepBonus({
      totalNetRevenue: 15000,
      revenueA:        9000,
      params: {
        aRatioThreshold: 0.65,
        ladder: [
          { name: "Low",  minRevenue: 0,     bonus: 0   },
          { name: "Mid",  minRevenue: 10000, bonus: 500 },
          { name: "High", minRevenue: 30000, bonus: 900 },
        ],
      },
    });
    expect(r.tier).toBe("Mid");
    expect(r.aRatio).toBeCloseTo(0.60, 5);
    expect(r.aRatioHealthy).toBe(false);
    expect(r.demoted).toBe(true);
    expect(r.finalBonus).toBe(0);   // demoted from Mid to Low
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. calculateLeaderBonus + calculateMentorReward
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateLeaderBonus", () => {

  const base: LeaderBonusParams = {
    personalNetRevenue:   50000,
    directTeamNetRevenue: 200000,
    leaderExemption:      false,
    consecutiveFailMonths: 0,
    leaderFrozen:         false,
  };

  // ── Threshold met ──────────────────────────────────────────────────────────

  it("F01 — personal revenue exactly RM 50k, standard → threshold met, bonus=RM 2,000", () => {
    const r = calculateLeaderBonus(base);
    expect(r.thresholdMet).toBe(true);
    expect(r.thresholdApplied).toBe(50000);
    expect(r.leaderBonus).toBeCloseTo(2000, 2);
    expect(r.newConsecutiveFails).toBe(0);
    expect(r.shouldFreeze).toBe(false);
  });

  it("F02 — personal revenue RM 60k → threshold met, bonus=RM 2,000", () => {
    const r = calculateLeaderBonus({ ...base, personalNetRevenue: 60000 });
    expect(r.thresholdMet).toBe(true);
    expect(r.leaderBonus).toBeCloseTo(2000, 2);
  });

  it("F03 — exemption leader: threshold=RM 35k, revenue=RM 35k → met, bonus paid", () => {
    const r = calculateLeaderBonus({
      ...base,
      personalNetRevenue: 35000,
      leaderExemption:    true,
    });
    expect(r.thresholdApplied).toBe(35000);
    expect(r.thresholdMet).toBe(true);
    expect(r.leaderBonus).toBeCloseTo(2000, 2);
  });

  it("F04 — threshold met resets consecutiveFailMonths to 0", () => {
    const r = calculateLeaderBonus({ ...base, consecutiveFailMonths: 1 });
    expect(r.newConsecutiveFails).toBe(0);
    expect(r.shouldFreeze).toBe(false);
  });

  // ── Threshold not met ──────────────────────────────────────────────────────

  it("F05 — personal revenue RM 49,999 → not met, bonus=0, fails=1", () => {
    const r = calculateLeaderBonus({ ...base, personalNetRevenue: 49999 });
    expect(r.thresholdMet).toBe(false);
    expect(r.leaderBonus).toBe(0);
    expect(r.newConsecutiveFails).toBe(1);
    expect(r.shouldFreeze).toBe(false);
  });

  it("F06 — 2nd consecutive fail → shouldFreeze=TRUE, bonus=0", () => {
    const r = calculateLeaderBonus({
      ...base,
      personalNetRevenue:    49999,
      consecutiveFailMonths: 1,  // already failed once
    });
    expect(r.newConsecutiveFails).toBe(2);
    expect(r.shouldFreeze).toBe(true);
    expect(r.leaderBonus).toBe(0);
  });

  it("F07 — exemption leader: revenue RM 34,999 → not met, bonus=0", () => {
    const r = calculateLeaderBonus({
      ...base,
      personalNetRevenue: 34999,
      leaderExemption:    true,
    });
    expect(r.thresholdApplied).toBe(35000);
    expect(r.thresholdMet).toBe(false);
    expect(r.leaderBonus).toBe(0);
  });

  // ── Frozen guard ───────────────────────────────────────────────────────────

  it("F08 — leaderFrozen=TRUE → bonus=0 regardless of revenue", () => {
    const r = calculateLeaderBonus({
      ...base,
      personalNetRevenue: 999999,
      leaderFrozen:       true,
    });
    expect(r.leaderBonus).toBe(0);
    expect(r.shouldFreeze).toBe(true);
    expect(r.thresholdMet).toBe(false);
  });

  it("F09 — frozen: consecutiveFailMonths unchanged (no further increment)", () => {
    const r = calculateLeaderBonus({
      ...base,
      leaderFrozen:         true,
      consecutiveFailMonths: 3,
    });
    expect(r.newConsecutiveFails).toBe(3);
  });

  // ── Custom params ──────────────────────────────────────────────────────────

  it("F10 — custom bonusRate 2% → leaderBonus = directTeamRevenue × 0.02", () => {
    const r = calculateLeaderBonus({
      ...base,
      params: { standardThreshold: 50000, exemptionThreshold: 35000, bonusRate: 0.02, freezeAfterFails: 2 },
    });
    expect(r.leaderBonus).toBeCloseTo(4000, 2);
  });
});

describe("calculateMentorReward", () => {

  const activeMentee = {
    menteeId:   "uuid-1",
    menteeName: "Alice",
    netRevenue: 80000,
    isActive:   true,
  };

  const base: MentorRewardParams = {
    mentorFrozen: false,
    mentees:      [activeMentee],
  };

  // ── Normal reward ──────────────────────────────────────────────────────────

  it("F11 — single active mentee RM 80k → reward = RM 400 (0.5%)", () => {
    const r = calculateMentorReward(base);
    expect(r.totalReward).toBeCloseTo(400, 2);
    expect(r.activeMentees).toBe(1);
    expect(r.breakdown[0].included).toBe(true);
    expect(r.breakdown[0].reward).toBeCloseTo(400, 2);
  });

  it("F12 — two active mentees → rewards accumulate", () => {
    const r = calculateMentorReward({
      ...base,
      mentees: [
        { menteeId: "uuid-1", menteeName: "Alice", netRevenue: 80000, isActive: true },
        { menteeId: "uuid-2", menteeName: "Bob",   netRevenue: 40000, isActive: true },
      ],
    });
    expect(r.activeMentees).toBe(2);
    expect(r.totalReward).toBeCloseTo(600, 2);  // (80k + 40k) × 0.5%
  });

  it("F13 — mentee with isActive=false → excluded from reward", () => {
    const r = calculateMentorReward({
      ...base,
      mentees: [
        { ...activeMentee, isActive: false },
      ],
    });
    expect(r.totalReward).toBe(0);
    expect(r.activeMentees).toBe(0);
    expect(r.breakdown[0].included).toBe(false);
  });

  it("F14 — mentee with netRevenue=0 → excluded (no revenue to reward)", () => {
    const r = calculateMentorReward({
      ...base,
      mentees: [{ ...activeMentee, netRevenue: 0 }],
    });
    expect(r.totalReward).toBe(0);
    expect(r.breakdown[0].included).toBe(false);
  });

  it("F15 — mix of active and inactive mentees", () => {
    const r = calculateMentorReward({
      ...base,
      mentees: [
        { menteeId: "uuid-1", menteeName: "Active",   netRevenue: 60000, isActive: true  },
        { menteeId: "uuid-2", menteeName: "Inactive", netRevenue: 50000, isActive: false },
      ],
    });
    expect(r.activeMentees).toBe(1);
    expect(r.totalReward).toBeCloseTo(300, 2);   // only active mentee's 0.5%
  });

  // ── Frozen guard ───────────────────────────────────────────────────────────

  it("F16 — mentorFrozen=TRUE → all rewards zero regardless of mentees", () => {
    const r = calculateMentorReward({ ...base, mentorFrozen: true });
    expect(r.totalReward).toBe(0);
    expect(r.activeMentees).toBe(0);
    expect(r.breakdown[0].included).toBe(false);
  });

  it("F17 — frozen with multiple active mentees → all zeroed", () => {
    const r = calculateMentorReward({
      mentorFrozen: true,
      mentees: [
        { menteeId: "uuid-1", menteeName: "Alice", netRevenue: 80000, isActive: true },
        { menteeId: "uuid-2", menteeName: "Bob",   netRevenue: 40000, isActive: true },
      ],
    });
    expect(r.totalReward).toBe(0);
    r.breakdown.forEach((b) => expect(b.reward).toBe(0));
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("F18 — no mentees → totalReward=0, activeMentees=0", () => {
    const r = calculateMentorReward({ mentorFrozen: false, mentees: [] });
    expect(r.totalReward).toBe(0);
    expect(r.activeMentees).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });

  it("F19 — custom rewardRate 1% → reward doubles", () => {
    const r = calculateMentorReward({
      ...base,
      params: { rewardRate: 0.01 },
    });
    expect(r.totalReward).toBeCloseTo(800, 2);   // 80k × 1%
    expect(r.rewardRate).toBe(0.01);
  });
});

// ── G. Input Guard Tests (BUG-01 through BUG-07 fixes) ───────────────────────

describe("Input Guard — calculateBaseCommission", () => {
  const base = {
    sellingPrice: 10, costPrice: 6, qty: 5,
    discount: 0, category: "A" as const, cooperationDays: 0,
  };

  it("G1 — NaN qty throws RangeError", () => {
    expect(() => calculateBaseCommission({ ...base, qty: NaN }))
      .toThrow(RangeError);
  });

  it("G2 — negative qty throws RangeError", () => {
    expect(() => calculateBaseCommission({ ...base, qty: -1 }))
      .toThrow(RangeError);
  });

  it("G3 — Infinity sellingPrice throws RangeError", () => {
    expect(() => calculateBaseCommission({ ...base, sellingPrice: Infinity }))
      .toThrow(RangeError);
  });

  it("G4 — category='C' throws RangeError", () => {
    expect(() => calculateBaseCommission({ ...base, category: "C" as any }))
      .toThrow(RangeError);
  });

  it("G5 — float precision: (10.1−6.3)×10 → baseCommission is exactly 7.6 (round6)", () => {
    const r = calculateBaseCommission({
      sellingPrice: 10.1, costPrice: 6.3, qty: 10,
      discount: 0, category: "A", cooperationDays: 0,
    });
    // Without round6 this would be 7.6000000000000005
    expect(r.baseCommission).toBe(7.6);
  });
});

describe("Input Guard — tugOfWarSplit", () => {
  const args = { callerIsOwner: true, ownerId: "x", assistantId: "y" };

  it("G6 — index=-1 throws RangeError", () => {
    expect(() => tugOfWarSplit({ ...args, currentNeglectIndex: -1 }))
      .toThrow(RangeError);
  });

  it("G7 — index=7 throws RangeError", () => {
    expect(() => tugOfWarSplit({ ...args, currentNeglectIndex: 7 }))
      .toThrow(RangeError);
  });
});

describe("Input Guard — calculateLeaderBonus", () => {
  const base: LeaderBonusParams = {
    personalNetRevenue: 50000, directTeamNetRevenue: 100000,
    leaderExemption: false, consecutiveFailMonths: 0, leaderFrozen: false,
  };

  it("G8 — Infinity directTeamNetRevenue throws RangeError", () => {
    expect(() => calculateLeaderBonus({ ...base, directTeamNetRevenue: Infinity }))
      .toThrow(RangeError);
  });

  it("G9 — negative personalNetRevenue throws RangeError", () => {
    expect(() => calculateLeaderBonus({ ...base, personalNetRevenue: -1 }))
      .toThrow(RangeError);
  });
});

describe("Input Guard — calculateStepBonus", () => {
  it("G10 — revenueA > totalNetRevenue: aRatio clamped to 1.0, not 1.5", () => {
    const r = calculateStepBonus({ totalNetRevenue: 20000, revenueA: 30000 });
    expect(r.aRatio).toBeLessThanOrEqual(1.0);
    // Clamped → still healthy → no false demotion
    expect(r.aRatioHealthy).toBe(true);
  });
});
