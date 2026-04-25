// ══════════════════════════════════════════════════════════════════════════════
// src/pages/products/show.tsx — Product Detail View
// MediGlove ERP · EPIC-03 / T-03.2
//
// Admin sees all fields including cost_price.
// Non-Admin: cost_price rendered as "🔒 Confidential".
// ══════════════════════════════════════════════════════════════════════════════

import React from "react";
import { useOne, useGetIdentity, useNavigation } from "@refinedev/core";
import { useParams } from "react-router-dom";
import type { Product } from "../../types/product";
import { CATEGORY_META } from "../../types/product";
import type { StaffRole } from "../../types/staff";

export function ProductShowPage() {
  const { id }   = useParams<{ id: string }>();
  const { edit, list } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isAdmin = identity?.role === "Admin";

  const { data, isLoading, isError } = useOne<Product>({
    resource: isAdmin ? "products" : "products_safe_view",
    id:       id!,
    meta: {
      select: isAdmin
        ? "id,name,sku,supplier_id,category,cost_price,min_selling_price,suggested_price,description,updated_at,created_at,supplier:suppliers!supplier_id(id,name)"
        : "id,name,sku,supplier_id,supplier_name,category,min_selling_price,suggested_price,description,updated_at,created_at",
    },
  });

  const p = data?.data;

  if (isLoading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>;
  }
  if (isError || !p) {
    return <div className="flex items-center justify-center h-48 text-sm text-red-500">Product not found.</div>;
  }

  const catMeta = CATEGORY_META[p.category];
  const supplierName = (p as unknown as { supplier?: { name: string }; supplier_name?: string }).supplier?.name
                    ?? (p as unknown as { supplier_name?: string }).supplier_name
                    ?? "—";

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="py-3 border-b border-gray-50 last:border-0">
      <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => list("products")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Products
          </button>
          <h1 className="text-xl font-bold text-gray-900">{p.name}</h1>
        </div>
        {isAdmin && (
          <button
            onClick={() => edit("products", p.id)}
            className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg
                       text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <dl>
          <Field label="SKU" value={<span className="font-mono">{p.sku}</span>} />
          <Field label="Supplier" value={supplierName} />
          <Field label="Category" value={
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${catMeta.color}`}>
              {catMeta.label} — {catMeta.desc}
            </span>
          } />
          {isAdmin ? (
            <Field
              label="Cost Price"
              value={
                <span className="tabular-nums font-medium text-amber-700">
                  RM {p.cost_price != null ? p.cost_price.toFixed(2) : "—"}
                  <span className="ml-2 text-xs text-amber-500 font-normal">🔒 Admin only</span>
                </span>
              }
            />
          ) : (
            <Field label="Cost Price" value={<span className="text-gray-400">🔒 Confidential</span>} />
          )}
          <Field label="Min Selling Price" value={`RM ${p.min_selling_price.toFixed(2)}`} />
          <Field label="Suggested Price"   value={`RM ${p.suggested_price.toFixed(2)}`} />
          {isAdmin && p.cost_price != null && (
            <Field
              label="Margin vs Min Price"
              value={
                <span className="tabular-nums text-emerald-700 font-medium">
                  RM {(p.min_selling_price - p.cost_price).toFixed(2)}
                  {" "}
                  ({((p.min_selling_price - p.cost_price) / p.cost_price * 100).toFixed(1)}%)
                </span>
              }
            />
          )}
          <Field label="Description" value={p.description ?? <span className="text-gray-400">—</span>} />
          <Field label="Created" value={new Date(p.created_at).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })} />
          <Field label="Last Updated" value={new Date(p.updated_at).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })} />
        </dl>
      </div>
    </div>
  );
}
