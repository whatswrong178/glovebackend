/**
 * DashboardPage — Overview KPI tiles
 * Skeleton-first: shows pulse loaders while data fetches.
 * Actual charts (Recharts PnL compass, leaderboard) implemented in EPIC-08.
 */
import React from "react";
import { useGetIdentity } from "@refinedev/core";

interface StaffIdentity { name: string; role: string; }

function KpiCard({
  label, value, sub, color,
}: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={`rounded-xl border-l-4 bg-white shadow-sm p-5 ${color}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { data: identity, isLoading } = useGetIdentity<StaffIdentity>();

  if (isLoading) {
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
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          Good {getGreeting()}, {identity?.name?.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Here's your {new Date().toLocaleDateString("en-MY", { weekday:"long", month:"long", day:"numeric" })} overview.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Est. Commission"
          value="RM —"
          sub="Pending invoice payments"
          color="border-warning"
        />
        <KpiCard
          label="Actual Commission"
          value="RM —"
          sub="Confirmed receipts this month"
          color="border-success"
        />
        <KpiCard
          label="Active Invoices"
          value="—"
          sub="Awaiting payment"
          color="border-brand-500"
        />
        <KpiCard
          label="Public Pool"
          value="—"
          sub="Orphan clients available"
          color="border-danger"
        />
      </div>

      {/* Placeholder for charts (EPIC-08) */}
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
