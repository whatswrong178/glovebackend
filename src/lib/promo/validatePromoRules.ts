/**
 * validatePromoRules — Pure Promo Engine
 * Skill 3 (TDD): mirrors the SQL promo logic in create_invoice_atomic().
 *
 * Rules:
 *   1. West Malaysia + qty >= FREE_SHIPPING_BOXES (default 5) → delivery = 0
 *   (Minimum order requirement removed — no floor enforced)
 */

export type Region = "West Malaysia" | "East Malaysia";

export interface PromoInput {
  totalQty:        number;
  region:          Region;
  deliveryCharge:  number;
  /** Override system_params defaults for testability */
  params?: {
    freeShippingBoxes: number; // default 5
  };
}

export interface PromoResult {
  valid:            boolean;
  error?:           string;          // populated when valid=false
  finalDelivery:    number;          // 0 when free-shipping rule triggers
  freeShippingApplied: boolean;
}

const DEFAULT_PARAMS = {
  freeShippingBoxes: 5,
} as const;

export function validatePromoRules(input: PromoInput): PromoResult {
  const { totalQty, region, deliveryCharge, params = DEFAULT_PARAMS } = input;
  const p = { ...DEFAULT_PARAMS, ...params };

  // Rule 1: West Malaysia free shipping
  const freeShipping =
    region === "West Malaysia" && totalQty >= p.freeShippingBoxes;

  return {
    valid:               true,
    finalDelivery:       freeShipping ? 0 : deliveryCharge,
    freeShippingApplied: freeShipping,
  };
}
