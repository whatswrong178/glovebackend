// ══════════════════════════════════════════════════════════════════════════════
// src/pages/clients/list.tsx — Client Directory
// MediGlove ERP · EPIC-04 / T-04.1 / T-04.5
//
// Tabs:
//   "My Clients"   — Sales/Leader: owner_id = self; Admin/HR: all active clients
//   "Public Pool"  — is_orphan=TRUE, claimable by all authenticated staff
//
// Admin: sees all columns, CSV export button, Delete action.
// Sales/Leader: sees own clients only in My Clients tab.
// HR: reads all but cannot delete.
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { useList, useDelete, useGetIdentity, useNavigation } from "@refinedev/core";
import type { CrudFilters } from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
import type { Client } from "../../types/client";
import { NEGLECT_COLOR, NEGLECT_LABEL } from "../../types/client";
import type { StaffRole } from "../../types/staff";

type Tab = "mine" | "pool";

function NeglectBadge({ index }: { index: number }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${NEGLECT_COLOR[index]}`}>
      {index} · {NEGLECT_LABEL[index]}
    </span>
  );
}

export function ClientListPage() {
  const { push } = useNavigation();
  const supabase = supabaseClient;
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();

  const isAdmin     = identity?.role === "Admin";
  const isHR        = identity?.role === "HR";
  const canSeeAll   = isAdmin || isHR;
  const canDelete   = isAdmin;
  const canExportCSV = isAdmin;

  const [tab,    setTab]    = useState<Tab>("mine");
  const [search, setSearch] = useState("");
  const [page,   setPage]   = useState(1);
  const PAGE_SIZE = 25;

  const { mutate: deleteClient } = useDelete();

  // ── My Clients / All Active ──────────────────────────────────────────────
  const myFilters: CrudFilters = [
    { field: "is_orphan", operator: "eq", value: false },
  ];
  if (!canSeeAll && identity?.id) {
    myFilters.push({ field: "owner_id", operator: "eq", value: identity.id });
  }
  if (search.trim()) {
    myFilters.push({
      operator: "or",
      value: [
        { field: "name",          operator: "contains", value: search.trim() },
        { field: "ssm_no",        operator: "contains", value: search.trim() },
        { field: "contact_person",operator: "contains", value: search.trim() },
      ],
    });
  }

  const { data: mineData, isLoading: mineLoading, refetch: refetchMine } = useList<Client & { owner?: { name: string } }>({
    resource:   "clients",
    pagination: { current: tab === "mine" ? page : 1, pageSize: PAGE_SIZE },
    sorters:    [{ field: "created_at", order: "desc" }],
    filters:    myFilters,
    meta: {
      select: "id,name,ssm_no,region,credit_terms,neglect_index,is_orphan,contact_person,contact_phone,created_at,owner:staff!owner_id(name)",
    },
    queryOptions: { enabled: tab === "mine" },
  });

  // ── Public Pool ──────────────────────────────────────────────────────────
  const poolFilters: CrudFilters = [
    { field: "is_orphan", operator: "eq", value: true },
  ];
  if (search.trim()) {
    poolFilters.push({
      operator: "or",
      value: [
        { field: "name",   operator: "contains", value: search.trim() },
        { field: "ssm_no", operator: "contains", value: search.trim() },
      ],
    });
  }

  const { data: poolData, isLoading: poolLoading, refetch: refetchPool } = useList<Client>({
    resource:   "clients",
    pagination: { current: tab === "pool" ? page : 1, pageSize: PAGE_SIZE },
    sorters:    [{ field: "created_at", order: "desc" }],
    filters:    poolFilters,
    meta: {
      select: "id,name,ssm_no,region,credit_terms,neglect_index,contact_person,contact_phone,created_at",
    },
    queryOptions: { enabled: tab === "pool" },
  });

  const activeData   = tab === "mine" ? mineData  : poolData;
  const activeLoading = tab === "mine" ? mineLoading : poolLoading;
  const clients = (activeData?.data ?? []) as (Client & { owner?: { name: string } })[];
  const total   = activeData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete client "${name}"?\n\nThis will permanently remove the client record.`)) return;

    // ── Pre-flight: block if invoices or DOs reference this client ────────────
    const [{ count: invCount }, { count: doCount }] = await Promise.all([
      supabase.from("invoices").select("id", { count: "exact", head: true }).eq("client_id", id),
      supabase.from("delivery_orders").select("id", { count: "exact", head: true }).eq("client_id", id),
    ]);

    if ((invCount ?? 0) > 0 || (doCount ?? 0) > 0) {
      const parts: string[] = [];
      if ((invCount ?? 0) > 0) parts.push(`${invCount} invoice${invCount !== 1 ? "s" : ""}`);
      if ((doCount  ?? 0) > 0) parts.push(`${doCount} delivery order${doCount !== 1 ? "s" : ""}`);
      alert(
        `Cannot delete "${name}".\n\n` +
        `This client has ${parts.join(" and ")} on record.\n\n` +
        `Archive or reassign those records first.`
      );
      return;
    }

    deleteClient(
      { resource: "clients", id },
      {
        onSuccess: () => { refetchMine(); refetchPool(); },
        onError:   (err) => alert((err as unknown as Error).message ?? "Delete failed. The client may have linked records."),
      }
    );
  };

  const handleCSVExport = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const supabaseUrl = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl
                     ?? import.meta.env.VITE_SUPABASE_URL;
    const url = `${supabaseUrl}/rest/v1/clients?select=id,name,ssm_no,region,credit_terms,neglect_index,is_orphan,contact_person,contact_email,contact_phone,created_at&order=name`;
    const res = await fetch(url, {
      headers: {
        "apikey":        import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.access_token}`,
        "Accept":        "text/csv",
      },
    });
    if (!res.ok) { alert("CSV export failed"); return; }
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `clients_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} record{total !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          {canExportCSV && (
            <button
              onClick={handleCSVExport}
              className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg
                         text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ↓ CSV
            </button>
          )}
          <button
            onClick={() => push("/clients/create")}
            className="px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg
                       hover:bg-blue-700 transition-colors"
          >
            + Add Client
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["mine", "pool"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "mine"
              ? (canSeeAll ? "All Clients" : "My Clients")
              : "🏊 Public Pool"}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search name, SSM, contact…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Pool notice */}
      {tab === "pool" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          🏊 <strong>Public Pool</strong> — These clients have no active owner. Any Sales or Leader can claim ownership by raising the first invoice.
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {activeLoading ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
        ) : clients.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            {tab === "pool" ? "No orphan clients — all clients have active owners." : "No clients found."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SSM No.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Region</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Credit</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Neglect</th>
                  {canSeeAll && tab === "mine" && (
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Owner</th>
                  )}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                  {canDelete && (
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => push(`/clients/${c.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 font-mono text-gray-500 text-xs">{c.ssm_no ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        c.region === "West Malaysia" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                      }`}>
                        {c.region === "West Malaysia" ? "WM" : "EM"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.credit_terms}</td>
                    <td className="px-4 py-3">
                      <NeglectBadge index={c.neglect_index} />
                    </td>
                    {canSeeAll && tab === "mine" && (
                      <td className="px-4 py-3 text-gray-600">
                        {(c as Client & { owner?: { name: string } }).owner?.name ?? "—"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {c.contact_person ?? "—"}
                      {c.contact_phone ? ` · ${c.contact_phone}` : ""}
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleDelete(c.id, c.name)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
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
