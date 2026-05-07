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
// Print UX: click Invoice No. → preview modal → Print button → window.print()
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from "react";
import { useList, useUpdate, useDelete, useGetIdentity, useNavigation } from "@refinedev/core";
import type { CrudFilters } from "@refinedev/core";
import type { Invoice, InvoiceStatus } from "../../types/invoice";
import type { StaffRole } from "../../types/staff";
import { supabaseClient } from "../../supabaseClient";
import { PrintLayout, PRINT_CSS } from "../../components/PrintLayout";
import type { PrintDocData, CompanyInfo } from "../../components/PrintLayout";


type Tab = "active" | "completed";

interface PrintJob {
  doc:  PrintDocData;
  type: "Invoice";
}

// ── Status badge ──────────────────────────────────────────────────────────────
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

// ── Print Preview Modal ───────────────────────────────────────────────────────
interface PreviewModalProps {
  job:         PrintJob;
  company:     CompanyInfo;
  onClose:     () => void;
  onPrint:     () => void;
}

function PrintPreviewModal({ job, company, onClose, onPrint }: PreviewModalProps) {
  const { doc } = job;
  const fmt = (n: number) =>
    n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Print Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">TAX INVOICE · {doc.docNumber}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none font-light"
          >
            ✕
          </button>
        </div>

        {/* Document summary */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Company letterhead row */}
          <div className="flex items-start justify-between bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-bold text-blue-900">{company.name}</p>
              {company.regNo  && <p className="text-xs text-blue-700 mt-0.5">Reg: {company.regNo}</p>}
              {company.address && <p className="text-xs text-blue-600 mt-0.5">{company.address}</p>}
            </div>
            <div className="text-right text-xs text-blue-600 space-y-0.5">
              {company.phone   && <p>{company.phone}</p>}
              {company.email   && <p>{company.email}</p>}
            </div>
          </div>

          {/* Key info grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Client</p>
              <p className="text-sm font-semibold text-gray-900">
                {doc.parties[0]?.name ?? "—"}
              </p>
              {doc.parties[0]?.email && (
                <p className="text-xs text-gray-500">{doc.parties[0].email}</p>
              )}
            </div>
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Date / Status</p>
              <p className="text-sm font-semibold text-gray-900">{doc.date}</p>
              {doc.status && <StatusBadge status={doc.status as InvoiceStatus} />}
            </div>
          </div>

          {/* Items table */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Line Items ({doc.items.length})
            </p>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Description</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Qty</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Unit Price</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {doc.items.map((item) => (
                    <tr key={item.no}>
                      <td className="px-4 py-2 text-gray-800">{item.description}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{item.qty}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                        {item.unitPrice != null ? fmt(item.unitPrice) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-900">
                        {item.amount != null ? fmt(item.amount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="space-y-1 min-w-[220px]">
              {doc.subtotal != null && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Subtotal</span>
                  <span className="tabular-nums">MYR {fmt(doc.subtotal)}</span>
                </div>
              )}
              {doc.discount != null && doc.discount > 0 && (
                <div className="flex justify-between text-sm text-red-600">
                  <span>Discount</span>
                  <span className="tabular-nums">({fmt(doc.discount)})</span>
                </div>
              )}
              {doc.deliveryCharge != null && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Delivery</span>
                  <span className="tabular-nums">
                    {doc.deliveryCharge === 0
                      ? <span className="text-emerald-600 font-medium">FREE</span>
                      : `MYR ${fmt(doc.deliveryCharge)}`}
                  </span>
                </div>
              )}
              {doc.total != null && (
                <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-2 mt-2">
                  <span>Total (MYR)</span>
                  <span className="tabular-nums">{fmt(doc.total)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes / Terms */}
          {(doc.notes || doc.terms) && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800 space-y-1">
              {doc.notes  && <p><span className="font-semibold">Notes:</span> {doc.notes}</p>}
              {doc.terms  && <p><span className="font-semibold">Terms:</span> {doc.terms}</p>}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                       hover:bg-white transition-colors"
          >
            Close
          </button>
          <button
            onClick={onPrint}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700
                       rounded-lg transition-colors flex items-center gap-2"
          >
            🖨 Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Admin Edit Invoice Modal ──────────────────────────────────────────────────
interface EditableItem {
  invoice_item_id?:    string;
  product_id:          string;
  product_name:        string;
  sku:                 string;
  qty:                 number;
  unit:                string;
  selling_price:       string;
  cost_price_snapshot: number;   // preserved from original invoice_item — immutable
}

interface EditModalProps {
  invoice:  Invoice;
  onClose:  () => void;
  onSaved:  () => void;
}

interface ProductHit {
  id:         string;
  name:       string;
  sku:        string;
  cost_price: number;
}

function EditInvoiceModal({ invoice, onClose, onSaved }: EditModalProps) {
  const [items,          setItems]          = useState<EditableItem[]>([]);
  const [discount,       setDiscount]       = useState(String(invoice.discount ?? 0));
  const [discountMode,   setDiscountMode]   = useState<"rm" | "pct">("rm");
  const [discountPct,    setDiscountPct]    = useState("0");
  const [delivery,       setDelivery]       = useState(String(invoice.delivery_charge ?? 0));
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState("");
  const [productQuery,   setProductQuery]   = useState("");
  const [productHits,    setProductHits]    = useState<ProductHit[]>([]);
  const [productSearching, setProductSearching] = useState(false);
  const searchRef = React.useRef<HTMLDivElement>(null);

  const fmt = (n: number) =>
    n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  useEffect(() => {
    supabaseClient
      .from("invoice_items")
      .select("id,qty,selling_price,cost_price_snapshot,unit,product:products!product_id(id,name,sku)")
      .eq("invoice_id", invoice.id)
      .then(({ data }) => {
        type Row = {
          id: string; qty: number; selling_price: number;
          cost_price_snapshot: number; unit: string;
          product: { id: string; name: string; sku: string } | null;
        };
        setItems(
          ((data ?? []) as unknown as Row[]).map((r) => ({
            invoice_item_id:    r.id,
            product_id:         r.product?.id ?? "",
            product_name:       r.product?.name ?? "Unknown",
            sku:                r.product?.sku ?? "",
            qty:                r.qty,
            unit:               r.unit,
            selling_price:      String(r.selling_price),
            cost_price_snapshot: r.cost_price_snapshot,
          }))
        );
        setLoading(false);
      });
  }, [invoice.id]);

  // ── Product search ────────────────────────────────────────────────────────
  useEffect(() => {
    const q = productQuery.trim();
    if (!q) { setProductHits([]); return; }
    setProductSearching(true);
    supabaseClient
      .from("products")
      .select("id,name,sku,cost_price")
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8)
      .then(({ data }) => {
        setProductHits((data ?? []) as unknown as ProductHit[]);
        setProductSearching(false);
      });
  }, [productQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setProductQuery("");
        setProductHits([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const addProduct = (hit: ProductHit) => {
    setItems((prev) => [
      ...prev,
      {
        product_id:          hit.id,
        product_name:        hit.name,
        sku:                 hit.sku,
        qty:                 1,
        unit:                "Carton",
        selling_price:       "",
        cost_price_snapshot: hit.cost_price,
      },
    ]);
    setProductQuery("");
    setProductHits([]);
  };

  const updateItem = (idx: number, field: keyof EditableItem, val: string | number) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  };

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = items.reduce((s, it) => s + (parseInt(String(it.qty)) || 0) * (parseFloat(it.selling_price) || 0), 0);
  const disc     = discountMode === "pct"
    ? subtotal * ((parseFloat(discountPct) || 0) / 100)
    : parseFloat(discount) || 0;
  const del      = parseFloat(delivery) || 0;
  const newTotal = Math.max(0, subtotal - disc + del);

  const handleSave = async () => {
    if (items.length === 0) { setError("At least one item required."); return; }
    const unpricedIdx = items.findIndex((it) => !parseFloat(it.selling_price));
    if (unpricedIdx !== -1) {
      setError(`Item ${unpricedIdx + 1} (${items[unpricedIdx].product_name}) has no selling price.`);
      return;
    }
    setSaving(true); setError("");
    try {
      // 1. Delete old invoice_items
      const { error: delErr } = await supabaseClient
        .from("invoice_items")
        .delete()
        .eq("invoice_id", invoice.id);
      if (delErr) throw delErr;

      // 2. Re-insert updated items (cost_price_snapshot preserved from original row)
      const { error: insErr } = await supabaseClient
        .from("invoice_items")
        .insert(
          items.map((it) => ({
            invoice_id:          invoice.id,
            product_id:          it.product_id,
            qty:                 parseInt(String(it.qty)) || 1,
            selling_price:       parseFloat(it.selling_price) || 0,
            unit:                it.unit,
            cost_price_snapshot: it.cost_price_snapshot,
          }))
        );
      if (insErr) throw insErr;

      // 3. Update invoice totals
      const totalBoxes = items.reduce((s, it) => s + (parseInt(String(it.qty)) || 0), 0);
      const { error: updErr } = await supabaseClient
        .from("invoices")
        .update({
          discount:        disc,
          delivery_charge: del,
          total_amount:    newTotal,
          total_boxes:     totalBoxes,
        })
        .eq("id", invoice.id);
      if (updErr) throw updErr;

      onSaved();
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Edit Invoice</h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{invoice.invoice_no} · Admin only</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none font-light">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400">Loading items…</div>
          ) : (
            <>
              {/* Line items */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Line Items</p>
                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{it.product_name}</p>
                        <p className="text-xs text-gray-400 font-mono">{it.sku}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min="1"
                          value={it.qty}
                          onChange={(e) => updateItem(idx, "qty", Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-14 text-sm text-center border border-gray-200 rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <select
                          value={it.unit}
                          onChange={(e) => updateItem(idx, "unit", e.target.value)}
                          className="text-xs border border-gray-200 rounded-lg px-1 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          {["Carton","Box","Pack","Can","Piece","Bag","Roll"].map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                        <span className="text-xs text-gray-400">RM</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.selling_price}
                          onChange={(e) => updateItem(idx, "selling_price", e.target.value)}
                          className="w-20 text-sm text-right border border-gray-200 rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 text-lg leading-none ml-1">×</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Product Search */}
              <div ref={searchRef} className="relative">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add Product</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    placeholder="Search by name or SKU…"
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {productSearching && (
                    <span className="text-xs text-gray-400">Searching…</span>
                  )}
                </div>
                {productHits.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    {productHits.map((hit) => (
                      <button
                        key={hit.id}
                        onClick={() => addProduct(hit)}
                        className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <span className="text-sm font-medium text-gray-900">{hit.name}</span>
                        <span className="ml-2 text-xs font-mono text-gray-400">{hit.sku}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Discount / Delivery */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Discount</label>
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => setDiscountMode("rm")}
                      className={`px-2.5 text-xs font-bold border rounded-l-lg transition-colors ${
                        discountMode === "rm"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                      }`}
                    >RM</button>
                    <button
                      type="button"
                      onClick={() => setDiscountMode("pct")}
                      className={`px-2.5 text-xs font-bold border-t border-b border-r transition-colors ${
                        discountMode === "pct"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                      }`}
                    >%</button>
                    {discountMode === "rm" ? (
                      <input
                        type="number" min="0" step="0.01" value={discount}
                        onChange={(e) => setDiscount(e.target.value)}
                        className="flex-1 min-w-0 text-sm border border-l-0 border-gray-200 rounded-r-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    ) : (
                      <input
                        type="number" min="0" max="100" step="0.1" value={discountPct}
                        onChange={(e) => setDiscountPct(e.target.value)}
                        placeholder="e.g. 10"
                        className="flex-1 min-w-0 text-sm border border-l-0 border-gray-200 rounded-r-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    )}
                  </div>
                  {discountMode === "pct" && disc > 0 && (
                    <p className="text-xs text-gray-400 mt-1">= RM {disc.toFixed(2)}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Delivery Charge (RM)</label>
                  <input
                    type="number" min="0" step="0.01" value={delivery}
                    onChange={(e) => setDelivery(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>

              {/* New total preview */}
              <div className="flex justify-end">
                <div className="space-y-1 min-w-[200px] text-sm">
                  <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>MYR {fmt(subtotal)}</span></div>
                  {disc > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>({fmt(disc)})</span></div>}
                  {del > 0  && <div className="flex justify-between text-gray-600"><span>Delivery</span><span>MYR {fmt(del)}</span></div>}
                  <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-2">
                    <span>New Total</span><span>MYR {fmt(newTotal)}</span>
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── InvoiceListPage ───────────────────────────────────────────────────────────
export function InvoiceListPage() {
  const { push } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();

  const isAdmin     = identity?.role === "Admin";
  const isHR        = identity?.role === "HR";
  const canSeeAll   = isAdmin || isHR;
  const canDelete   = isAdmin;
  const canMarkPaid = isAdmin || isHR;

  const [tab,          setTab]          = useState<Tab>("active");
  const [search,       setSearch]       = useState("");
  const [page,         setPage]         = useState(1);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewJob,   setPreviewJob]   = useState<PrintJob | null>(null);
  const [printJob,     setPrintJob]     = useState<PrintJob | null>(null);
  const [editInvoice,  setEditInvoice]  = useState<Invoice | null>(null);
  const [companyInfo,  setCompanyInfo]  = useState<CompanyInfo>({ name: "Equimed Supply Enterprise" });
  const PAGE_SIZE = 25;

  const { mutate: deleteInvoice } = useDelete();
  const { mutate: updateInvoice } = useUpdate();

  // ── Fetch company settings once on mount ─────────────────────────────────
  useEffect(() => {
    supabaseClient
      .from("company_settings")
      .select("company_name,registration_no,address_line1,address_line2,city,postcode,state,phone,email,website,logo_url,bank_name,bank_account_name,bank_account_no,bank_swift_code")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single()
      .then(({ data }) => {
        if (!data) return;
        const addrParts = [
          data.address_line1,
          data.address_line2,
          [data.postcode, data.city].filter(Boolean).join(" "),
          data.state,
        ].filter(Boolean);
        setCompanyInfo({
          name:            data.company_name      ?? "Equimed Supply Enterprise",
          regNo:           data.registration_no   ?? undefined,
          address:         addrParts.join(", ")   || undefined,
          phone:           data.phone             ?? undefined,
          email:           data.email             ?? undefined,
          website:         data.website           ?? undefined,
          logoUrl:         data.logo_url          ?? undefined,
          bankName:        data.bank_name         ?? undefined,
          bankAccountName: data.bank_account_name ?? undefined,
          bankAccountNo:   data.bank_account_no   ?? undefined,
          bankSwiftCode:   data.bank_swift_code   ?? undefined,
        });
      });
  }, []);

  // ── Print (clean popup window — no app chrome) ───────────────────────────
  const printRef = useRef<HTMLDivElement>(null);

  const openPrintWindow = (content: string, title: string) => {
    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${title}</title>
      <style>@page{size:A4;margin:15mm 14mm}body{margin:0}${PRINT_CSS}</style>
    </head><body><div class="print-area">${content}</div></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  // When printJob is set → one RAF to let React render PrintLayout → open clean popup
  useEffect(() => {
    if (!printJob || !printRef.current) return;
    const rafId = requestAnimationFrame(() => {
      const content = printRef.current?.innerHTML ?? "";
      openPrintWindow(content, printJob.doc.docNumber);
      setPrintJob(null);
    });
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  // ── Fetch handler — called when invoice number is clicked ─────────────────
  const handlePreview = async (invoiceId: string) => {
    if (previewLoading) return;
    setPreviewLoading(invoiceId);

    try {
      const [{ data: invRaw }, { data: itemsRaw }] = await Promise.all([
        supabaseClient
          .from("invoices")
          .select(
            "id,invoice_no,status,region,total_amount,delivery_charge,discount,is_joint_order,created_at,paid_at," +
            "client:clients!client_id(name,ssm_no,region,contact_person,contact_email,contact_phone,address,credit_terms)," +
            "creator:staff!created_by(name)"
          )
          .eq("id", invoiceId)
          .single(),

        supabaseClient
          .from("invoice_items")
          .select("qty,selling_price,unit,product:products!product_id(name,sku)")
          .eq("invoice_id", invoiceId),
      ]);

      if (!invRaw) {
        alert("Failed to load invoice data.");
        return;
      }

      type RichClient = {
        name: string; ssm_no: string | null; region: string | null;
        contact_person: string | null; contact_email: string | null;
        contact_phone: string | null; credit_terms: string | null;
        address: string | null;
      };
      type ItemRow = {
        qty: number; selling_price: number; unit: string;
        product: { name: string; sku: string } | null;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inv       = invRaw as unknown as any;
      const lineItems = (itemsRaw ?? []) as unknown as ItemRow[];
      const client    = inv.client as RichClient | null;

      const subtotal = lineItems.reduce((s, it) => s + it.qty * it.selling_price, 0);

      // Fallback: compute total from line items when total_amount is null/0
      // (pre-M031 invoices never had the denormalized column populated)
      const discountAmt    = inv.discount       ?? 0;
      const deliveryAmt    = inv.delivery_charge ?? 0;
      const computedTotal  = Math.max(0, subtotal - discountAmt + deliveryAmt);
      const resolvedTotal  = (inv.total_amount != null && inv.total_amount > 0)
        ? inv.total_amount
        : computedTotal;

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
            address: client?.address ?? undefined,
            contact: client?.contact_person ?? undefined,
            email:   client?.contact_email ?? undefined,
          },
          ...(inv.is_joint_order ? [{ label: "Type", name: "Joint Order" }] : []),
        ],

        items: lineItems.map((it, idx) => ({
          no:          idx + 1,
          description: `${it.product?.name ?? "Unknown Product"} (${it.unit})`,
          sku:         it.product?.sku ?? undefined,
          qty:         it.qty,
          unitPrice:   it.selling_price,
          amount:      it.qty * it.selling_price,
        })),

        subtotal,
        discount:       discountAmt > 0 ? discountAmt : undefined,
        deliveryCharge: deliveryAmt > 0 ? deliveryAmt : undefined,
        total:          resolvedTotal,

        notes: inv.paid_at
          ? `Paid on ${new Date(inv.paid_at).toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" })}`
          : undefined,

        terms: client?.credit_terms ?? undefined,
      };

      setPreviewJob({ doc: docData, type: "Invoice" });

    } catch (err) {
      console.error("[InvoiceList] Preview fetch failed:", err);
      alert("Failed to load invoice. Please try again.");
    } finally {
      setPreviewLoading(null);
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
    Invoice & { client?: { name: string }; creator?: { name: string } }
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
      {
        resource: "invoices",
        id:       inv.id,
        values:   { status: "Paid", paid_at: new Date().toISOString() },
      },
      {
        onSuccess: () => refetch(),
        onError:   (err) => alert((err as unknown as Error).message ?? "Failed to mark invoice as Paid. Please try again."),
      }
    );
  };

  const handleMarkCancelled = (inv: Invoice) => {
    if (!window.confirm(`Cancel invoice ${inv.invoice_no}? This action cannot be undone.`)) return;
    updateInvoice(
      { resource: "invoices", id: inv.id, values: { status: "Cancelled" } },
      {
        onSuccess: () => refetch(),
        onError:   (err) => alert((err as unknown as Error).message ?? "Failed to cancel invoice. Please try again."),
      }
    );
  };

  const handleDelete = (id: string, no: string) => {
    if (!window.confirm(`Permanently delete invoice ${no}?`)) return;
    deleteInvoice(
      { resource: "invoices", id },
      {
        onSuccess: () => refetch(),
        onError:   (err) => alert((err as unknown as Error).message ?? "Delete failed. This invoice may have linked delivery orders."),
      }
    );
  };

  return (
    <div className="space-y-4">

      {/* Hidden print area */}
      {printJob && (
        <div aria-hidden="true" style={{ position: "fixed", left: "-9999px", top: 0, overflow: "hidden" }}>
          <PrintLayout ref={printRef} doc={printJob.doc} type={printJob.type} showPricing company={companyInfo} />
        </div>
      )}

      {/* Preview modal */}
      {previewJob && (
        <PrintPreviewModal
          job={previewJob}
          company={companyInfo}
          onClose={() => setPreviewJob(null)}
          onPrint={() => { const job = previewJob; setPreviewJob(null); setPrintJob(job); }}
        />
      )}

      {/* Admin edit modal */}
      {editInvoice && (
        <EditInvoiceModal
          invoice={editInvoice}
          onClose={() => setEditInvoice(null)}
          onSaved={() => { setEditInvoice(null); refetch(); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} record{total !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => push("/invoices/create")}
          className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
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
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  const isLoadingThis = previewLoading === inv.id;

                  return (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handlePreview(inv.id)}
                          disabled={!!previewLoading}
                          className="font-mono text-blue-600 hover:text-blue-800 hover:underline text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Click to preview & print"
                        >
                          {isLoadingThis ? <span className="text-gray-400">Loading…</span> : inv.invoice_no}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{rich.client?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <StatusBadge status={inv.status} />
                          {inv.is_joint_order && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">Joint</span>
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
                        {new Date(inv.created_at).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {inv.status === "Active" && isAdmin && (
                            <button onClick={() => setEditInvoice(inv)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                              Edit
                            </button>
                          )}
                          {inv.status === "Active" && canMarkPaid && (
                            <button onClick={() => handleMarkPaid(inv)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">
                              Mark Paid
                            </button>
                          )}
                          {inv.status === "Active" && canMarkPaid && (
                            <button onClick={() => handleMarkCancelled(inv)} className="text-xs text-orange-500 hover:text-orange-700 font-medium">
                              Cancel
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => handleDelete(inv.id, inv.invoice_no)} className="text-xs text-red-500 hover:text-red-700 font-medium">
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
              className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
