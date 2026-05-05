// ══════════════════════════════════════════════════════════════════════════════
// src/pages/products/list.tsx — Product Dictionary
// MediGlove ERP · EPIC-03 / T-03.2
//
// Admin reads `products` (with supplier join + cost_price).
// Non-Admin reads `products_safe_view` (cost_price = NULL, supplier_name direct).
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useList, useDelete, useGetIdentity, useNavigation } from "@refinedev/core";
import type { CrudFilters } from "@refinedev/core";
import type { Product } from "../../types/product";
import { CATEGORY_META } from "../../types/product";
import type { StaffRole } from "../../types/staff";

// ── helpers ──────────────────────────────────────────────────────────────────

type AdminProduct = Product & { supplier?: { id: string; name: string } };
type SafeProduct  = Product & { supplier_name?: string };

function getSupplierName(p: AdminProduct | SafeProduct): string {
  if ((p as AdminProduct).supplier?.name) return (p as AdminProduct).supplier!.name;
  if ((p as SafeProduct).supplier_name)   return (p as SafeProduct).supplier_name!;
  return "—";
}

// ── component ─────────────────────────────────────────────────────────────────

export function ProductListPage() {
  const { push } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isAdmin = identity?.role === "Admin";

  const [search,   setSearch]   = useState("");
  const [catFilter, setCatFilter] = useState<"" | "A" | "B">("");
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 20;

  const { mutate: deleteProduct } = useDelete();

  const filters: CrudFilters = [];
  if (catFilter) filters.push({ field: "category", operator: "eq", value: catFilter });
  if (search.trim()) {
    filters.push({
      operator: "or",
      value: [
        { field: "name", operator: "contains", value: search.trim() },
        { field: "sku",  operator: "contains", value: search.trim() },
      ],
    });
  }

  const { data, isLoading, refetch } = useList<AdminProduct | SafeProduct>({
    resource: isAdmin ? "products" : "products_safe_view",
    pagination: { current: page, pageSize: PAGE_SIZE },
    sorters:    [{ field: "name", order: "asc" }],
    filters,
    meta: {
      select: isAdmin
        ? "id,name,sku,category,cost_price,min_selling_price,suggested_price,supplier:suppliers!supplier_id(id,name)"
        : "id,name,sku,category,min_selling_price,suggested_price,supplier_name",
    },
  });

  const products = (data?.data ?? []) as (AdminProduct | SafeProduct)[];
  const total    = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteProduct(
      { resource: "products", id },
      {
        onSuccess: () => refetch(),
        onError:   (err) => alert((err as unknown as Error).message ?? "Delete failed. This product may be referenced by existing invoices."),
      }
    );
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} product{total !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              onClick={() => push("/products/import")}
              className="px-3 py-2 text-sm font-medium border border-indigo-200 rounded-lg
                         text-indigo-700 hover:bg-indigo-50 transition-colors"
            >
              🤖 AI Import
            </button>
            <button
              onClick={() => push("/products/bulk-create")}
              className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200
                         hover:bg-blue-100 rounded-lg transition-colors"
            >
              ⊞ Bulk Create (Variants)
            </button>
            <button
              onClick={() => push("/products/create")}
              className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg
                         hover:bg-blue-700 transition-colors"
            >
              + Add Product
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search name or SKU…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={catFilter}
          onChange={(e) => { setCatFilter(e.target.value as "" | "A" | "B"); setPage(1); }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All Categories</option>
          <option value="A">Category A</option>
          <option value="B">Category B</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
        ) : products.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">No products found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Supplier</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cat</th>
                  {isAdmin && (
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cost (RM)</th>
                  )}
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Min (RM)</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sugg (RM)</th>
                  {isAdmin && (
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {products.map((p) => {
                  const catMeta = CATEGORY_META[p.category];
                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => push(`/products/${p.id}`)}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-3 font-mono text-gray-500 text-xs">{p.sku}</td>
                      <td className="px-4 py-3 text-gray-600">{getSupplierName(p)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${catMeta.color}`}>
                          {p.category}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                          {(p as Product).cost_price != null
                            ? (p as Product).cost_price!.toFixed(2)
                            : <span className="text-gray-400">🔒</span>
                          }
                        </td>
                      )}
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {p.min_selling_price.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {p.suggested_price.toFixed(2)}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => push(`/products/${p.id}/edit`)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(p.id, p.name)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
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
