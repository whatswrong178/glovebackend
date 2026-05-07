// ══════════════════════════════════════════════════════════════════════════════
// src/pages/purchaseOrders/list.tsx — Purchase Orders List
// MediGlove ERP · Admin + HR only
//
// POs are auto-created by create_invoice_atomic RPC (one PO per supplier per
// invoice). Status: Draft → Approved → Sent
//
// Columns: PO No · Supplier · Invoice Ref · Status · Items · Total Cost · Date · Actions
// Delete: Admin only, Draft / Approved POs (Sent = locked)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useList, useUpdate, useDelete, useGetIdentity, useNavigation } from "@refinedev/core";
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
  const isAdmin = identity?.role === "Admin";

  const { mutate: updatePO } = useUpdate();
  const { mutate: deletePO } = useDelete();

  const [statusFilter,   setStatusFilter]   = useState<string>("All");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [deletingId,     setDeletingId]     = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const handleDeleteClick = (poId: string) => {
    setConfirmDeleteId(poId);
  };

  const handleDeleteConfirm = () => {
    if (!confirmDeleteId) return;
    setDeletingId(confirmDeleteId);
    setConfirmDeleteId(null);
    deletePO(
      { resource: "purchase_orders", id: confirmDeleteId },
      {
        onSuccess: () => { setDeletingId(null); refetch(); },
        onError:   (err) => {
          setDeletingId(null);
          alert((err as unknown as Error).message ?? "Delete failed. Please try again.");
        },
      }
    );
  };

  const confirmPO = allPOs.find(p => p.id === confirmDeleteId);

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });

  if (isLoading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading purchase orders…</div>;
  }

  return (
    <div className="space-y-5">

      {/* Confirm delete dialog */}
      {confirmDeleteId && confirmPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🗑️</span>
              <div>
                <h2 className="text-base font-bold text-gray-900">Delete Purchase Order</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Permanently delete <span className="font-mono font-semibold text-gray-800">{confirmPO.po_no}</span>?
                  All line items will be removed. <span className="text-red-600 font-medium">Cannot be undone.</span>
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Delete PO
              </button>
            </div>
          </div>
        </div>
      )}

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
              {filtered.map(po => {
                const canDelete = isAdmin && (po.status === "Draft" || po.status === "Approved");
                const isBeingDeleted = deletingId === po.id;
                return (
                  <tr key={po.id} className={`hover:bg-gray-50 transition-colors ${isBeingDeleted ? "opacity-40" : ""}`}>
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
                        {canDelete && (
                          <button
                            onClick={() => handleDeleteClick(po.id)}
                            disabled={isBeingDeleted}
                            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1 transition-colors disabled:opacity-40"
                            title="Delete PO (Admin only)"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
