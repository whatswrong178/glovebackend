/**
 * DashboardPage — real-time KPI tiles via get_dashboard_kpis() RPC
 * MediGlove ERP · EPIC-08
 */
import React, { useEffect, useState, useCallback } from "react";
import { useGetIdentity } from "@refinedev/core";
import { useNavigate } from "react-router-dom";
import { supabaseClient } from "../../supabaseClient";

interface StaffIdentity { name: string; role: string; }

interface DashboardKpis {
  active_invoices:   number;
  est_commission:    number;
  actual_commission: number;
  public_pool:       number;
}

function KpiCard({
  label, value, sub, color, loading,
}: {
  label:   string;
  value:   string;
  sub?:    string;
  color:   string;
  loading: boolean;
}) {
  return (
    <div className={`rounded-xl border-l-4 bg-white shadow-sm p-5 ${color}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
      {loading ? (
        <div className="skeleton h-8 w-28 mt-1 rounded" />
      ) : (
        <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      )}
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

const fmt = (n: number) =>
  n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: identity, isLoading: idLoading } = useGetIdentity<StaffIdentity>();
  const [kpis,    setKpis]    = useState<DashboardKpis | null>(null);
  const [kpiLoad, setKpiLoad] = useState(true);

  const fetchKpis = useCallback(async () => {
    setKpiLoad(true);
    try {
      const { data, error } = await supabaseClient.rpc("get_dashboard_kpis");
      if (!error && data) setKpis(data as DashboardKpis);
    } finally {
      setKpiLoad(false);
    }
  }, []);

  useEffect(() => {
    fetchKpis();
    // Auto-refresh every 60s
    const interval = setInterval(fetchKpis, 60_000);
    return () => clearInterval(interval);
  }, [fetchKpis]);

  if (idLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton rounded-xl h-28" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            Good {getGreeting()}, {identity?.name?.split(" ")[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Here's your{" "}
            {new Date().toLocaleDateString("en-MY", {
              weekday: "long",
              month:   "long",
              day:     "numeric",
            })}{" "}
            overview.
          </p>
        </div>
        <button
          onClick={fetchKpis}
          disabled={kpiLoad}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40"
          title="Refresh KPIs"
        >
          ↻ Refresh
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Est. Commission"
          value={kpis ? `RM ${fmt(kpis.est_commission)}` : "RM —"}
          sub="Pending invoice payments"
          color="border-warning"
          loading={kpiLoad}
        />
        <KpiCard
          label="Actual Commission"
          value={kpis ? `RM ${fmt(kpis.actual_commission)}` : "RM —"}
          sub="Confirmed receipts this month"
          color="border-success"
          loading={kpiLoad}
        />
        <KpiCard
          label="Active Invoices"
          value={kpis ? String(kpis.active_invoices) : "—"}
          sub="Awaiting payment"
          color="border-brand-500"
          loading={kpiLoad}
        />
        <KpiCard
          label="Public Pool"
          value={kpis ? String(kpis.public_pool) : "—"}
          sub="Orphan clients available"
          color="border-danger"
          loading={kpiLoad}
        />
      </div>

      {/* Commission policy note */}
      <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-500">
        <span className="shrink-0">🔒</span>
        <span>
          <strong>见款发佣则 (Paid-then-commission)</strong>: Estimated commissions are display-only.
          Actual payouts are computed exclusively from invoices with{" "}
          <strong>status = Paid</strong>. The system code-level blocks advance salary against unpaid AR.
        </span>
      </div>

      {/* ── Needs Assessment CTA ────────────────────────────────────── */}
      <div
        onClick={() => navigate("/needs-assessment")}
        className="cursor-pointer group bg-gradient-to-r from-gray-900 to-gray-800
                   rounded-xl p-5 flex items-center gap-5 hover:from-gray-800 hover:to-gray-700
                   transition-all shadow-sm"
      >
        <div className="flex-shrink-0 w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center text-2xl">
          📋
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">客户需求挖取问卷</p>
          <p className="text-gray-400 text-xs mt-0.5">
            填写拜访问卷 → 自动创建客户档案 → 生成热度评分 (Hot / Warm / Cold)
          </p>
        </div>
        <span className="text-gray-400 group-hover:text-white text-lg transition-colors flex-shrink-0">
          →
        </span>
      </div>

      {/* Placeholder charts (EPIC-08) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Monthly GMV Trend</p>
          <div className="skeleton h-48 rounded-lg" />
          <p className="text-xs text-gray-400 mt-2 text-center">
            Chart renders after connecting to live data (EPIC-08)
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Top Sales Leaderboard</p>
          <div className="skeleton h-48 rounded-lg" />
          <p className="text-xs text-gray-400 mt-2 text-center">
            Leaderboard renders after connecting to live data (EPIC-08)
          </p>
        </div>
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
