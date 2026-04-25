/**
 * validatePromoRules — Pure Promo Engine
 * Skill 3 (TDD): mirrors the SQL promo logic in create_invoice_atomic().
 *
 * Rules:
 *   1. Total boxes must be >= MIN_ORDER_BOXES (default 3)
 *   2. West Malaysia + qty >= FREE_SHIPPING_BOXES (default 5) → delivery = 0
 */

export type Region = "West Malaysia" | "East Malaysia";

export interface PromoInput {
  totalQty:        number;
  region:          Region;
  deliveryCharge:  number;
  /** Override system_params defaults for testability */
  params?: {
    minOrderBoxes:    number;  // default 3
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
  minOrderBoxes:     3,
  freeShippingBoxes: 5,
} as const;

export function validatePromoRules(input: PromoInput): PromoResult {
  const { totalQty, region, deliveryCharge, params = DEFAULT_PARAMS } = input;
  const p = { ...DEFAULT_PARAMS, ...params };

  // Rule 1: Minimum order quantity
  if (totalQty < p.minOrderBoxes) {
    return {
      valid:               false,
      error:               `Minimum order is ${p.minOrderBoxes} boxes. Current: ${totalQty} box(es).`,
      finalDelivery:       deliveryCharge,
      freeShippingApplied: false,
    };
  }

  // Rule 2: West Malaysia free shipping
  const freeShipping =
    region === "West Malaysia" && totalQty >= p.freeShippingBoxes;

  return {
    valid:               true,
    finalDelivery:       freeShipping ? 0 : deliveryCharge,
    freeShippingApplied: freeShipping,
  };
}
