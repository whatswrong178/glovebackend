// ══════════════════════════════════════════════════════════════════════════════
// src/pages/purchaseOrders/show.tsx — Purchase Order Detail + Print/Download
// MediGlove ERP · Admin + HR
//
// Loads PO + items + supplier + invoice ref.
// Renders PrintLayout (PurchaseOrder type) with preview modal + print + PDF save.
// Status advance: Draft → Approved → Sent.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useRef, useState } from "react";
import { useOne, useList, useUpdate, useNavigation } from "@refinedev/core";
import { useParams } from "react-router-dom";
import { PrintLayout, PRINT_CSS } from "../../components/PrintLayout";
import type { PrintDocData, PrintLineItem, CompanyInfo } from "../../components/PrintLayout";
import { useCompanySettings } from "../../context/CompanySettingsContext";
import { supabaseClient } from "../../supabaseClient";

// ── Types ─────────────────────────────────────────────────────────────────────
interface POItem {
  id:         string;
  po_id:      string;
  product_id: string;
  qty:        number;
  unit_cost:  number;
  product:    { name: string; sku: string; units_per_carton: number | null } | null;
}

interface PurchaseOrder {
  id:          string;
  po_no:       string;
  status:      "Draft" | "Approved" | "Sent";
  created_at:  string;
  invoice_id:  string | null;
  supplier_id: string;
  supplier: {
    name:          string;
    email?:        string;
    contact_phone?: string;
    address?:       string;
    contact_person?: string;
  } | null;
  invoice: { invoice_no: string } | null;
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

// ── EditPOModal ───────────────────────────────────────────────────────────────
interface EditableItem {
  id:              string;
  product_id:      string;
  productName:     string;
  productSku:      string;
  qty:             string;   // string for input binding
  unit_cost:       string;
  unitsPerCarton:  number;   // for implied per-unit helper
}

function EditPOModal({
  poId,
  items,
  onClose,
  onSaved,
}: {
  poId:    string;
  items:   POItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<EditableItem[]>(() =>
    items.map((it) => ({
      id:             it.id,
      product_id:     it.product_id,
      productName:    it.product?.name ?? "Unknown",
      productSku:     it.product?.sku  ?? "—",
      qty:            String(it.qty),
      unit_cost:      String(it.unit_cost),
      unitsPerCarton: it.product?.units_per_carton ?? 1,
    }))
  );
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  const n = (v: string) => parseFloat(v) || 0;

  const update = (id: string, field: "qty" | "unit_cost", val: string) => {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: val } : r));
    setError("");
  };

  const subtotal = rows.reduce((s, r) => s + n(r.qty) * n(r.unit_cost), 0);
  const fmt = (v: number) => v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleSave = async () => {
    // Validate
    for (const r of rows) {
      if (n(r.qty) <= 0)      { setError(`${r.productSku}: Qty must be > 0.`);       return; }
      if (n(r.unit_cost) < 0) { setError(`${r.productSku}: Unit cost cannot be negative.`); return; }
    }
    setSaving(true);
    setError("");
    try {
      await Promise.all(
        rows.map((r) =>
          supabaseClient
            .from("purchase_order_items")
            .update({ qty: Math.round(n(r.qty)), unit_cost: n(r.unit_cost) })
            .eq("id", r.id)
            .throwOnError()
        )
      );
      onSaved();
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Edit Purchase Order</h2>
            <p className="text-xs text-gray-500 mt-0.5">Adjust quantities and unit costs. Changes save immediately.</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >✕</button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              ⚠️ {error}
            </div>
          )}

          {/* Hint banner */}
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <span className="mt-0.5 shrink-0">💡</span>
            <span>
              <strong>Cost per Carton</strong> = the price you pay per carton delivered.
              The implied per-unit cost is shown below each field — use it to verify the entry is correct.
            </span>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2">SKU</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2">Product</th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-20">Units/<br/>Carton</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-24">Qty<br/>(Cartons)</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-40">Cost/Carton (RM)</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 w-28">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => {
                const lineTotal        = n(row.qty) * n(row.unit_cost);
                const upc              = row.unitsPerCarton > 0 ? row.unitsPerCarton : 1;
                const impliedPerUnit   = n(row.unit_cost) / upc;
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="py-3 pr-3 font-mono text-xs text-gray-500">{row.productSku}</td>
                    <td className="py-3 pr-3 text-gray-800 font-medium">{row.productName}</td>
                    <td className="py-3 pr-3 text-center tabular-nums text-gray-600 font-medium">
                      {row.unitsPerCarton}
                    </td>
                    <td className="py-3 pr-3">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={row.qty}
                        onChange={(e) => update(row.id, "qty", e.target.value)}
                        className="w-full text-right text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums"
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.unit_cost}
                        onChange={(e) => update(row.id, "unit_cost", e.target.value)}
                        className="w-full text-right text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums"
                      />
                      {n(row.unit_cost) > 0 && (
                        <p className="text-right text-[10px] text-gray-400 tabular-nums mt-0.5">
                          = RM {impliedPerUnit.toLocaleString("en-MY", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} / unit
                        </p>
                      )}
                    </td>
                    <td className="py-3 text-right tabular-nums font-semibold text-gray-900">
                      {fmt(lineTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td colSpan={5} className="pt-3 text-right text-sm font-semibold text-gray-600 pr-3">New Total:</td>
                <td className="pt-3 text-right text-base font-bold text-gray-900 tabular-nums">
                  RM {fmt(subtotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── usePrint hook ─────────────────────────────────────────────────────────────
function usePrint() {
  const printRef = useRef<HTMLDivElement>(null);

  const triggerPrint = () => {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) { window.print(); return; }
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Purchase Order</title>
      <style>@page{size:A4;margin:15mm 14mm}body{margin:0}${PRINT_CSS}</style>
    </head><body><div class="print-area">${content}</div></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  return { printRef, triggerPrint };
}

// ── Main Component ────────────────────────────────────────────────────────────
export function POShowPage() {
  const { id } = useParams<{ id: string }>();
  const { list } = useNavigation();
  const { mutate: updatePO, isLoading: isUpdating } = useUpdate();
  const { settings } = useCompanySettings();
  const { printRef, triggerPrint } = usePrint();
  const [showPreview, setShowPreview] = useState(false);
  const [showEdit,    setShowEdit]    = useState(false);

  // Fetch PO
  const { data: poData, isLoading: poLoading, refetch } = useOne<PurchaseOrder>({
    resource: "purchase_orders",
    id:       id!,
    meta: {
      select: "id,po_no,status,created_at,invoice_id,supplier_id,supplier:suppliers!supplier_id(name,email,contact_phone,address,contact_person),invoice:invoices!invoice_id(invoice_no)",
    },
  });

  // Fetch PO items
  const { data: itemsData, isLoading: itemsLoading } = useList<POItem>({
    resource:   "purchase_order_items",
    pagination: { current: 1, pageSize: 200 },
    filters:    [{ field: "po_id", operator: "eq", value: id }],
    meta: {
      select: "id,po_id,product_id,qty,unit_cost,product:products!product_id(name,sku,units_per_carton)",
    },
  });

  const po    = poData?.data;
  const items = itemsData?.data ?? [];

  // ── Derived totals ─────────────────────────────────────────────────────────
  const totalCost = items.reduce((sum, i) => sum + i.qty * i.unit_cost, 0);

  // ── Build PrintDocData ──────────────────────────────────────────────────────
  const companyInfo: CompanyInfo = {
    name:    settings?.company_name    ?? "Equimed Supply",
    regNo:   settings?.registration_no ?? "",
    address: [
      settings?.address_line1,
      settings?.address_line2,
      [settings?.postcode, settings?.city].filter(Boolean).join(" "),
      settings?.state,
    ].filter(Boolean).join(", ") || "",
    phone:   settings?.phone           ?? "",
    email:   settings?.email           ?? "",
    website: settings?.website         ?? "",
  };

  const printItems: PrintLineItem[] = items.map((item, idx) => ({
    no:          idx + 1,
    description: item.product?.name ?? "Unknown Product",
    sku:         item.product?.sku  ?? "—",
    qty:         item.qty,
    unitPrice:   item.unit_cost,
    amount:      item.qty * item.unit_cost,
  }));

  const printDoc: PrintDocData | null = po ? {
    docNumber: po.po_no,
    date:      new Date(po.created_at).toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" }),
    status:    po.status,
    isDraft:   po.status === "Draft",
    parties: [
      {
        label:   "From (Buyer)",
        name:    companyInfo.name,
        address: companyInfo.address,
        contact: companyInfo.phone,
        email:   companyInfo.email,
      },
      {
        label:   "Supplier",
        name:    po.supplier?.name ?? "—",
        address: po.supplier?.address,
        contact: [po.supplier?.contact_person, po.supplier?.contact_phone].filter(Boolean).join(" · ") || undefined,
        email:   po.supplier?.email,
      },
    ],
    items:    printItems,
    subtotal: totalCost,
    total:    totalCost,
    notes:    po.invoice?.invoice_no ? `Invoice Ref: ${po.invoice.invoice_no}` : undefined,
    terms:    "Please deliver within 7 working days. Contact us for any discrepancies.",
  } : null;

  // ── Advance status ─────────────────────────────────────────────────────────
  const advanceStatus = () => {
    if (!po) return;
    const next = STATUS_NEXT[po.status];
    if (!next) return;
    updatePO(
      { resource: "purchase_orders", id: po.id, values: { status: next } },
      { onSuccess: () => refetch() }
    );
  };

  if (poLoading || itemsLoading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading purchase order…</div>;
  }

  if (!po || !printDoc) {
    return (
      <div className="max-w-2xl p-8 text-center text-gray-500">
        Purchase order not found.
        <button onClick={() => list("purchase_orders")} className="block mt-4 text-sm text-blue-600 hover:underline mx-auto">
          ← Back to Purchase Orders
        </button>
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="max-w-4xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => list("purchase_orders")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Purchase Orders
          </button>
          <h1 className="text-xl font-bold text-gray-900 font-mono">{po.po_no}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[po.status]}`}>
            {po.status}
          </span>
        </div>

        {/* Actions toolbar */}
        <div className="flex items-center gap-2">
          {po.status !== "Sent" && (
            <button
              onClick={() => setShowEdit(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors"
            >
              ✏️ Edit Prices
            </button>
          )}
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:border-gray-300 rounded-lg transition-colors"
          >
            🔍 Preview
          </button>
          <button
            onClick={triggerPrint}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            🖨 Print / Save PDF
          </button>
          {po.status !== "Sent" && (
            <button
              onClick={advanceStatus}
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
            >
              → Mark as {STATUS_NEXT[po.status]}
            </button>
          )}
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-4">
        <InfoCard label="Supplier"     value={po.supplier?.name ?? "—"} />
        <InfoCard label="Invoice Ref"  value={po.invoice?.invoice_no ?? "—"} mono />
        <InfoCard label="Date Created" value={new Date(po.created_at).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })} />
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Items ({items.length})</h2>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No items found for this PO.</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["#","SKU","Product","Qty","Unit Cost","Total"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{item.product?.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-800">{item.product?.name ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{item.qty}</td>
                    <td className="px-4 py-3 tabular-nums">RM {fmt(item.unit_cost)}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">RM {fmt(item.qty * item.unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Cost</p>
                <p className="text-xl font-bold text-gray-900">RM {fmt(totalCost)}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Edit Modal ───────────────────────────────────────────────────── */}
      {showEdit && (
        <EditPOModal
          poId={po.id}
          items={items}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); refetch(); }}
        />
      )}

      {/* ── Hidden print area ─────────────────────────────────────────────── */}
      <div className="hidden">
        <PrintLayout ref={printRef} doc={printDoc} type="PurchaseOrder" showPricing company={companyInfo} />
      </div>

      {/* ── Preview Modal ─────────────────────────────────────────────────── */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-800">Preview — {po.po_no}</h2>
              <div className="flex gap-2">
                <button
                  onClick={triggerPrint}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  🖨 Print / Save PDF
                </button>
                <button
                  onClick={() => setShowPreview(false)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-6">
              <PrintLayout doc={printDoc} type="PurchaseOrder" showPricing company={companyInfo} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper component ──────────────────────────────────────────────────────────
function InfoCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-sm font-medium text-gray-900 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
