// ══════════════════════════════════════════════════════════════════════════════
// src/pages/products/bulk-create.tsx — Bulk Product Create with Variant SKU
// MediGlove ERP · Admin-only
//
// Flow:
//   1. Fill base product info (name, supplier, prices, units_per_carton, desc)
//   2. Define base SKU prefix + add variant rows (label + size code)
//      → Auto-generates SKU = BASESKU-SIZECODE  (e.g. NIT-XS, NIT-S, NIT-M)
//   3. Each variant can optionally override price + units_per_carton
//   4. Submit → creates N products in sequence, all linked via parent_product_id
//
// Admin-only gate enforced in Layout nav. No DB gate needed (products table
// is already admin-write via RLS).
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { useCreate, useList, useNavigation, useGetIdentity } from "@refinedev/core";
import type { Supplier } from "../../types/product";
import type { StaffRole } from "../../types/staff";

// Common glove sizes for quick-fill
const QUICK_SIZES = [
  { label: "Extra Small", code: "XS" },
  { label: "Small",       code: "S"  },
  { label: "Medium",      code: "M"  },
  { label: "Large",       code: "L"  },
  { label: "Extra Large", code: "XL" },
  { label: "XXL",         code: "XXL" },
];

interface VariantRow {
  id:              number;   // local key
  label:           string;   // e.g. "Small"
  sizeCode:        string;   // e.g. "S" — appended to base SKU
  // price overrides (empty = inherit from base)
  costOverride:    string;
  minOverride:     string;
  sugOverride:     string;
  unitsOverride:   string;
}

interface BaseForm {
  name:             string;
  baseSku:          string;
  supplier_id:      string;
  category:         "A" | "B";
  cost_price:       string;
  min_selling_price:string;
  suggested_price:  string;
  units_per_carton: string;
  description:      string;
}

