// ══════════════════════════════════════════════════════════════════════════════
// src/pages/products/edit.tsx — Edit Product
// MediGlove ERP · EPIC-03 / T-03.2
//
// Identical form to create.tsx but pre-populated via useOne.
// Admin-only. SKU is read-only after creation (immutable identifier).
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { useOne, useUpdate, useList, useNavigation } from "@refinedev/core";
import { useParams } from "react-router-dom";
import type { Product, ProductFormValues, ProductCategory } from "../../types/product";
import { validatePriceOrder } from "../../types/product";
import type { Supplier } from "../../types/product";

export function ProductEditPage() {
  const { id }             = useParams<{ id: string }>();
  const { list }           = useNavigation();
  const { mutate: updateProduct, isLoading: isSaving } = useUpdate();

  const [form,      setForm]      = useState<ProductFormValues | null>(null);
  const [errors,    setErrors]    = useState<Partial<Record<keyof ProductFormValues | "_price", string>>>({});
  const [initDone,  setInitDone]  = useState(false);

  const { data: productData, isLoading: productLoading } = useOne<Product>({
    resource: "products",
    id:       id!,
    meta:     { select: "id,name,sku,supplier_id,category,cost_price,min_selling_price,suggested_price,description" },
  });

  const { data: suppliersData, isLoading: suppliersLoading } = useList<Supplier>({
    resource: "suppliers",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "name", order: "asc" }],
    meta:       { select: "id,name" },
    filters:    [{ field: "name", operator: "ne", value: "[Unknown Supplier]" }],
  });

  const suppliers = suppliersData?.data ?? [];

  // Populate form once product data arrives
  useEffect(() => {
    const p = productData?.data;
    if (p && !initDone) {
      setForm({
        name:              p.name,
        sku:               p.sku,
        supplier_id:       p.supplier_id,
        category:          p.category,
        cost_price:        p.cost_price != null ? String(p.cost_price) : "",
        min_selling_price: String(p.min_selling_price),
        suggested_price:   String(p.suggested_price),
        description:       p.description ?? "",
      });
      setInitDone(true);
    }
  }, [productData, initDone]);

  if (productLoading || !form) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        Loading product…
      </div>
    );
  }

  const set = (field: keyof ProductFormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => prev ? { ...prev, [field]: e.target.value } : prev);
    setErrors((prev) => ({ ...prev, [field]: undefined, _price: undefined }));
  };

  const validate = (): boolean => {
    if (!form) return false;
    const newErrors: typeof errors = {};

    if (!form.name.trim())        newErrors.name        = "Product name is required";
    if (!form.supplier_id)        newErrors.supplier_id = "Supplier is required";
    if (!form.cost_price)         newErrors.cost_price  = "Cost price is required";
    if (!form.min_selling_price)  newErrors.min_selling_price = "Min selling price is required";
    if (!form.suggested_price)    newErrors.suggested_price   = "Suggested price is required";

    if (form.cost_price && form.min_selling_price && form.suggested_price) {
      const priceErr = validatePriceOrder({
        cost_price:        parseFloat(form.cost_price),
        min_selling_price: parseFloat(form.min_selling_price),
        suggested_price:   parseFloat(form.suggested_price),
      });
      if (priceErr) newErrors._price = priceErr;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !validate()) return;

    updateProduct(
      {
        resource: "products",
        id:       id!,
        values: {
          name:              form.name.trim(),
          supplier_id:       form.supplier_id,
          category:          form.category as ProductCategory,
          cost_price:        parseFloat(form.cost_price),
          min_selling_price: parseFloat(form.min_selling_price),
          suggested_price:   parseFloat(form.suggested_price),
          description:       form.description.trim() || null,
          // SKU is NOT updated — immutable after creation
        },
      },
      {
        onSuccess: () => list("products"),
      }
    );
  };

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => list("products")}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← Products
        </button>
        <h1 className="text-xl font-bold text-gray-900">Edit Product</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">

        {errors._price && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            ⚠️ {errors._price}
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Product Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={set("name")}
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                        focus:ring-blue-500 ${errors.name ? "border-red-400" : "border-gray-300"}`}
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* SKU — read-only */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            SKU
          </label>
          <input
            type="text"
            value={form.sku}
            readOnly
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50
                       text-gray-500 font-mono cursor-not-allowed"
          />
          <p className="text-xs text-gray-400 mt-1">SKU is immutable after creation.</p>
        </div>

        {/* Supplier */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Supplier <span className="text-red-500">*</span>
          </label>
          <select
            value={form.supplier_id}
            onChange={set("supplier_id")}
            disabled={suppliersLoading}
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                        focus:ring-blue-500 bg-white ${errors.supplier_id ? "border-red-400" : "border-gray-300"}`}
          >
            <option value="">Select a supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {errors.supplier_id && <p className="text-xs text-red-500 mt-1">{errors.supplier_id}</p>}
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            value={form.category}
            onChange={set("category")}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="A">Category A — 20% commission tier</option>
            <option value="B">Category B — 15% commission tier</option>
          </select>
        </div>

        {/* Prices */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Cost Price (RM) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.cost_price}
              onChange={set("cost_price")}
              placeholder="0.00"
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                          focus:ring-blue-500 tabular-nums ${errors.cost_price ? "border-red-400" : "border-gray-300"}`}
            />
            {errors.cost_price && <p className="text-xs text-red-500 mt-1">{errors.cost_price}</p>}
            <p className="text-xs text-amber-600 mt-1 font-medium">🔒 Admin-only</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Min Selling (RM) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.min_selling_price}
              onChange={set("min_selling_price")}
              placeholder="0.00"
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                          focus:ring-blue-500 tabular-nums ${errors.min_selling_price ? "border-red-400" : "border-gray-300"}`}
            />
            {errors.min_selling_price && <p className="text-xs text-red-500 mt-1">{errors.min_selling_price}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Suggested (RM) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.suggested_price}
              onChange={set("suggested_price")}
              placeholder="0.00"
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                          focus:ring-blue-500 tabular-nums ${errors.suggested_price ? "border-red-400" : "border-gray-300"}`}
            />
            {errors.suggested_price && <p className="text-xs text-red-500 mt-1">{errors.suggested_price}</p>}
          </div>
        </div>

        {form.cost_price && form.min_selling_price && form.suggested_price && !errors._price && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-xs text-emerald-700">
            ✓ Price order valid: RM {parseFloat(form.cost_price).toFixed(2)} ≤ RM {parseFloat(form.min_selling_price).toFixed(2)} ≤ RM {parseFloat(form.suggested_price).toFixed(2)}
          </div>
        )}

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={set("description")}
            rows={3}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => list("products")}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                       hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                       rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
