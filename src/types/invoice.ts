// ══════════════════════════════════════════════════════════════════════════════
// src/types/invoice.ts — MediGlove ERP · Invoice domain types
// EPIC-05
// Mirrors 001_initial_schema.sql + 007_v10_schema_additions.sql exactly.
// ══════════════════════════════════════════════════════════════════════════════

export type InvoiceStatus = "Active" | "Paid" | "Cancelled";

export interface Invoice {
  id:              string;
  invoice_no:      string;
  client_id:       string;
  created_by:      string;
  status:          InvoiceStatus;
  region:          string;
  delivery_charge: number;
  discount:        number;
  total_amount:    number;
  total_boxes:     number;
  is_joint_order:  boolean;
  co_created_by:   string | null;
  neglect_split:   Record<string, unknown> | null;
  paid_at:         string | null;
  created_at:      string;
}

export interface InvoiceItem {
  id:                  string;
  invoice_id:          string;
  product_id:          string;
  qty:                 number;
  selling_price:       number;
  cost_price_snapshot: number;
  created_at:          string;
}

// Line item used in the create form (before submission)
export interface InvoiceLineItem {
  product_id:          string;
  product_name:        string;
  sku:                 string;
  qty:                 number;
  unit:                string;         // e.g. Carton, Box, Pack, Can, Piece
  selling_price:       string;         // string for input control
  min_selling_price:   number;         // current per-unit min (adjusted for selected unit)
  suggested_price:     number;         // current per-unit suggested (adjusted for selected unit)
  _baseSuggestedPrice: number;         // IMMUTABLE: per-Carton suggested price from DB
  _baseMinPrice:       number;         // IMMUTABLE: per-Carton min price from DB
  units_per_carton:    number;         // how many sub-units per Carton
  _error?:             string;
}

// Payload sent to create_invoice_atomic RPC
export interface CreateInvoicePayload {
  p_client_id:       string;
  p_items:           { product_id: string; qty: number; selling_price: number }[];
  p_discount:        number;
  p_delivery_charge: number;
  p_is_joint_order:  boolean;
  p_co_created_by:   string | null;
}

// Response from create_invoice_atomic
export interface CreateInvoiceResult {
  invoice_id:            string;
  invoice_no:            string;
  do_id:                 string;
  do_no:                 string;
  total_amount:          number;
  delivery_charge:       number;
  total_boxes:           number;
  is_joint_order:        boolean;
  neglect_index_applied: number;
  ownership_transferred: boolean;
}
