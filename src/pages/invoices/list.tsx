// ══════════════════════════════════════════════════════════════════════════════
// src/pages/invoices/list.tsx — Invoice Directory
// MediGlove ERP · EPIC-05 / T-05.1
//
// Tabs: Active (status=Active) | Completed (status=Paid | Cancelled)
// Completed invoices are read-only: no edit/delete for Sales/Leader.
// Admin: can delete any invoice.
// Sales/Leader: see own invoices only (created_by = self).
// HR/Admin: see all invoices.
//
// Print: per-row 🖨 button fetches full invoice + items + client → PrintLayout
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { useList, useUpdate, useDelete, useGetIdentity, useNavigation } from "@refinedev/core";
import type { CrudFilters } from "@refinedev/core";
import type { Invoice, InvoiceStatus } from "../../types/invoice";
import type { StaffRole } from "../../types/staff";
import { supabaseClient } from "../../supabaseClient";
import { PrintLayout } from "../../components/PrintLayout";
import type { PrintDocData } from "../../components/PrintLayout";
import { usePrint } from "../../lib/print/usePrint";

type Tab = "active" | "completed";

interface PrintJob {
  doc:  PrintDocData;
  type: "Invoice";
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const styles: Record<InvoiceStatus, string> = {
    Active:    "bg-blue-100 text-blue-800",
    Paid:      "bg-emerald-100 text-emerald-800",
    Cancelled: "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export function InvoiceListPage() {
  const { push } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();

  const isAdmin    = identity?.role === "Admin";
  const isHR       = identity?.role === "HR";
  const canSeeAll  = isAdmin || isHR;
  const canDelete  = isAdmin;
  const canMarkPaid = isAdmin || isHR;

  const [tab,          setTab]          = useState<Tab>("active");
  const [search,       setSearch]       = useState("");
  const [page,         setPage]         = useState(1);
  const [printLoading, setPrintLoading] = useState<string | null>(null); // invoice ID
  const [printJob,     setPrintJob]     = useState<PrintJob | null>(null);
  const PAGE_SIZE = 25;

  const { mutate: deleteInvoice } = useDelete();
  const { mutate: updateInvoice } = useUpdate();

  // ── Print hook ────────────────────────────────────────────────────────────
  const { printRef, triggerPrint, isPrinting } = usePrint({
    onAfterPrint: () => setPrintJob(null),
  });

  // When printJob is set, give React one animation frame to render PrintLayout,
  // then fire window.print()
  useEffect(() => {
    if (!printJob) return;
    const rafId = requestAnimationFrame(() => {
      triggerPrint();
    });
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  // ── Fetch handler (called on print button click) ──────────────────────────
  const handlePrint = async (invoiceId: string, invoiceNo: string) => {
    if (printLoading) return;
    setPrintLoading(invoiceId);

    try {
      // Parallel fetch: invoice header + client details + line items
      const [{ data: inv }, { data: items }] = await Promise.all([
        supabaseClient
          .from("invoices")
          .select(
            "id,invoice_no,status,region,total_amount,delivery_charge,discount,is_joint_order,created_at,paid_at," +
            "client:clients!client_id(name,ssm_no,region,contact_person,contact_email,contact_phone,credit_terms)," +
            "creator:staff!created_by(name)"
          )
          .eq("id", invoiceId)
          .single(),

        supabaseClient
          .from("invoice_items")
          .select("qty,selling_price,unit,product:products!product_id(name,sku)")
          .eq("invoice_id", invoiceId),
      ]);

      if (!inv) {
        alert("Failed to load invoice data for printing.");
        return;
      }

      type RichClient = {
        name: string;
        ssm_no: string | null;
        region: string | null;
        contact_person: string | null;
        contact_email: string | null;
        contact_phone: string | null;
        credit_terms: string | null;
      };

      type ItemRow = {
        qty: number;
        selling_price: number;
        unit: string;
        product: { name: string; sku: string } | null;
      };

      const client  = inv.client as RichClient | null;
      const creator = (inv as { creator?: { name: string } }).creator;
      const lineItems = (items ?? []) as ItemRow[];

      // Calculate subtotal before discount + delivery
      const subtotal = lineItems.reduce(
        (sum, it) => sum + it.qty * it.selling_price,
        0
      );

      const docDate = new Date(inv.created_at).toLocaleDateString("en-MY", {
        day: "2-digit", month: "long", year: "numeric",
      });

      const docData: PrintDocData = {
        docNumber: inv.invoice_no,
        date:      docDate,
        status:    inv.status,
        currency:  "MYR",
        isDraft:   false,

        parties: [
          {
            label:   "Bill To",
            name:    client?.name ?? "—",
            ssm:     client?.ssm_no ?? undefined,
            address: client?.region ?? undefined,
            contact: client?.contact_person ?? undefined,
            email:   client?.contact_email ?? undefined,
          },
          ...(inv.is_joint_order
            ? [{ label: "Type", name: "Joint Order" }]
            : []),
        ],

        items: lineItems.map((it, idx) => ({
          no:          idx + 1,
          description: it.product?.name ?? "Unknown Product",
          sku:         it.product?.sku  ?? undefined,
          qty:         it.qty,
          unitPrice:   it.selling_price,
          amount:      it.qty * it.selling_price,
          // Append unit to description
        })).map((item, idx) => ({
          ...item,
          description: `${item.description} (${lineItems[idx].unit})`,
        })),

        subtotal:        subtotal,
        discount:        inv.discount ?? 0,
        deliveryCharge:  inv.delivery_charge ?? 0,
        total:           inv.total_amount,

        notes: inv.paid_at
          ? `Paid on ${new Date(inv.paid_at).toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" })}`
          : undefined,

        terms: client?.credit_terms ?? undefined,
      };

      setPrintJob({ doc: docData, type: "Invoice" });

    } catch (err) {
      console.error("[InvoiceList] Print fetch failed:", err);
      alert("Failed to load invoice for printing. Please try again.");
    } finally {
      setPrintLoading(null);
      void invoiceNo; // suppress unused warning
    }
  };

  // ── List filters ──────────────────────────────────────────────────────────
  const baseFilters: CrudFilters = [];

  if (tab === "active") {
    baseFilters.push({ field: "status", operator: "eq", value: "Active" });
  } else {
    baseFilters.push({ field: "status", operator: "in", value: ["Paid", "Cancelled"] });
  }

  if (!canSeeAll && identity?.id) {
    baseFilters.push({ field: "created_by", operator: "eq", value: identity.id });
  }

  if (search.trim()) {
    baseFilters.push({ field: "invoice_no", operator: "contains", value: search.trim() });
  }

  const { data, isLoading, refetch } = useList<
    Invoice & {
      client?:  { name: string };
      creator?: { name: string };
    }
  >({
    resource:   "invoices",
    pagination: { current: page, pageSize: PAGE_SIZE },
    sorters:    [{ field: "created_at", order: "desc" }],
    filters:    baseFilters,
    meta: {
      select:
        "id,invoice_no,status,region,total_amount,delivery_charge,discount," +
        "total_boxes,is_joint_order,created_at,paid_at," +
        "client:clients!client_id(name)," +
        "creator:staff!created_by(name)",
    },
  });

  const invoices   = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleMarkPaid = (inv: Invoice) => {
    if (!window.confirm(
      `Mark invoice ${inv.invoice_no} as Paid? This will unlock commissions and cannot be undone.`
    )) return;
    updateInvoice(
      { resource: "invoices", id: inv.id, values: { status: "Paid" } },
      { onSuccess: () => refetch() }
    );
  };

  const handleMarkCancelled = (inv: Invoice) => {
    if (!window.confirm(`Cancel invoice ${inv.invoice_no}? This action cannot be undone.`)) return;
    updateInvoice(
      { resource: "invoices", id: inv.id, values: { status: "Cancelled" } },
      { onSuccess: () => refetch() }
    );
  };

  const handleDelete = (id: string, no: string) => {
    if (!window.confirm(`Permanently delete invoice ${no}?`)) return;
    deleteInvoice({ resource: "invoices", id }, { onSuccess: () => refetch() });
  };

  return (
    <div className="space-y-4">

      {/* ── Hidden print area (off-screen in normal view, visible during print) */}
      {printJob && (
        <div
          aria-hidden="true"
          style={{ position: "fixed", left: "-9999px", top: 0, overflow: "hidden" }}
        >
          <PrintLayout
            ref={printRef}
            doc={printJob.doc}
            type={printJob.type}
            showPricing
          />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} record{total !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => push("/invoices/create")}
          className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg
                     hover:bg-blue-700 transition-colors"
        >
          + New Invoice
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["active", "completed"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "active" ? "Active" : "Completed"}
          </button>
        ))}
      </div>

      {tab === "completed" && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-xs text-gray-600">
          🔒 Completed invoices are read-only. Commission records are locked.
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder="Search by invoice number…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">No invoices found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice No.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Boxes</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount (RM)</th>
                  {canSeeAll && (
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">By</th>
                  )}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map((inv) => {
                  type RichInvoice = Invoice & { client?: { name: string }; creator?: { name: string } };
                  const rich = inv as RichInvoice;
                  const isLoadingThis = printLoading === inv.id;

                  return (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-900 text-xs">{inv.invoice_no}</td>
                      <td className="px-4 py-3 text-gray-700">{rich.client?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <StatusBadge status={inv.status} />
                          {inv.is_joint_order && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                              Joint
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-600">{inv.total_boxes}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                        {inv.total_amount.toFixed(2)}
                      </td>
                      {canSeeAll && (
                        <td className="px-4 py-3 text-gray-500 text-xs">{rich.creator?.name ?? "—"}</td>
                      )}
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(inv.created_at).toLocaleDateString("en-MY", {
                          day: "2-digit", month: "short", year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">

                          {/* 🖨 Print — always available */}
                          <button
                            onClick={() => handlePrint(inv.id, inv.invoice_no)}
                            disabled={!!printLoading || isPrinting}
                            className="text-xs text-gray-500 hover:text-gray-800 font-medium
                                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            title="Print invoice"
                          >
                            {isLoadingThis ? "…" : "🖨"}
                          </button>

                          {inv.status === "Active" && canMarkPaid && (
                            <button
                              onClick={() => handleMarkPaid(inv)}
                              className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
                            >
                              Mark Paid
                            </button>
                          )}
                          {inv.status === "Active" && canMarkPaid && (
                            <button
                              onClick={() => handleMarkCancelled(inv)}
                              className="text-xs text-orange-500 hover:text-orange-700 font-medium"
                            >
                              Cancel
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(inv.id, inv.invoice_no)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
