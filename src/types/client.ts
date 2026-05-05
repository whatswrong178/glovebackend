// ══════════════════════════════════════════════════════════════════════════════
// src/types/client.ts — MediGlove ERP · Client domain types
// EPIC-04
// Mirrors 001_initial_schema.sql clients + edit_requests tables exactly.
// ══════════════════════════════════════════════════════════════════════════════

export type CreditTerms = "Cash Term" | "30 Days" | "60 Days" | "90 Days";
export type ClientRegion = "West Malaysia" | "East Malaysia";
export type EditRequestStatus = "Pending" | "Approved" | "Rejected";

export interface Client {
  id:               string;
  name:             string;
  ssm_no:           string | null;
  region:           ClientRegion;
  owner_id:         string | null;
  created_by:       string;
  is_orphan:        boolean;
  credit_terms:     CreditTerms;
  neglect_index:    number;           // 0–6
  last_assisted_by: string | null;
  first_order_date: string | null;    // ISO date
  contact_person:   string | null;
  contact_email:    string | null;
  contact_phone:    string | null;
  address:          string | null;    // Used on printed invoices and delivery orders
  created_at:       string;
}

export interface EditRequest {
  id:                 string;
  client_id:          string;
  requested_by:       string;
  requested_changes:  Record<string, unknown>;
  status:             EditRequestStatus;
  reviewed_by:        string | null;
  review_note:        string | null;
  created_at:         string;
  reviewed_at:        string | null;
  // joined
  requester?:         { name: string };
  reviewer?:          { name: string } | null;
}

export interface ClientFormValues {
  name:           string;
  ssm_no:         string;
  region:         ClientRegion | "";
  credit_terms:   CreditTerms;
  contact_person: string;
  contact_email:  string;
  contact_phone:  string;
  address:        string;             // Used on printed invoices and delivery orders
  owner_id:       string;             // Admin can reassign; others fixed to self
}

// Split ratio table — mirrors fn_neglect_index_update logic
export const NEGLECT_SPLIT_TABLE: Record<number, { owner: number; invoicer: number }> = {
  0: { owner: 100, invoicer: 0   },
  1: { owner: 80,  invoicer: 20  },
  2: { owner: 60,  invoicer: 40  },
  3: { owner: 50,  invoicer: 50  },
  4: { owner: 40,  invoicer: 60  },
  5: { owner: 20,  invoicer: 80  },
  6: { owner: 0,   invoicer: 100 },
};

export const NEGLECT_COLOR: Record<number, string> = {
  0: "bg-emerald-500",
  1: "bg-emerald-400",
  2: "bg-yellow-400",
  3: "bg-yellow-500",
  4: "bg-orange-400",
  5: "bg-orange-500",
  6: "bg-red-600",
};

export const NEGLECT_LABEL: Record<number, string> = {
  0: "Healthy",
  1: "Watch",
  2: "At Risk",
  3: "At Risk",
  4: "Danger",
  5: "Danger",
  6: "Seized",
};
