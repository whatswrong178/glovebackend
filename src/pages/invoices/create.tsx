// ══════════════════════════════════════════════════════════════════════════════
// src/pages/invoices/create.tsx — Create Invoice (3-unit bundle)
// MediGlove ERP · EPIC-05 / T-05.2 / T-05.3 / T-05.5
//
// Submits to create_invoice_atomic RPC which atomically creates:
//   Invoice + Delivery Order + Draft POs (per supplier)
//
// Promo rules (enforced by RPC, previewed in UI):
//   • Min 3 boxes total
//   • West Malaysia + ≥5 boxes → delivery_charge = 0 (free shipping)
//
// Joint Order (T-05.5): HR role toggle → is_joint_order=TRUE, co_created_by=HR id
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { useList, useGetIdentity, useNavigation } from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
import type { InvoiceLineItem, CreateInvoiceResult } from "../../types/invoice";
import type { Client } from "../../types/client";
import type { StaffRole, Staff } from "../../types/staff";

interface ProductOption {
  id:                string;
  name:              string;
  sku:               string;
  min_selling_price: number;
  suggested_price:   number;
}

export function InvoiceCreatePage() {
  const { list, push } = useNavigation();
  const supabase = supabaseClient;
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isHR    = identity?.role === "HR" || identity?.role === "Admin";

  // ── Form state ──────────────────────────────────────────────────────────────
  const [clientId,       setClientId]       = useState("");
  const [discount,       setDiscount]       = useState("0");
  const [deliveryCharge, setDeliveryCharge] = useState("0");
  const [isJointOrder,   setIsJointOrder]   = useState(false);
  const [coCreatedBy,    setCoCreatedBy]    = useState("");
  const [lineItems,      setLineItems]      = useState<InvoiceLineItem[]>([]);
  const [productSearch,  setProductSearch]  = useState("");
  const [clientSearch,   setClientSearch]   = useState("");
  const [errors,         setErrors]         = useState<Record<string, string>>({});
  const [submitting,     setSubmitting]     = useState(false);
  const [result,         setResult]         = useState<CreateInvoiceResult | null>(null);
  const [serverError,    setServerError]    = useState("");

  // ── Data fetches ─────────────────────────────────────────────────────────────
  const clientFilters: CrudFilters = [
    { field: "is_orphan", operator: "in", value: [true, false] }, // all clients
  ];
  if (clientSearch.trim()) {
    clientFilters.push({ field: "name", operator: "contains", value: clientSearch.trim() });
  }

  const { data: clientsData } = useList<Client>({
    resource:   "clients",
    pagination: { current: 1, pageSize: 100 },
    sorters:    [{ field: "name", order: "asc" }],
    filters:    clientFilters,
    meta:       { select: "id,name,region,credit_terms" },
  });

  const { data: productsData } = useList<ProductOption>({
    resource:   "products_safe_view",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "name", order: "asc" }],
    filters:    productSearch.trim()
      ? [{ operator: "or", value: [
          { field: "name", operator: "contains", value: productSearch.trim() },
          { field: "sku",  operator: "contains", value: productSearch.trim() },
        ]}]
      : [],
    meta: { select: "id,name,sku,min_selling_price,suggested_price" },
  });

  const { data: staffData } = useList<Staff>({
    resource:     "staff",
    pagination:   { current: 1, pageSize: 200 },
    filters:      [{ field: "status", operator: "eq", value: "Active" },
                   { field: "role", operator: "in", value: ["HR", "Admin"] }],
    meta:         { select: "id,name,role" },
    queryOptions: { enabled: isHR && isJointOrder },
  });

  const clients  = clientsData?.data ?? [];
  const products = productsData?.data ?? [];
  const staffList = staffData?.data ?? [];

  const selectedClient = clients.find((c) => c.id === clientId);

  // ── Computed promo preview ────────────────────────────────────────────────────
  const totalBoxes = useMemo(
    () => lineItems.reduce((sum, li) => sum + (li.qty || 0), 0),
    [lineItems]
  );
  const subtotal = useMemo(
    () => lineItems.reduce((sum, li) => sum + (li.qty || 0) * (parseFloat(li.selling_price) || 0), 0),
    [lineItems]
  );
  const freeShipping = selectedClient?.region === "West Malaysia" && totalBoxes >= 5;
  const effectiveDelivery = freeShipping ? 0 : parseFloat(deliveryCharge) || 0;
  const totalAmount = Math.max(0, subtotal - (parseFloat(discount) || 0) + effectiveDelivery);

  // ── Line item handlers ────────────────────────────────────────────────────────
  const addProduct = (p: ProductOption) => {
    if (lineItems.some((li) => li.product_id === p.id)) return;
    setLineItems((prev) => [...prev, {
      product_id:        p.id,
      product_name:      p.name,
      sku:               p.sku,
      qty:               1,
      selling_price:     String(p.suggested_price),
      min_selling_price: p.min_selling_price,
      suggested_price:   p.suggested_price,
    }]);
    setProductSearch("");
  };

  const updateLine = (idx: number, field: "qty" | "selling_price", value: string) => {
    setLineItems((prev) => {
      const next = [...prev];
      const li = { ...next[idx] };
      if (field === "qty") {
        li.qty = Math.max(1, parseInt(value) || 1);
      } else {
        li.selling_price = value;
        const sp = parseFloat(value);
        li._error = (!value || isNaN(sp))
          ? "Required"
          : sp < li.min_selling_price
          ? `Below min RM ${li.min_selling_price.toFixed(2)}`
          : undefined;
      }
      next[idx] = li;
      return next;
    });
  };

  const removeLine = (idx: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!clientId)             newErrors.clientId = "Client is required";
    if (lineItems.length === 0) newErrors.items   = "At least one product line is required";
    if (totalBoxes < 3)         newErrors.boxes   = `Minimum 3 boxes required (currently ${totalBoxes})`;
    if (lineItems.some((li) => li._error)) newErrors.priceErrors = "Fix price errors above";
    if (isJointOrder && !coCreatedBy) newErrors.coCreatedBy = "Co-created by is required for joint orders";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setServerError("");

    try {
      const { data, error } = await supabase.rpc("create_invoice_atomic", {
        p_client_id:       clientId,
        p_items:           lineItems.map((li) => ({
          product_id:    li.product_id,
          qty:           li.qty,
          selling_price: parseFloat(li.selling_price),
        })),
        p_discount:        parseFloat(discount) || 0,
        p_delivery_charge: effectiveDelivery,
        p_is_joint_order:  isJointOrder,
        p_co_created_by:   isJointOrder ? coCreatedBy : null,
      });

      if (error) throw error;
      setResult(data as CreateInvoiceResult);
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Invoice creation failed.";
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success screen ────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center space-y-4">
          <div className="text-4xl">✓</div>
          <h2 className="text-xl font-bold text-emerald-800">Invoice Created</h2>
          <div className="space-y-1 text-sm text-emerald-700">
            <p>Invoice: <strong className="font-mono">{result.invoice_no}</strong></p>
            <p>Delivery Order: <strong className="font-mono">{result.do_no}</strong></p>
            <p>Total: <strong>RM {result.total_amount.toFixed(2)}</strong></p>
            <p>Boxes: <strong>{result.total_boxes}</strong></p>
            {result.ownership_transferred && (
              <p className="text-orange-700 font-semibold">
                ⚠️ Neglect Index reached 6 — client ownership has been transferred to you.
              </p>
            )}
          </div>
          <div className="flex gap-3 justify-center pt-2">
            <button
              onClick={() => push("/invoices")}
              className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              View Invoices
            </button>
            <button
              onClick={() => push("/delivery-orders")}
              className="px-4 py-2 text-sm font-medium border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors"
            >
              View DO
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => list("invoices")}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Invoices
        </button>
        <h1 className="text-xl font-bold text-gray-900">New Invoice</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {serverError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            ⚠️ {serverError}
          </div>
        )}

        {/* Client */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Client</h2>
          <input
            type="text"
            placeholder="Search client name…"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setErrors((p) => ({ ...p, clientId: undefined! })); }}
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                        focus:ring-blue-500 bg-white ${errors.clientId ? "border-red-400" : "border-gray-300"}`}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.region}) — {c.credit_terms}
              </option>
            ))}
          </select>
          {errors.clientId && <p className="text-xs text-red-500">{errors.clientId}</p>}

          {selectedClient && (
            <div className="flex gap-3 text-xs text-gray-500">
              <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium ${
                selectedClient.region === "West Malaysia" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
              }`}>
                {selectedClient.region}
              </span>
              <span>{selectedClient.credit_terms}</span>
            </div>
          )}
        </div>

        {/* Joint Order toggle (HR only) */}
        {isHR && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="jointOrder"
                checked={isJointOrder}
                onChange={(e) => setIsJointOrder(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="jointOrder" className="text-sm font-medium text-gray-700">
                Joint Order (HR代开单 — 50/50 commission split)
              </label>
            </div>
            {isJointOrder && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Co-Created By (HR Staff) <span className="text-red-500">*</span>
                </label>
                <select
                  value={coCreatedBy}
                  onChange={(e) => setCoCreatedBy(e.target.value)}
                  className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                              focus:ring-blue-500 bg-white ${errors.coCreatedBy ? "border-red-400" : "border-gray-300"}`}
                >
                  <option value="">Select HR staff…</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                  ))}
                </select>
                {errors.coCreatedBy && <p className="text-xs text-red-500 mt-1">{errors.coCreatedBy}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  Commission: 50% to client owner, 50% to this HR staff member.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Product line items */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Products</h2>

          {/* Product search + add */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search product name or SKU to add…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {productSearch.trim() && products.length > 0 && (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p)}
                  disabled={lineItems.some((li) => li.product_id === p.id)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="ml-2 font-mono text-gray-400 text-xs">{p.sku}</span>
                  <span className="ml-2 text-gray-500 text-xs">Min: RM {p.min_selling_price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}

          {errors.items && <p className="text-xs text-red-500">{errors.items}</p>}

          {/* Line item table */}
          {lineItems.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <th className="text-left pb-2">Product</th>
                    <th className="text-center pb-2 w-20">Qty (boxes)</th>
                    <th className="text-right pb-2 w-32">Selling Price (RM)</th>
                    <th className="text-right pb-2 w-24">Subtotal</th>
                    <th className="pb-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {lineItems.map((li, idx) => (
                    <tr key={li.product_id}>
                      <td className="py-2">
                        <div className="font-medium text-gray-900">{li.product_name}</div>
                        <div className="font-mono text-gray-400 text-xs">{li.sku}</div>
                      </td>
                      <td className="py-2 text-center">
                        <input
                          type="number"
                          min="1"
                          value={li.qty}
                          onChange={(e) => updateLine(idx, "qty", e.target.value)}
                          className="w-16 text-center text-sm border border-gray-300 rounded px-2 py-1
                                     focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="py-2">
                        <div className="flex flex-col items-end">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={li.selling_price}
                            onChange={(e) => updateLine(idx, "selling_price", e.target.value)}
                            className={`w-28 text-right text-sm border rounded px-2 py-1 tabular-nums
                                        focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                          li._error ? "border-red-400" : "border-gray-300"
                                        }`}
                          />
                          {li._error && <p className="text-xs text-red-500 mt-0.5">{li._error}</p>}
                          <p className="text-xs text-gray-400">Min: {li.min_selling_price.toFixed(2)}</p>
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-700">
                        {(li.qty * (parseFloat(li.selling_price) || 0)).toFixed(2)}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-red-400 hover:text-red-600 text-xs"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pricing summary */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Pricing</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Discount (RM)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Delivery Charge (RM)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={deliveryCharge}
                onChange={(e) => setDeliveryCharge(e.target.value)}
                disabled={freeShipping}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums
                           disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
              />
              {freeShipping && (
                <p className="text-xs text-emerald-600 font-medium mt-1">
                  🎉 Free shipping — West Malaysia ≥5 boxes!
                </p>
              )}
            </div>
          </div>

          {/* Promo warnings */}
          {lineItems.length > 0 && totalBoxes < 3 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-700">
              ⚠️ {errors.boxes ?? `Minimum 3 boxes required. Currently: ${totalBoxes} box(es).`}
            </div>
          )}

          {/* Order summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span className="tabular-nums">RM {subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Discount</span>
              <span className="tabular-nums text-orange-600">− RM {(parseFloat(discount) || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Delivery {freeShipping ? "(Free)" : ""}</span>
              <span className="tabular-nums">{freeShipping ? "RM 0.00" : `RM ${effectiveDelivery.toFixed(2)}`}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200">
              <span>Total</span>
              <span className="tabular-nums">RM {totalAmount.toFixed(2)}</span>
            </div>
            <div className="text-xs text-gray-400 text-right">
              {totalBoxes} box{totalBoxes !== 1 ? "es" : ""}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => list("invoices")}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                       hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                       rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating…" : "Create Invoice + DO"}
          </button>
        </div>
      </form>
    </div>
  );
}
