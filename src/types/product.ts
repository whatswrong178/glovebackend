// ══════════════════════════════════════════════════════════════════════════════
// src/types/product.ts — MediGlove ERP · Product domain types
// EPIC-03 / T-03.2
// Mirrors 001_initial_schema.sql products + suppliers tables.
// ══════════════════════════════════════════════════════════════════════════════

export type ProductCategory = "A" | "B";

export interface Product {
  id:                string;        // UUID PK
  name:              string;
  sku:               string;        // UNIQUE
  supplier_id:       string;        // FK → suppliers.id (NOT NULL after 009)
  category:          ProductCategory;
  cost_price:        number | null; // null for non-Admin (masked by products_safe_view)
  min_selling_price: number;
  suggested_price:   number;
  units_per_carton:  number;         // how many sub-units (Box/Pack/etc.) per Carton
  description:       string | null;
  created_at:        string;
  updated_at:        string;

  // Joined fields (populated by products_safe_view or select=*,supplier:suppliers(id,name))
  supplier_name?: string | null;    // from products_safe_view
  supplier?:      { id: string; name: string } | null; // from direct join
}

// ── Supplier ──────────────────────────────────────────────────────────────────
export interface Supplier {
  id:            string;
  name:          string;
  email:         string | null;
  contact_phone: string | null;
  address:       string | null;
  created_at:    string;
}

// ── Form value shape ──────────────────────────────────────────────────────────
export interface ProductFormValues {
  name:              string;
  sku:               string;
  supplier_id:       string;
  category:          ProductCategory;
  cost_price:        string; // string for <input type="number">
  min_selling_price: string;
  suggested_price:   string;
  units_per_carton:  string; // string for <input type="number">; DB stores INTEGER ≥ 1
  description:       string;
}

// ── Category metadata ─────────────────────────────────────────────────────────
export const CATEGORY_META: Record<ProductCategory, { label: string; desc: string; color: string }> = {
  A: { label: "Cat A", desc: "20% commission", color: "bg-purple-100 text-purple-800" },
  B: { label: "Cat B", desc: "15% commission", color: "bg-blue-100 text-blue-800"   },
};

// ── Price guard helper (client-side pre-validation) ───────────────────────────
export function validatePriceOrder(values: {
  cost_price:        number;
  min_selling_price: number;
  suggested_price:   number;
}): string | null {
  if (values.cost_price < 0)              return "Cost price cannot be negative";
  if (values.min_selling_price < values.cost_price)
    return `Min selling price (${values.min_selling_price}) must be ≥ cost price (${values.cost_price})`;
  if (values.suggested_price < values.min_selling_price)
    return `Suggested price (${values.suggested_price}) must be ≥ min selling price (${values.min_selling_price})`;
  return null;
}

// ── AI import extracted product shape ────────────────────────────────────────
export interface ExtractedProduct {
  name:              string;
  sku:               string;
  cost_price:        number | null;
  min_selling_price: number | null;
  suggested_price:   number | null;
  description:       string;
  confidence:        "high" | "medium" | "low";
  // Added client-side during review:
  selected:          boolean;
  category:          ProductCategory;
  supplier_id:       string;
}
