// ══════════════════════════════════════════════════════════════════════════════
// src/pages/products/create.tsx — Create Product
// MediGlove ERP · EPIC-03 / T-03.2
//
// Admin-only form. Supplier required (NOT NULL DB constraint).
// Price order: cost_price ≤ min_selling_price ≤ suggested_price enforced client-side.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { useCreate, useList, useNavigation } from "@refinedev/core";
import type { ProductFormValues, ProductCategory } from "../../types/product";
import { validatePriceOrder } from "../../types/product";
import type { Supplier } from "../../types/product";

// ── Category auto-detection ────────────────────────────────────────────────
// Rule: gross margin = (min_selling - cost) / min_selling
// ≥ 25% → Category A (supports 20% commission tier)
// < 25% → Category B (15% commission tier)
// Threshold chosen so commission is always < gross margin.
const CAT_A_MARGIN_THRESHOLD = 0.25;

interface MarginAnalysis {
  grossMargin:      number;   // 0–1
  markup:           number;   // 0+
  suggestedCategory: ProductCategory;
  commissionAtMin:  number;   // RM amount
  profitAfterComm:  number;   // RM amount after commission
  isViable:         boolean;  // profit > 0 after commission
}

function analyseMargin(cost: number, minSell: number): MarginAnalysis | null {
  if (!cost || !minSell || cost <= 0 || minSell <= cost) return null;
  const grossMargin     = (minSell - cost) / minSell;
  const markup          = (minSell - cost) / cost;
  const suggestedCategory: ProductCategory = grossMargin >= CAT_A_MARGIN_THRESHOLD ? "A" : "B";
  const commRate        = suggestedCategory === "A" ? 0.20 : 0.15;
  // Commission is calculated on GROSS PROFIT (matches calculateBaseCommission.ts engine):
  // GP = sellingPrice − costPrice; commission = GP × rate
  const gp              = minSell - cost;
  const commissionAtMin = gp * commRate;
  const profitAfterComm = gp - commissionAtMin; // = gp × (1 − commRate)
  return {
    grossMargin,
    markup,
    suggestedCategory,
    commissionAtMin,
    profitAfterComm,
    isViable: profitAfterComm > 0,
  };
}

