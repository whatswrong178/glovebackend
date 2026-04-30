// ══════════════════════════════════════════════════════════════════════════════
// src/pages/products/import.tsx — AI Product Import (Gemini 1.5 Flash)
// MediGlove ERP · EPIC-03 / T-03.1
//
// Flow:
//   1. Drag-drop or click to upload supplier PDF/image
//   2. POST to Edge Function → Gemini extracts products → preview table
//   3. Admin edits cells inline (name, SKU, prices, category, supplier)
//   4. Check/uncheck rows to include
//   5. "Import Selected" → batch INSERT to Supabase products table
//
// Admin-only page.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback, useRef } from "react";
import { useCreateMany, useList, useNavigation, useGetIdentity } from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
import type { ExtractedProduct, ProductCategory } from "../../types/product";
import { CATEGORY_META, validatePriceOrder } from "../../types/product";
import type { Supplier } from "../../types/product";
import type { StaffRole } from "../../types/staff";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportRow = ExtractedProduct & { _rowError?: string };

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; fileName: string }
  | { phase: "done"; rows: ImportRow[]; rawText: string; fileName: string }
  | { phase: "error"; message: string };

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  const map = {
    high:   "bg-emerald-100 text-emerald-700",
    medium: "bg-amber-100 text-amber-700",
    low:    "bg-red-100 text-red-600",
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${map[level]}`}>
      {level}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProductImportPage() {
  const { list }   = useNavigation();
  const supabase   = supabaseClient;
  const { data: identity } = useGetIdentity<{ id: string; role: StaffRole }>();
  const isAdmin = identity?.role === "Admin";

  const { mutate: createMany, isLoading: isSaving } = useCreateMany();

  const { data: suppliersData } = useList<Supplier>({
    resource:   "suppliers",
    pagination: { current: 1, pageSize: 200 },
    sorters:    [{ field: "name", order: "asc" }],
    meta:       { select: "id,name" },
    filters:    [{ field: "name", operator: "ne", value: "[Unknown Supplier]" }],
  });
  const suppliers = suppliersData?.data ?? [];

  const [state,          setState]          = useState<UploadState>({ phase: "idle" });
  const [defaultSupplier, setDefaultSupplier] = useState("");
  const [defaultCategory, setDefaultCategory] = useState<ProductCategory>("A");
  const [isDragging,     setIsDragging]     = useState(false);
  const [importSuccess,  setImportSuccess]  = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File processing ─────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|jpg|jpeg|png|webp|heic)$/i)) {
      setState({ phase: "error", message: "Unsupported file type. Upload PDF, JPEG, PNG, or WEBP." });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setState({ phase: "error", message: "File too large (max 20 MB)." });
      return;
    }

    setState({ phase: "uploading", fileName: file.name });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const formData = new FormData();
      formData.append("file", file);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/ai-product-import`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body:    formData,
      });

      const json = await res.json() as {
        products: ExtractedProduct[];
        rawText:  string;
        error?:   string;
      };

      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

      // Enrich rows with defaults
      const rows: ImportRow[] = (json.products ?? []).map((p) => ({
        ...p,
        selected:    true,
        category:    defaultCategory,
        supplier_id: defaultSupplier,
      }));

      setState({ phase: "done", rows, rawText: json.rawText, fileName: file.name });
    } catch (err) {
      setState({ phase: "error", message: (err as Error).message });
    }
  }, [supabase, defaultCategory, defaultSupplier]);

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  // ── Row editing ─────────────────────────────────────────────────────────────

  const updateRow = (idx: number, patch: Partial<ImportRow>) => {
    if (state.phase !== "done") return;
    const rows = state.rows.map((r, i) => i === idx ? { ...r, ...patch, _rowError: undefined } : r);
    setState({ ...state, rows });
  };

  const toggleRow = (idx: number) => {
    if (state.phase !== "done") return;
    updateRow(idx, { selected: !state.rows[idx].selected });
  };

  const toggleAll = () => {
    if (state.phase !== "done") return;
    const allSelected = state.rows.every((r) => r.selected);
    const rows = state.rows.map((r) => ({ ...r, selected: !allSelected }));
    setState({ ...state, rows });
  };

  // ── Apply defaults to all rows ───────────────────────────────────────────────

  const applyDefaults = () => {
    if (state.phase !== "done") return;
    const rows = state.rows.map((r) => ({
      ...r,
      ...(defaultSupplier ? { supplier_id: defaultSupplier } : {}),
      category: defaultCategory,
    }));
    setState({ ...state, rows });
  };

  // ── Batch import ─────────────────────────────────────────────────────────────

  const handleImport = () => {
    if (state.phase !== "done") return;
    const selected = state.rows.filter((r) => r.selected);
    if (selected.length === 0) { alert("No rows selected."); return; }

    // Validate
    let hasErrors = false;
    const rows = state.rows.map((r) => {
      if (!r.selected) return r;
      const errs: string[] = [];
      if (!r.name.trim())       errs.push("name required");
      if (!r.sku.trim())        errs.push("SKU required");
      if (!r.supplier_id)       errs.push("supplier required");
      if (r.cost_price == null) errs.push("cost price required");
      if (r.min_selling_price == null) errs.push("min price required");
      if (r.suggested_price == null)   errs.push("suggested price required");
      if (
        r.cost_price != null &&
        r.min_selling_price != null &&
        r.suggested_price != null
      ) {
        const priceErr = validatePriceOrder({
          cost_price:        r.cost_price,
          min_selling_price: r.min_selling_price,
          suggested_price:   r.suggested_price,
        });
        if (priceErr) errs.push(priceErr);
      }
      if (errs.length > 0) { hasErrors = true; return { ...r, _rowError: errs.join("; ") }; }
      return { ...r, _rowError: undefined };
    });

    if (hasErrors) {
      setState({ ...state, rows });
      return;
    }

    const values = selected.map((r) => ({
      name:              r.name.trim(),
      sku:               r.sku.trim().toUpperCase(),
      supplier_id:       r.supplier_id,
      category:          r.category,
      cost_price:        r.cost_price,
      min_selling_price: r.min_selling_price ?? 0,
      suggested_price:   r.suggested_price ?? 0,
      description:       r.description.trim() || null,
    }));

    createMany(
      { resource: "products", values },
      {
        onSuccess: () => {
          setImportSuccess(selected.length);
          setState({ phase: "idle" });
        },
        onError: (err) => {
          setState({ ...state, phase: "error", message: String(err.message) } as UploadState);
        },
      }
    );
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-red-500">
        Admin access required.
      </div>
    );
  }

  const selectedCount = state.phase === "done" ? state.rows.filter((r) => r.selected).length : 0;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => list("products")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Products
          </button>
          <h1 className="text-xl font-bold text-gray-900">AI Product Import</h1>
          <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">
            Gemini 1.5 Flash
          </span>
        </div>
      </div>

      {/* Success banner */}
      {importSuccess != null && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700 flex items-center justify-between">
          <span>✅ Successfully imported {importSuccess} product{importSuccess !== 1 ? "s" : ""}.</span>
          <button onClick={() => setImportSuccess(null)} className="text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      )}

      {/* Step 1: Defaults + Upload */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Step 1 — Configure defaults, then upload document</h2>

        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Default Supplier
            </label>
            <select
              value={defaultSupplier}
              onChange={(e) => setDefaultSupplier(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
            >
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Default Category
            </label>
            <select
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value as ProductCategory)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
            >
              <option value="A">Category A — 20% commission</option>
              <option value="B">Category B — 15% commission</option>
            </select>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
                      ${isDragging
                        ? "border-violet-400 bg-violet-50"
                        : "border-gray-200 hover:border-violet-300 hover:bg-gray-50"}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
            onChange={onFileChange}
            className="hidden"
          />
          {state.phase === "uploading" ? (
            <div className="space-y-2">
              <div className="text-2xl animate-pulse">✨</div>
              <p className="text-sm font-medium text-violet-700">Analysing "{state.fileName}"…</p>
              <p className="text-xs text-gray-400">Gemini 1.5 Flash is extracting products</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-3xl">📄</div>
              <p className="text-sm font-medium text-gray-700">
                Drop supplier PDF or image here, or click to browse
              </p>
              <p className="text-xs text-gray-400">Supports: PDF, JPEG, PNG, WEBP, HEIC · Max 20 MB</p>
            </div>
          )}
        </div>

        {state.phase === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            ⚠️ {state.message}
          </div>
        )}
      </div>

      {/* Step 2: Review & Edit */}
      {state.phase === "done" && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">
                Step 2 — Review extracted products
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {state.rawText} · {selectedCount} of {state.rows.length} selected
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={applyDefaults}
                className="text-xs px-3 py-1.5 rounded border border-violet-200 text-violet-700
                           hover:bg-violet-50 transition-colors"
              >
                Apply Defaults to All
              </button>
              <button
                onClick={() => setState({ phase: "idle" })}
                className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600
                           hover:bg-gray-50 transition-colors"
              >
                ✕ Reset
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={state.rows.every((r) => r.selected)}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">AI</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Supplier</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Cat</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Cost (RM)</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Min (RM)</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-500 uppercase tracking-wide">Suggested (RM)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {state.rows.map((row, idx) => (
                  <React.Fragment key={idx}>
                    <tr className={`${row.selected ? "" : "opacity-40"} hover:bg-gray-50 transition-colors`}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={() => toggleRow(idx)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <ConfidenceBadge level={row.confidence} />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => updateRow(idx, { name: e.target.value })}
                          className="w-full min-w-[180px] border border-gray-200 rounded px-2 py-1
                                     focus:outline-none focus:ring-1 focus:ring-violet-400 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.sku}
                          onChange={(e) => updateRow(idx, { sku: e.target.value })}
                          className="w-full min-w-[100px] border border-gray-200 rounded px-2 py-1
                                     focus:outline-none focus:ring-1 focus:ring-violet-400 font-mono text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.supplier_id}
                          onChange={(e) => updateRow(idx, { supplier_id: e.target.value })}
                          className="w-full min-w-[140px] border border-gray-200 rounded px-2 py-1
                                     focus:outline-none focus:ring-1 focus:ring-violet-400 text-xs bg-white"
                        >
                          <option value="">Select…</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.category}
                          onChange={(e) => updateRow(idx, { category: e.target.value as ProductCategory })}
                          className="border border-gray-200 rounded px-2 py-1
                                     focus:outline-none focus:ring-1 focus:ring-violet-400 text-xs bg-white"
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.cost_price ?? ""}
                          onChange={(e) => updateRow(idx, { cost_price: e.target.value ? parseFloat(e.target.value) : null })}
                          className="w-24 border border-gray-200 rounded px-2 py-1 text-right
                                     focus:outline-none focus:ring-1 focus:ring-violet-400 tabular-nums text-xs"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.min_selling_price ?? ""}
                          onChange={(e) => updateRow(idx, { min_selling_price: e.target.value ? parseFloat(e.target.value) : null })}
                          className="w-24 border border-gray-200 rounded px-2 py-1 text-right
                                     focus:outline-none focus:ring-1 focus:ring-violet-400 tabular-nums text-xs"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.suggested_price ?? ""}
                          onChange={(e) => updateRow(idx, { suggested_price: e.target.value ? parseFloat(e.target.value) : null })}
                          className="w-24 border border-gray-200 rounded px-2 py-1 text-right
                                     focus:outline-none focus:ring-1 focus:ring-violet-400 tabular-nums text-xs"
                          placeholder="0.00"
                        />
                      </td>
                    </tr>
                    {row._rowError && (
                      <tr>
                        <td colSpan={9} className="px-3 py-1 bg-red-50 text-xs text-red-600">
                          ⚠️ Row {idx + 1}: {row._rowError}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Import action */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {selectedCount} product{selectedCount !== 1 ? "s" : ""} will be imported.
              {" "}All prices stored in RM.
            </p>
            <button
              onClick={handleImport}
              disabled={isSaving || selectedCount === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700
                         rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? "Importing…" : `Import ${selectedCount} Product${selectedCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
