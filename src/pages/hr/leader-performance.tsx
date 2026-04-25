// ══════════════════════════════════════════════════════════════════════════════
// src/pages/hr/leader-performance.tsx — Leader Monthly Performance Dashboard
// MediGlove ERP · EPIC-02 / T-02.2
//
// Admin workflow:
//   1. Select year + month
//   2. Optionally grant 35k exemptions to individual leaders BEFORE evaluation
//   3. Click "Run Evaluation" → calls fn_evaluate_leader_month()
//   4. Results table shows GMV, pass/fail, streak, bonus status
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useCustomMutation, useList, useGetIdentity } from "@refinedev/core";
import type { StaffRole } from "../../types/staff";

interface EvalRow {
  leader_id:         string;
  leader_name:       string;
  personal_gmv:      number;
  threshold_used:    number;
  passed:            boolean;
  consecutive_fails: number;
  bonus_stripped:    boolean;
}

interface LeaderOption {
  id:   string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const currentYear  = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

// ══════════════════════════════════════════════════════════════════════════════
export function LeaderPerformancePage() {
  const { data: identity } = useGetIdentity<{ role: StaffRole }>();
  const isAdmin = identity?.role === "Admin";

  const [year,          setYear]          = useState(currentYear);
  const [month,         setMonth]         = useState(currentMonth);
  const [evalResults,   setEvalResults]   = useState<EvalRow[] | null>(null);
  const [exemptLeader,  setExemptLeader]  = useState("");
  const [exemptMsg,     setExemptMsg]     = useState<string | null>(null);

  const { mutate: runEval, isLoading: isEvaluating }   = useCustomMutation<EvalRow[]>();
  const { mutate: grantExempt, isLoading: isExempting } = useCustomMutation();

  // Fetch active leaders for the exemption dropdown
  const { data: leadersData } = useList<LeaderOption>({
    resource:   "staff",
    filters:    [
      { field: "role",   operator: "eq", value: "Leader" },
      { field: "status", operator: "eq", value: "Active" },
    ],
    sorters:    [{ field: "name", order: "asc" }],
    pagination: { mode: "off" },
    meta:       { select: "id,name" },
  });
  const leaders = leadersData?.data ?? [];

  // ── Run monthly evaluation ─────────────────────────────────────────────────
  const handleEvaluate = () => {
    runEval(
      {
        url:    "/rest/v1/rpc/fn_evaluate_leader_month",
        method: "post",
        values: { p_year: year, p_month: month },
      },
      {
        onSuccess: (data) => setEvalResults((data as unknown as { data: EvalRow[] }).data ?? []),
        onError:   (err)  => alert(`Evaluation failed: ${JSON.stringify(err)}`),
      }
    );
  };

  // ── Grant exemption ────────────────────────────────────────────────────────
  const handleGrantExemption = () => {
    if (!exemptLeader) return;
    grantExempt(
      {
        url:    "/rest/v1/rpc/fn_grant_leader_exemption",
        method: "post",
        values: { p_leader_id: exemptLeader, p_year: year, p_month: month },
      },
      {
        onSuccess: (data) => {
          const d = (data as unknown as { data: { leader_name: string; threshold: number } }).data;
          setExemptMsg(
            `✅ Exemption granted to ${d?.leader_name} — threshold set to ${fmt(d?.threshold ?? 35000)}`
          );
          setExemptLeader("");
        },
        onError: (err) => setExemptMsg(`❌ Failed: ${JSON.stringify(err)}`),
      }
    );
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-red-500">
        Access denied — Admin only.
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Leader Performance Evaluation</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Monthly 50k performance gate · 2 consecutive fails → bonus stripped
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide border-b border-gray-100 pb-2">
          Evaluation Period
        </h2>

        <div className="flex flex-wrap gap-3 items-end">
          {/* Year */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Month */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Month</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          {/* Run button */}
          <button
            onClick={handleEvaluate}
            disabled={isEvaluating}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {isEvaluating ? "Evaluating…" : "▶ Run Evaluation"}
          </button>
        </div>

        {/* Exemption panel */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Grant 35k Exemption (grant BEFORE running evaluation)
          </p>
          <div className="flex gap-2 items-center">
            <select
              value={exemptLeader}
              onChange={(e) => setExemptLeader(e.target.value)}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="">— Select leader to exempt —</option>
              {leaders.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <button
              onClick={handleGrantExemption}
              disabled={isExempting || !exemptLeader}
              className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200
                         rounded-lg hover:bg-amber-100 disabled:opacity-40 transition-colors"
            >
              {isExempting ? "Granting…" : "Grant Exemption"}
            </button>
          </div>
          {exemptMsg && (
            <p className="text-xs mt-2 text-gray-600">{exemptMsg}</p>
          )}
        </div>
      </div>

      {/* Results */}
      {evalResults !== null && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">
              Results — {MONTHS[month - 1]} {year}
            </p>
            <span className="text-xs text-gray-400">{evalResults.length} leaders evaluated</span>
          </div>

          {evalResults.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400">
              No active Leaders found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Leader</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Personal GMV</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Threshold</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Result</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Streak</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Bonus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {evalResults.map((row) => (
                    <tr key={row.leader_id} className={`${!row.passed ? "bg-red-50/30" : ""}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{row.leader_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {fmt(row.personal_gmv)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500 text-xs">
                        {fmt(row.threshold_used)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium
                          ${row.passed
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-700"}`}>
                          {row.passed ? "✓ PASS" : "✗ FAIL"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-bold
                          ${row.consecutive_fails >= 2
                            ? "text-red-600"
                            : row.consecutive_fails === 1
                            ? "text-amber-600"
                            : "text-gray-400"}`}>
                          {row.consecutive_fails === 0 ? "—" : `${row.consecutive_fails}×`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.bonus_stripped ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                            Stripped
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                            Active
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="text-xs text-gray-400 space-y-1">
        <p>• Standard threshold: RM 50,000 personal GMV per month</p>
        <p>• Exempted threshold: RM 35,000 (Admin approval required before evaluation)</p>
        <p>• 2× consecutive fails → 1% management bonus + 0.5% spinoff right stripped automatically</p>
        <p>• Passing in any subsequent month resets streak and restores bonuses</p>
      </div>
    </div>
  );
}
