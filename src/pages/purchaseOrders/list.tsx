// ══════════════════════════════════════════════════════════════════════════════
// src/pages/purchaseOrders/list.tsx — Purchase Orders List
// MediGlove ERP · Admin + HR only
//
// POs are auto-created by create_invoice_atomic RPC (one PO per supplier per
// invoice). Status: Draft → Approved → Sent
//
// Columns: PO No · Supplier · Invoice Ref · Status · Items · Total Cost · Date · Actions
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useList, useUpdate, useGetIdentity, useNavigation } from "@refinedev/core";
import type { StaffRole } from "../../types/staff";

interface PurchaseOrder {
  id:          string;
  po_no:       string;
  status:      "Draft" | "Approved" | "Sent";
  created_at:  string;
  invoice_id:  string | null;
  supplier_id: string;
  supplier:    { name: string } | null;
  invoice:     { invoice_no: string } | null;
  // aggregated via RPC — not available via simple select, we'll fetch items separately
}

const STATUS_COLOR: Record<string, string> = {
  Draft:    "bg-gray-100 text-gray-700",
  Approved: "bg-blue-100 text-blue-700",
  Sent:     "bg-emerald-100 text-emerald-700",
};

const STATUS_NEXT: Record<string, "Approved" | "Sent"> = {
  Draft:    "Approved",
  Approved: "Sent",
};

export function POListPage() {
  const { push } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; role: StaffRole }>();
  const { mutate: updatePO } = useUpdate();

  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [supplierFilter, setSupplierFilter] = useState("");

  const { data, isLoading, refetch } = useList<PurchaseOrder>({
    resource:   "purchase_orders",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "created_at", order: "desc" }],
    meta: {
      select: "id,po_no,status,created_at,invoice_id,supplier_id,supplier:suppliers!supplier_id(name),invoice:invoices!invoice_id(invoice_no)",
    },
  });

  const allPOs = data?.data ?? [];

  // ── Client-side filter ─────────────────────────────────────────────────────
  const filtered = allPOs.filter(po => {
    if (statusFilter !== "All" && po.status !== statusFilter) return false;
    if (supplierFilter && !po.supplier?.name.toLowerCase().includes(supplierFilter.toLowerCase())) return false;
    return true;
  });

  const advanceStatus = (po: PurchaseOrder) => {
    const next = STATUS_NEXT[po.status];
    if (!next) return;
    updatePO(
      { resource: "purchase_orders", id: po.id, values: { status: next } },
      { onSuccess: () => refetch() }
    );
  };

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

  if (isLoading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading purchase orders…</div>;
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Auto-generated from invoices · one PO per supplier per invoice</p>
        </div>
        <span className="text-sm text-gray-500">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {["All", "Draft", "Approved", "Sent"].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors
                ${statusFilter === s
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={supplierFilter}
          onChange={e => setSupplierFilter(e.target.value)}
          placeholder="Filter by supplier…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            {allPOs.length === 0
              ? "No purchase orders yet. They are created automatically when an invoice is raised."
              : "No results match your filters."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["PO No.", "Supplier", "Invoice Ref", "Status", "Date", "Actions"].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(po => (
                <tr key={po.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => push(`/purchase-orders/${po.id}`)}
                      className="font-mono text-blue-600 hover:text-blue-800 font-medium text-xs"
                    >
                      {po.po_no}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-800">{po.supplier?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {po.invoice?.invoice_no ? (
                      <span className="font-mono text-xs text-gray-600">{po.invoice.invoice_no}</span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[po.status]}`}>
                      {po.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmt(po.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => push(`/purchase-orders/${po.id}`)}
                        className="text-xs text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-300 rounded px-2 py-1 transition-colors"
                      >
                        View / Print
                      </button>
                      {po.status !== "Sent" && (
                        <button
                          onClick={() => advanceStatus(po)}
                          className="text-xs text-white bg-blue-600 hover:bg-blue-700 rounded px-2 py-1 transition-colors"
                        >
                          → {STATUS_NEXT[po.status]}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