export function ProductCreatePage() {
  const { list } = useNavigation();
  const { mutate: createProduct, isLoading: isSaving } = useCreate();

  const [form, setForm] = useState<ProductFormValues>({
    name:              "",
    sku:               "",
    supplier_id:       "",
    category:          "A",
    cost_price:        "",
    min_selling_price: "",
    suggested_price:   "",
    units_per_carton:  "1",
    description:       "",
  });

  // Track whether the user has manually overridden the auto-detected category
  const [categoryOverridden, setCategoryOverridden] = useState(false);

  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormValues | "_price", string>>>({});

  const { data: suppliersData, isLoading: suppliersLoading } = useList<Supplier>({
    resource:   "suppliers",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "name", order: "asc" }],
    meta:       { select: "id,name" },
    filters:    [{ field: "name", operator: "ne", value: "[Unknown Supplier]" }],
  });

  const suppliers = suppliersData?.data ?? [];

  // Compute margin analysis whenever cost or min_selling changes
  const margin = useMemo(() => {
    const cost    = parseFloat(form.cost_price);
    const minSell = parseFloat(form.min_selling_price);
    return analyseMargin(cost, minSell);
  }, [form.cost_price, form.min_selling_price]);

  const set = (field: keyof ProductFormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const value = e.target.value;

    // If user manually changes category, mark as overridden
    if (field === "category") {
      setCategoryOverridden(true);
      setForm((prev) => ({ ...prev, category: value as ProductCategory }));
      setErrors((prev) => ({ ...prev, category: undefined }));
      return;
    }

    setForm((prev) => {
      const next = { ...prev, [field]: value };

      // Auto-detect category from prices (unless user has overridden)
      if (!categoryOverridden && (field === "cost_price" || field === "min_selling_price")) {
        const cost    = parseFloat(field === "cost_price" ? value : prev.cost_price);
        const minSell = parseFloat(field === "min_selling_price" ? value : prev.min_selling_price);
        const analysis = analyseMargin(cost, minSell);
        if (analysis) next.category = analysis.suggestedCategory;
      }

      return next;
    });
    setErrors((prev) => ({ ...prev, [field]: undefined, _price: undefined }));
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};

    if (!form.name.trim())        newErrors.name        = "Product name is required";
    if (!form.sku.trim())         newErrors.sku         = "SKU is required";
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
    if (!validate()) return;

    createProduct(
      {
        resource: "products",
        values: {
          name:              form.name.trim(),
          sku:               form.sku.trim().toUpperCase(),
          supplier_id:       form.supplier_id,
          category:          form.category as ProductCategory,
          cost_price:        parseFloat(form.cost_price),
          min_selling_price: parseFloat(form.min_selling_price),
          suggested_price:   parseFloat(form.suggested_price),
          units_per_carton:  Math.max(1, parseInt(form.units_per_carton, 10) || 1),
          description:       form.description.trim() || null,
        },
      },
      {
        onSuccess: () => list("products"),
      }
    );
  };

  const priceValid =
    form.cost_price && form.min_selling_price && form.suggested_price && !errors._price &&
    validatePriceOrder({
      cost_price:        parseFloat(form.cost_price || "0"),
      min_selling_price: parseFloat(form.min_selling_price || "0"),
      suggested_price:   parseFloat(form.suggested_price || "0"),
    }) === null;

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
        <h1 className="text-xl font-bold text-gray-900">Add Product</h1>
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
            placeholder="e.g. Nitrile Examination Gloves M"
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                        focus:ring-blue-500 ${errors.name ? "border-red-400" : "border-gray-300"}`}
          />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* SKU */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            SKU <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.sku}
            onChange={set("sku")}
            placeholder="e.g. NIT-M-100"
            className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2
                        focus:ring-blue-500 font-mono ${errors.sku ? "border-red-400" : "border-gray-300"}`}
          />
          {errors.sku && <p className="text-xs text-red-500 mt-1">{errors.sku}</p>}
          <p className="text-xs text-gray-400 mt-1">SKU is immutable after creation. Will be saved in UPPERCASE.</p>
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

        {/* Category — auto-detected, manually overridable */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Category <span className="text-red-500">*</span>
            </label>
            {categoryOverridden && (
              <button
                type="button"
                onClick={() => {
                  setCategoryOverridden(false);
                  if (margin) setForm(p => ({ ...p, category: margin.suggestedCategory }));
                }}
                className="text-xs text-blue-500 hover:text-blue-700 underline"
              >
                Reset to auto-detect
              </button>
            )}
          </div>
          <select
            value={form.category}
            onChange={set("category")}
            className={`w-full text-sm border rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white
                       ${categoryOverridden ? "border-amber-400" : "border-gray-300"}`}
          >
            <option value="A">Category A — 20% commission tier</option>
            <option value="B">Category B — 15% commission tier</option>
          </select>
          {categoryOverridden && (
            <p className="text-xs text-amber-600 mt-1">⚠ Manual override — auto-detect disabled</p>
          )}
          {!categoryOverridden && !margin && (
            <p className="text-xs text-gray-400 mt-1">Enter cost price and min selling price to auto-detect category.</p>
          )}
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

        {/* Margin analysis panel */}
        {margin && (
          <div className={`rounded-xl border p-4 text-sm space-y-3
            ${margin.suggestedCategory === "A"
              ? "bg-blue-50 border-blue-200"
              : "bg-orange-50 border-orange-200"}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-lg font-black
                  ${margin.suggestedCategory === "A" ? "text-blue-700" : "text-orange-700"}`}>
                  Category {margin.suggestedCategory}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                  ${margin.suggestedCategory === "A"
                    ? "bg-blue-200 text-blue-800"
                    : "bg-orange-200 text-orange-800"}`}>
                  {margin.suggestedCategory === "A" ? "20% commission" : "15% commission"}
                </span>
                {categoryOverridden && form.category !== margin.suggestedCategory && (
                  <span className="text-xs text-amber-600 font-medium">
                    (suggested — overridden to {form.category})
                  </span>
                )}
              </div>
              {!margin.isViable && (
                <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                  ⚠ Margin too thin
                </span>
              )}
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-0.5">Gross Margin</p>
                <p className={`text-lg font-bold
                  ${margin.grossMargin >= CAT_A_MARGIN_THRESHOLD ? "text-blue-700" : "text-orange-700"}`}>
                  {(margin.grossMargin * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400">
                  threshold {(CAT_A_MARGIN_THRESHOLD * 100).toFixed(0)}%
                </p>
              </div>

              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-0.5">Markup</p>
                <p className="text-lg font-bold text-gray-800">
                  {(margin.markup * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-400">over cost</p>
              </div>

              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-0.5">Commission (min)</p>
                <p className="text-lg font-bold text-gray-800">
                  RM {margin.commissionAtMin.toFixed(2)}
                </p>
                <p className="text-xs text-gray-400">per unit sold</p>
              </div>

              <div className="bg-white/60 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-0.5">Profit after comm.</p>
                <p className={`text-lg font-bold
                  ${margin.profitAfterComm > 0 ? "text-emerald-700" : "text-red-600"}`}>
                  RM {margin.profitAfterComm.toFixed(2)}
                </p>
                <p className="text-xs text-gray-400">at min price</p>
              </div>
            </div>

            {/* Reason */}
            <p className={`text-xs ${margin.suggestedCategory === "A" ? "text-blue-700" : "text-orange-700"}`}>
              {margin.suggestedCategory === "A"
                ? `✓ ${(margin.grossMargin * 100).toFixed(1)}% gross margin ≥ ${(CAT_A_MARGIN_THRESHOLD * 100).toFixed(0)}% threshold → Category A auto-selected.`
                : `↓ ${(margin.grossMargin * 100).toFixed(1)}% gross margin < ${(CAT_A_MARGIN_THRESHOLD * 100).toFixed(0)}% threshold → Category B auto-selected.`}
              {!margin.isViable && " ⚠ Profit is negative at min selling price — review pricing."}
            </p>
          </div>
        )}

        {priceValid && !margin && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-xs text-emerald-700">
            ✓ Price order valid: RM {parseFloat(form.cost_price).toFixed(2)} ≤ RM {parseFloat(form.min_selling_price).toFixed(2)} ≤ RM {parseFloat(form.suggested_price).toFixed(2)}
          </div>
        )}

        {/* Units Per Carton */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Units Per Carton <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={form.units_per_carton}
            onChange={set("units_per_carton")}
            placeholder="e.g. 10"
            className="w-32 text-sm border border-gray-300 rounded-lg px-3 py-2
                       focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
          />
          <p className="text-xs text-gray-400 mt-1">
            How many boxes / packs / cans fit in one carton. Used to auto-calculate
            per-unit price on invoices when unit is changed from Carton.
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
            Description
          </label>
          <textarea
            value={form.description}
            onChange={set("description")}
            rows={3}
            placeholder="Optional product notes…"
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
            {isSaving ? "Saving…" : "Create Product"}
          </button>
        </div>
      </form>
    </div>
  );
}