let _rowId = 0;
function newRow(label = "", code = ""): VariantRow {
  return { id: ++_rowId, label, sizeCode: code, costOverride: "", minOverride: "", sugOverride: "", unitsOverride: "" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function gp(sell: number, cost: number): string {
  if (sell <= 0 || cost < 0) return "—";
  const pct = ((sell - cost) / sell) * 100;
  return pct.toFixed(1) + "%";
}

function gpColor(sell: number, cost: number): string {
  if (sell <= 0) return "text-gray-400";
  const pct = ((sell - cost) / sell) * 100;
  if (pct >= 30) return "text-emerald-600 font-semibold";
  if (pct >= 15) return "text-yellow-600 font-semibold";
  return "text-red-600 font-semibold";
}

function skuFor(base: string, code: string): string {
  const b = base.trim().toUpperCase();
  const c = code.trim().toUpperCase();
  if (!b && !c) return "";
  if (!c) return b;
  if (!b) return c;
  return `${b}-${c}`;
}

export function ProductBulkCreatePage() {
  const { list } = useNavigation();
  const { data: identity } = useGetIdentity<{ id: string; role: StaffRole }>();
  const { mutate: createProduct, isLoading: isSaving } = useCreate();

  const [base, setBase] = useState<BaseForm>({
    name:              "",
    baseSku:           "",
    supplier_id:       "",
    category:          "A",
    cost_price:        "",
    min_selling_price: "",
    suggested_price:   "",
    units_per_carton:  "1",
    description:       "",
  });

  const [variants, setVariants] = useState<VariantRow[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; errors: string[] } | null>(null);
  const [globalError, setGlobalError] = useState("");

  const { data: suppliersData } = useList<Supplier>({
    resource:   "suppliers",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "name", order: "asc" }],
    meta:       { select: "id,name" },
    filters:    [{ field: "name", operator: "ne", value: "[Unknown Supplier]" }],
  });
  const suppliers = suppliersData?.data ?? [];

  // ── Base field setter ──────────────────────────────────────────────────────
  const setBaseField = (field: keyof BaseForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setBase(p => ({ ...p, [field]: e.target.value }));

  // ── Variant operations ─────────────────────────────────────────────────────
  const addRow = () => setVariants(p => [...p, newRow()]);
  const removeRow = (id: number) => setVariants(p => p.filter(r => r.id !== id));

  const setVariantField = (id: number, field: keyof VariantRow) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setVariants(p => p.map(r => r.id === id ? { ...r, [field]: e.target.value } : r));

  const applyQuickSizes = () => {
    setVariants(QUICK_SIZES.map(s => newRow(s.label, s.code)));
  };

  // ── Preview table ──────────────────────────────────────────────────────────
  const preview = useMemo(() =>
    variants.map(v => ({
      ...v,
      sku:       skuFor(base.baseSku, v.sizeCode),
      cost:      parseFloat(v.costOverride || base.cost_price) || 0,
      minSell:   parseFloat(v.minOverride  || base.min_selling_price) || 0,
      suggested: parseFloat(v.sugOverride  || base.suggested_price) || 0,
      units:     parseInt(v.unitsOverride  || base.units_per_carton, 10) || 1,
    }))
  , [variants, base]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!base.name.trim())        return "Product base name is required";
    if (!base.baseSku.trim())     return "Base SKU prefix is required";
    if (!base.supplier_id)        return "Supplier is required";
    if (!base.cost_price)         return "Cost price is required";
    if (!base.min_selling_price)  return "Min selling price is required";
    if (!base.suggested_price)    return "Suggested price is required";
    if (variants.length === 0)    return "Add at least one variant";
    for (const v of preview) {
      if (!v.label.trim()) return `A variant label is empty`;
      if (!v.sizeCode.trim()) return `Variant "${v.label}" has no size code`;
      if (!v.sku) return `Variant "${v.label}" produced an empty SKU`;
      if (v.cost > v.minSell || v.minSell > v.suggested) {
        return `Variant "${v.label}" violates price order: cost ≤ min ≤ suggested`;
      }
    }
    const skus = preview.map(v => v.sku);
    if (new Set(skus).size !== skus.length) return "Duplicate SKUs detected — check size codes";
    return null;
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setGlobalError(err); return; }
    setGlobalError("");
    setSubmitting(true);
    setProgress({ done: 0, total: preview.length, errors: [] });

    // Step 1: Create the "parent" product (first variant acts as parent reference)
    // We use the first variant as the parent, or create a parent stub if >1 variant
    let parentId: string | null = null;
    const errors: string[] = [];

    for (let i = 0; i < preview.length; i++) {
      const v = preview[i];
      const payload = {
        name:              `${base.name.trim()} — ${v.label}`,
        sku:               v.sku,
        supplier_id:       base.supplier_id,
        category:          base.category,
        cost_price:        v.cost,
        min_selling_price: v.minSell,
        suggested_price:   v.suggested,
        units_per_carton:  v.units,
        description:       base.description.trim() || null,
        parent_product_id: i === 0 ? null : parentId,
        variant_label:     v.label,
      };

      await new Promise<void>((resolve) => {
        createProduct(
          { resource: "products", values: payload },
          {
            onSuccess: (data) => {
              if (i === 0) parentId = (data.data as { id: string }).id;
              setProgress(p => p ? { ...p, done: p.done + 1 } : p);
              resolve();
            },
            onError: (err) => {
              const msg = (err as { message?: string })?.message ?? "Unknown error";
              errors.push(`${v.sku}: ${msg}`);
              setProgress(p => p ? { ...p, done: p.done + 1, errors: [...p.errors, `${v.sku}: ${msg}`] } : p);
              resolve();
            },
          }
        );
      });
    }

    setSubmitting(false);
    if (errors.length === 0) {
      list("products");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (identity?.role !== "Admin") {
    return (
      <div className="max-w-2xl p-8 text-center text-gray-500">
        🔒 Admin access required.
      </div>
    );
  }

  if (progress && !submitting && progress.errors.length > 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-xl font-bold text-gray-900">Bulk Create — Partial Result</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
          <p className="text-sm font-semibold text-amber-800">
            {progress.done - progress.errors.length} / {progress.total} variants created successfully.
          </p>
          <p className="text-sm text-amber-700">The following SKUs failed:</p>
          <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
            {progress.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
        <button
          onClick={() => list("products")}
          className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Go to Products
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => list("products")} className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
          ← Products
        </button>
        <h1 className="text-xl font-bold text-gray-900">Bulk Create — Product Variants</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {globalError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            ⚠️ {globalError}
          </div>
        )}

        {/* ── BASE PRODUCT INFO ────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Base Product Info</h2>
          <p className="text-xs text-gray-500">
            These values apply to all variants unless individually overridden in the table below.
          </p>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Base Product Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={base.name}
              onChange={setBaseField("name")}
              placeholder="e.g. Nitrile Examination Gloves"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Variant name will be: "{base.name.trim() || "…"} — Small" etc.</p>
          </div>

          {/* Base SKU + Supplier */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Base SKU Prefix <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={base.baseSku}
                onChange={setBaseField("baseSku")}
                placeholder="e.g. NIT"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
              />
              <p className="text-xs text-gray-400 mt-1">SKU = PREFIX-SIZECODE (e.g. NIT-M)</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Supplier <span className="text-red-500">*</span>
              </label>
              <select
                value={base.supplier_id}
                onChange={setBaseField("supplier_id")}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Select supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Category</label>
            <select
              value={base.category}
              onChange={setBaseField("category")}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="A">Category A — 20% commission tier</option>
              <option value="B">Category B — 15% commission tier</option>
            </select>
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { field: "cost_price" as const,        label: "Cost Price (RM)",    hint: "🔒 Admin-only" },
              { field: "min_selling_price" as const,  label: "Min Selling (RM)",   hint: "" },
              { field: "suggested_price" as const,    label: "Suggested (RM)",     hint: "" },
            ].map(({ field, label, hint }) => (
              <div key={field}>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  {label} <span className="text-red-500">*</span>
                </label>
                <input
                  type="number" min="0" step="0.01"
                  value={base[field]}
                  onChange={setBaseField(field)}
                  placeholder="0.00"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
                />
                {hint && <p className="text-xs text-amber-600 mt-1 font-medium">{hint}</p>}
              </div>
            ))}
          </div>

          {/* ── Live GP Calculator ────────────────────────────────────────── */}
          {(base.cost_price || base.min_selling_price || base.suggested_price) && (() => {
            const cost = parseFloat(base.cost_price) || 0;
            const min  = parseFloat(base.min_selling_price) || 0;
            const sug  = parseFloat(base.suggested_price) || 0;
            const upc  = parseInt(base.units_per_carton, 10) || 1;
            return (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
                <div className="col-span-2 text-gray-500 font-semibold uppercase tracking-wide mb-1">
                  GP Calculator (per unit basis)
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">GP @ Min Selling</span>
                  <span className={gpColor(min, cost)}>{gp(min, cost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">GP @ Suggested</span>
                  <span className={gpColor(sug, cost)}>{gp(sug, cost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cost / Carton ({upc} units)</span>
                  <span className="tabular-nums text-gray-700">RM {(cost * upc).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Min / Carton</span>
                  <span className="tabular-nums text-gray-700">RM {(min * upc).toFixed(2)}</span>
                </div>
                <div className="col-span-2 flex justify-between">
                  <span className="text-gray-500">Suggested / Carton</span>
                  <span className="tabular-nums text-gray-700">RM {(sug * upc).toFixed(2)}</span>
                </div>
              </div>
            );
          })()}

          {/* Units per carton + Description */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Units Per Carton
              </label>
              <input
                type="number" min="1" step="1"
                value={base.units_per_carton}
                onChange={setBaseField("units_per_carton")}
                placeholder="1"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
                Description
              </label>
              <input
                type="text"
                value={base.description}
                onChange={setBaseField("description")}
                placeholder="Optional notes…"
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* ── VARIANTS TABLE ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Variants / Sizes</h2>
              <p className="text-xs text-gray-500 mt-0.5">Add one row per size or specification. Leave price fields blank to inherit base values.</p>
            </div>
            <button
              type="button"
              onClick={applyQuickSizes}
              className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              ⚡ Quick-fill XS–XXL
            </button>
          </div>

          {/* Table header */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 uppercase tracking-wide">
                  <th className="text-left pb-2 pr-3 w-40">Label</th>
                  <th className="text-left pb-2 pr-3 w-24">Size Code</th>
                  <th className="text-left pb-2 pr-3 w-32">SKU Preview</th>
                  <th className="text-left pb-2 pr-3 w-24">Cost Override</th>
                  <th className="text-left pb-2 pr-3 w-24">Min Override</th>
                  <th className="text-left pb-2 pr-3 w-24">Sug Override</th>
                  <th className="text-left pb-2 pr-3 w-20">Units</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {variants.map((v, idx) => {
                  const sku = skuFor(base.baseSku, v.sizeCode);
                  return (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={v.label}
                          onChange={setVariantField(v.id, "label")}
                          placeholder="e.g. Small"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="text"
                          value={v.sizeCode}
                          onChange={setVariantField(v.id, "sizeCode")}
                          placeholder="S"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono uppercase"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`font-mono text-xs px-2 py-1 rounded ${sku ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-400"}`}>
                          {sku || "—"}
                        </span>
                      </td>
                      {(["costOverride","minOverride","sugOverride"] as const).map(field => (
                        <td key={field} className="py-2 pr-3">
                          <input
                            type="number" min="0" step="0.01"
                            value={v[field]}
                            onChange={setVariantField(v.id, field)}
                            placeholder="inherit"
                            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums"
                          />
                        </td>
                      ))}
                      <td className="py-2 pr-3">
                        <input
                          type="number" min="1" step="1"
                          value={v.unitsOverride}
                          onChange={setVariantField(v.id, "unitsOverride")}
                          placeholder={base.units_per_carton}
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums"
                        />
                      </td>
                      <td className="py-2">
                        {variants.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(v.id)}
                            className="text-red-400 hover:text-red-600 text-sm font-bold"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addRow}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            + Add variant
          </button>
        </div>

        {/* ── PREVIEW SUMMARY ───────────────────────────────────────────────── */}
        {preview.some(v => v.sku) && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">
              Preview — {preview.length} product(s) to create
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 uppercase tracking-wide border-b border-gray-200">
                    <th className="text-left pb-2 pr-4">SKU</th>
                    <th className="text-left pb-2 pr-4">Label</th>
                    <th className="text-right pb-2 pr-4">Cost/unit</th>
                    <th className="text-right pb-2 pr-4">Min/unit</th>
                    <th className="text-right pb-2 pr-4">Sug/unit</th>
                    <th className="text-right pb-2 pr-4">GP@Min</th>
                    <th className="text-right pb-2 pr-4">GP@Sug</th>
                    <th className="text-right pb-2 pr-4">Ctn</th>
                    <th className="text-right pb-2 pr-4">Cost/Ctn</th>
                    <th className="text-right pb-2">Sug/Ctn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.map(v => (
                    <tr key={v.id} className="hover:bg-white">
                      <td className="py-1.5 pr-4 font-mono bg-white border border-gray-200 rounded px-2 my-1 inline-block">{v.sku || "—"}</td>
                      <td className="py-1.5 pr-4 text-gray-600">{v.label || "—"}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">RM {v.cost.toFixed(2)}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">RM {v.minSell.toFixed(2)}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">RM {v.suggested.toFixed(2)}</td>
                      <td className={`py-1.5 pr-4 text-right ${gpColor(v.minSell, v.cost)}`}>{gp(v.minSell, v.cost)}</td>
                      <td className={`py-1.5 pr-4 text-right ${gpColor(v.suggested, v.cost)}`}>{gp(v.suggested, v.cost)}</td>
                      <td className="py-1.5 pr-4 text-right text-gray-400">{v.units}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-gray-600">RM {(v.cost * v.units).toFixed(2)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-600">RM {(v.suggested * v.units).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── PROGRESS ─────────────────────────────────────────────────────── */}
        {submitting && progress && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-medium text-blue-800 mb-2">
              Creating products… {progress.done} / {progress.total}
            </p>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* ── ACTIONS ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => list("products")}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                       rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? `Creating… ${progress?.done ?? 0}/${progress?.total ?? 0}` : `Create ${preview.length} Product${preview.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}
