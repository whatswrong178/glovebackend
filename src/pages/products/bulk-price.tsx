// ══════════════════════════════════════════════════════════════════════════════
// src/pages/products/bulk-price.tsx — Bulk Price Editor
// MediGlove ERP · EPIC-03 (Admin only)
//
// Shows every product in an editable spreadsheet-style table.
// Columns: SKU | Product Name | Cost/unit | Min Sell | Sug Sell | GP@Min | GP@Sug
// Dirty rows are highlighted. Save button batch-upserts only changed rows.
// Live GP calculation (colour-coded: red <20%, amber 20-35%, green ≥35%).
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from "react";
import { useNavigation } from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PriceRow {
  id:                 string;
  sku:                string;
  name:               string;
  category:           "A" | "B";
  cost_price:         string;   // editable string (avoids parseFloat on every keystroke)
  min_selling_price:  string;
  suggested_price:    string;
  // snapshot of values at load time — used to detect dirty rows
  _orig_cost:         number;
  _orig_min:          number;
  _orig_sug:          number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const n = (v: string) => parseFloat(v) || 0;

function gp(sell: number, cost: number): number {
  if (sell <= 0) return 0;
  return ((sell - cost) / sell) * 100;
}

function GpBadge({ value }: { value: number }) {
  const color =
    value < 0    ? "bg-red-100 text-red-700" :
    value < 20   ? "bg-red-50 text-red-600" :
    value < 35   ? "bg-amber-50 text-amber-700" :
                   "bg-emerald-50 text-emerald-700";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold tabular-nums ${color}`}>
      {value >= 0 ? value.toFixed(1) : "—"}%
    </span>
  );
}

function isDirty(row: PriceRow): boolean {
  return (
    n(row.cost_price)        !== row._orig_cost ||
    n(row.min_selling_price) !== row._orig_min  ||
    n(row.suggested_price)   !== row._orig_sug
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function BulkPricePage() {
  const { push } = useNavigation();

  const [rows,    setRows]    = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [search,  setSearch]  = useState("");
  const [catFilter, setCatFilter] = useState<"" | "A" | "B">("");
  const [error,   setError]   = useState("");
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // ── Load all products ──────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    supabaseClient
      .from("products")
      .select("id,name,sku,category,cost_price,min_selling_price,suggested_price")
      .order("name", { ascending: true })
      .limit(1000)
      .then(({ data, error: err }) => {
        if (err) { setError(err.message); setLoading(false); return; }
        setRows(
          ((data ?? []) as {
            id: string; name: string; sku: string; category: "A" | "B";
            cost_price: number; min_selling_price: number; suggested_price: number;
          }[]).map((p) => ({
            id:                p.id,
            sku:               p.sku,
            name:              p.name,
            category:          p.category,
            cost_price:        String(p.cost_price ?? ""),
            min_selling_price: String(p.min_selling_price ?? ""),
            suggested_price:   String(p.suggested_price ?? ""),
            _orig_cost:        p.cost_price ?? 0,
            _orig_min:         p.min_selling_price ?? 0,
            _orig_sug:         p.suggested_price ?? 0,
          }))
        );
        setLoading(false);
      });
  }, []);

  // ── Cell update ────────────────────────────────────────────────────────────
  const updateCell = useCallback(
    (id: string, field: "cost_price" | "min_selling_price" | "suggested_price", val: string) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: val } : r))
      );
      setSavedCount(null);
      setError("");
    },
    []
  );

  // ── Save only dirty rows ───────────────────────────────────────────────────
  const handleSave = async () => {
    const dirty = rows.filter(isDirty);
    if (dirty.length === 0) return;

    // Validate: min must be ≥ cost, suggested must be ≥ min
    for (const r of dirty) {
      const cost = n(r.cost_price);
      const min  = n(r.min_selling_price);
      const sug  = n(r.suggested_price);
      if (min < cost) {
        setError(`${r.sku}: Min selling price (${min}) cannot be less than cost (${cost}).`);
        return;
      }
      if (sug < min) {
        setError(`${r.sku}: Suggested price (${sug}) cannot be less than min selling price (${min}).`);
        return;
      }
    }

    setSaving(true);
    setError("");

    try {
      // Batch update — one request per dirty row (Supabase doesn't support batch updates in one call cleanly)
      await Promise.all(
        dirty.map((r) =>
          supabaseClient
            .from("products")
            .update({
              cost_price:        n(r.cost_price),
              min_selling_price: n(r.min_selling_price),
              suggested_price:   n(r.suggested_price),
            })
            .eq("id", r.id)
            .throwOnError()
        )
      );

      // Commit snapshots — mark rows as clean
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          _orig_cost: n(r.cost_price),
          _orig_min:  n(r.min_selling_price),
          _orig_sug:  n(r.suggested_price),
        }))
      );
      setSavedCount(dirty.length);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  // ── Reset dirty rows ───────────────────────────────────────────────────────
  const handleReset = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        cost_price:        String(r._orig_cost),
        min_selling_price: String(r._orig_min),
        suggested_price:   String(r._orig_sug),
      }))
    );
    setSavedCount(null);
    setError("");
  };

  // ── Filtered view ──────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (catFilter && r.category !== catFilter) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false;
    return true;
  });

  const dirtyCount  = rows.filter(isDirty).length;
  const totalSaving = dirtyCount;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => push("/products")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Products
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Bulk Price Editor</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {rows.length} products · {dirtyCount > 0 ? (
                <span className="text-amber-600 font-medium">{dirtyCount} unsaved change{dirtyCount !== 1 ? "s" : ""}</span>
              ) : (
                <span className="text-gray-400">no changes</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {dirtyCount > 0 && (
            <button
              onClick={handleReset}
              className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Reset
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || dirtyCount === 0}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving
              ? `Saving ${totalSaving}…`
              : `Save ${dirtyCount > 0 ? `${dirtyCount} ` : ""}Change${dirtyCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>

      {/* Save confirmation */}
      {savedCount !== null && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
          ✓ <span className="font-medium">{savedCount} product{savedCount !== 1 ? "s" : ""} updated successfully.</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        ℹ️ Prices are <strong>per unit</strong>. Edit inline — rows highlighted in amber have unsaved changes.
        &nbsp;Rules enforced: Min ≥ Cost, Suggested ≥ Min.
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        />
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value as "" | "A" | "B")}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All Categories</option>
          <option value="A">Category A (Gloves)</option>
          <option value="B">Category B (Others)</option>
        </select>
        <span className="text-xs text-gray-400">{visible.length} shown</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            Loading products…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            No products match your filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">SKU</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Product Name</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">Cat</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Cost / unit</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Min Sell</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">GP@Min</th>
                  <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">Sug Sell</th>
                  <th className="text-center px-2 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">GP@Sug</th>
                  <th className="w-6 px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map((row) => {
                  const dirty      = isDirty(row);
                  const cost       = n(row.cost_price);
                  const minSell    = n(row.min_selling_price);
                  const sugSell    = n(row.suggested_price);
                  const gpMin      = gp(minSell, cost);
                  const gpSug      = gp(sugSell, cost);
                  const minBelowCost = minSell < cost && minSell > 0;
                  const sugBelowMin  = sugSell < minSell && sugSell > 0;

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${dirty ? "bg-amber-50/60" : "hover:bg-gray-50"}`}
                    >
                      {/* SKU */}
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{row.sku}</td>

                      {/* Name */}
                      <td className="px-4 py-2 text-gray-800 font-medium text-sm">{row.name}</td>

                      {/* Category */}
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${
                          row.category === "A" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
                        }`}>
                          {row.category}
                        </span>
                      </td>

                      {/* Cost */}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-xs text-gray-400">RM</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.cost_price}
                            onChange={(e) => updateCell(row.id, "cost_price", e.target.value)}
                            className="w-24 text-right text-sm border border-gray-200 rounded-lg px-2 py-1
                                       focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums
                                       bg-white hover:border-gray-300 transition-colors"
                          />
                        </div>
                      </td>

                      {/* Min Sell */}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-xs text-gray-400">RM</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.min_selling_price}
                            onChange={(e) => updateCell(row.id, "min_selling_price", e.target.value)}
                            className={`w-24 text-right text-sm border rounded-lg px-2 py-1
                                        focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums
                                        bg-white hover:border-gray-300 transition-colors ${
                                          minBelowCost ? "border-red-400 bg-red-50" : "border-gray-200"
                                        }`}
                          />
                        </div>
                        {minBelowCost && (
                          <p className="text-xs text-red-500 text-right mt-0.5">Below cost!</p>
                        )}
                      </td>

                      {/* GP @ Min */}
                      <td className="px-2 py-2 text-center">
                        <GpBadge value={gpMin} />
                      </td>

                      {/* Suggested Sell */}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-xs text-gray-400">RM</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.suggested_price}
                            onChange={(e) => updateCell(row.id, "suggested_price", e.target.value)}
                            className={`w-24 text-right text-sm border rounded-lg px-2 py-1
                                        focus:outline-none focus:ring-2 focus:ring-blue-400 tabular-nums
                                        bg-white hover:border-gray-300 transition-colors ${
                                          sugBelowMin ? "border-red-400 bg-red-50" : "border-gray-200"
                                        }`}
                          />
                        </div>
                        {sugBelowMin && (
                          <p className="text-xs text-red-500 text-right mt-0.5">Below min!</p>
                        )}
                      </td>

                      {/* GP @ Sug */}
                      <td className="px-2 py-2 text-center">
                        <GpBadge value={gpSug} />
                      </td>

                      {/* Dirty indicator */}
                      <td className="px-2 py-2 text-center">
                        {dirty && (
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Unsaved change" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sticky save bar (appears when there are dirty rows) */}
      {dirtyCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40
                        bg-gray-900 text-white rounded-2xl shadow-2xl px-6 py-3
                        flex items-center gap-4 text-sm">
          <span>
            <span className="font-semibold text-amber-400">{dirtyCount}</span> unsaved change{dirtyCount !== 1 ? "s" : ""}
          </span>
          <button
            onClick={handleReset}
            className="text-gray-400 hover:text-white transition-colors text-xs underline"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-blue-500 hover:bg-blue-400 rounded-lg font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Now"}
          </button>
        </div>
      )}
    </div>
  );
}
