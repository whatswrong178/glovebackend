// ══════════════════════════════════════════════════════════════════════════════
// src/pages/reports/index.tsx — Reports & Analytics
// MediGlove ERP · EPIC-08 / T-08.2, T-08.4, T-08.5
//
// Tabs:
//   1. AR Aging    — fn_ar_aging() RPC, Admin/HR
//   2. Org Chart   — fn_org_tree() RPC, Admin/HR
//   3. P&L         — fn_pl_summary() RPC, Admin only
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from "react";
import { useGetIdentity } from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
type SupabaseClientType = typeof supabaseClient;
import type { StaffRole } from "../../types/staff";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface ARInvoice {
  id:           string;
  invoice_no:   string;
  client_name:  string;
  sales_name:   string;
  total_amount: number;
  created_at:   string;
  overdue_days: number;
}

interface ARBucket {
  bucket:       string;
  count:        number;
  total_amount: number;
  invoices:     ARInvoice[];
}

interface ARAgingResult {
  generated_at: string;
  buckets:      ARBucket[];
}

interface OrgNode {
  id:                      string;
  full_name:               string;
  role:                    string;
  reports_to:              string | null;
  leader_frozen:           boolean;
  consecutive_fail_months: number;
  personal_net_revenue:    number;
  leader_status:           "healthy" | "warning" | "danger" | "frozen" | "n/a";
  depth:                   number;
}

interface OrgTreeResult {
  generated_at: string;
  year:         number;
  month:        number;
  nodes:        OrgNode[];
}

interface TopSku {
  sku:     string;
  name:    string;
  qty:     number;
  revenue: number;
  cogs:    number;
}

interface SupplierSpend {
  supplier: string;
  spend:    number;
  boxes:    number;
}

interface PLResult {
  year:               number;
  month:              number;
  gross_revenue:      number;
  total_cogs:         number;
  gross_profit:       number;
  approx_payout:      number;
  net_company_profit: number;
  gross_margin_pct:   number;
  top_skus:           TopSku[];
  supplier_spend:     SupplierSpend[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function rm(n: number) {
  return `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const BUCKET_COLORS: Record<string, string> = {
  "Current":             "bg-emerald-100 text-emerald-800",
  "1-30 Days Overdue":   "bg-yellow-100 text-yellow-800",
  "31-60 Days Overdue":  "bg-orange-100 text-orange-800",
  "61-90 Days Overdue":  "bg-red-100 text-red-800",
  "90+ Days Overdue":    "bg-red-200 text-red-900",
};

const BUCKET_BAR: Record<string, string> = {
  "Current":             "bg-emerald-500",
  "1-30 Days Overdue":   "bg-yellow-400",
  "31-60 Days Overdue":  "bg-orange-500",
  "61-90 Days Overdue":  "bg-red-500",
  "90+ Days Overdue":    "bg-red-700",
};

// ─────────────────────────────────────────────────────────────────────────────
// AR Aging Tab
// ─────────────────────────────────────────────────────────────────────────────
function ARAgingTab({ supabase }: { supabase: SupabaseClientType }) {
  const [data,       setData]       = useState<ARAgingResult | null>(null);
  const [loading,    setLoading]    = useState(true);   // true to prevent blank flash on mount
  const [error,      setError]      = useState("");
  const [expanded,   setExpanded]   = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result, error: rpcErr } = await supabase.rpc("fn_ar_aging");
      if (rpcErr) throw rpcErr;
      setData(result as ARAgingResult);
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? "Failed to load AR aging.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const totalOutstanding = (data?.buckets ?? []).reduce((s, b) => s + b.total_amount, 0);
  const overdueTotal     = (data?.buckets ?? [])
    .filter(b => b.bucket !== "Current")
    .reduce((s, b) => s + b.total_amount, 0);

  if (loading) return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading AR Aging…</div>;
  if (error)   return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
      ⚠ {error}
      <button onClick={load} className="ml-4 underline text-red-600">Retry</button>
    </div>
  );
  if (!data)   return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400">
      No AR aging data available yet.
    </div>
  );

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Outstanding</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{rm(totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Overdue Amount</p>
          <p className="text-xl font-bold text-red-600 mt-1">{rm(overdueTotal)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total Invoices</p>
          <p className="text-xl font-bold text-gray-900 mt-1">
            {(data.buckets ?? []).reduce((s, b) => s + b.count, 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Generated</p>
          <p className="text-sm font-medium text-gray-700 mt-1">
            {new Date(data.generated_at).toLocaleString("en-MY")}
          </p>
        </div>
      </div>

      {/* Bucket cards */}
      {(data.buckets ?? []).map((bucket) => {
        const pct  = totalOutstanding > 0 ? (bucket.total_amount / totalOutstanding * 100) : 0;
        const open = expanded[bucket.bucket] ?? false;
        return (
          <div key={bucket.bucket} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <button
              onClick={() => setExpanded(prev => ({ ...prev, [bucket.bucket]: !open }))}
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${BUCKET_COLORS[bucket.bucket] ?? "bg-gray-100 text-gray-600"}`}>
                  {bucket.bucket}
                </span>
                <span className="text-sm text-gray-600">{bucket.count} invoice{bucket.count !== 1 ? "s" : ""}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-bold text-gray-900">{rm(bucket.total_amount)}</span>
                <span className="text-xs text-gray-400">{pct.toFixed(1)}%</span>
                <span className="text-gray-400">{open ? "▲" : "▼"}</span>
              </div>
            </button>

            {/* Progress bar */}
            <div className="h-1 bg-gray-100">
              <div
                className={`h-1 ${BUCKET_BAR[bucket.bucket] ?? "bg-gray-400"} transition-all`}
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Expanded invoice list */}
            {open && (
              <div className="overflow-x-auto border-t border-gray-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Invoice No.</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Client</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Sales</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Overdue Days</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {bucket.invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{inv.invoice_no}</td>
                        <td className="px-4 py-2 text-gray-700">{inv.client_name}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{inv.sales_name}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums">{rm(inv.total_amount)}</td>
                        <td className="px-4 py-2 text-right">
                          {inv.overdue_days <= 0
                            ? <span className="text-xs text-emerald-600">{Math.abs(inv.overdue_days)}d left</span>
                            : <span className="text-xs text-red-600 font-medium">{inv.overdue_days}d overdue</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        🔒 见款发佣原则 (Paid-then-commission): Estimated commissions are display-only.
        Actual payouts are computed exclusively from invoices with <strong>status = Paid</strong>.
        The system code-level blocks advance salary against unpaid AR.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Org Chart Tab
// ─────────────────────────────────────────────────────────────────────────────
const LEADER_STATUS_STYLE: Record<string, { dot: string; label: string; badge: string }> = {
  "healthy": { dot: "bg-emerald-500", label: "On Track",   badge: "bg-emerald-50 border-emerald-200" },
  "warning": { dot: "bg-yellow-400",  label: "At Risk",    badge: "bg-yellow-50 border-yellow-200"   },
  "danger":  { dot: "bg-red-500",     label: "Below Target", badge: "bg-red-50 border-red-200"      },
  "frozen":  { dot: "bg-gray-500",    label: "Frozen 🔒",  badge: "bg-gray-50 border-gray-300"      },
  "n/a":     { dot: "bg-gray-300",    label: "",            badge: "bg-white border-gray-100"        },
};

function OrgNodeCard({ node, children }: { node: OrgNode; children?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const s = LEADER_STATUS_STYLE[node.leader_status] ?? LEADER_STATUS_STYLE["n/a"];

  return (
    <div className="flex flex-col items-center">
      <div className={`border rounded-xl px-4 py-3 shadow-sm w-52 ${s.badge} cursor-pointer`}
           onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2 mb-1">
          {node.leader_status !== "n/a" && (
            <span className={`w-2 h-2 rounded-full ${s.dot} flex-shrink-0`} />
          )}
          <span className="text-sm font-bold text-gray-900 truncate">{node.full_name}</span>
        </div>
        <div className="text-xs text-gray-500">{node.role}</div>
        {node.leader_status !== "n/a" && (
          <div className="mt-2 space-y-0.5">
            <div className="text-xs font-medium text-gray-700">
              RM {node.personal_net_revenue.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className={`text-xs ${s.dot === "bg-emerald-500" ? "text-emerald-600" : "text-red-600"}`}>
              {s.label}
              {node.consecutive_fail_months > 0 && ` (${node.consecutive_fail_months}× fail)`}
            </div>
          </div>
        )}
        {children && (
          <div className="text-xs text-gray-400 mt-1 text-right">{open ? "▲" : "▼"}</div>
        )}
      </div>

      {open && children && (
        <div className="flex flex-col items-center">
          <div className="w-px h-5 bg-gray-200" />
          <div className="flex gap-6 items-start">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

function buildTree(nodes: OrgNode[] | null | undefined, parentId: string | null): OrgNode[] {
  return (nodes ?? []).filter(n => n.reports_to === parentId);
}

function OrgTreeRender({ nodes, parentId }: { nodes: OrgNode[]; parentId: string | null }) {
  const children = buildTree(nodes, parentId);
  if (children.length === 0) return null;

  return (
    <>
      {children.map((node) => {
        const subtree = <OrgTreeRender nodes={nodes} parentId={node.id} />;
        const hasKids = buildTree(nodes, node.id).length > 0;
        return (
          <div key={node.id} className="flex flex-col items-center">
            <div className="w-px h-5 bg-gray-200" />
            <OrgNodeCard node={node}>
              {hasKids ? subtree : undefined}
            </OrgNodeCard>
          </div>
        );
      })}
    </>
  );
}

function OrgChartTab({ supabase }: { supabase: SupabaseClientType }) {
  const [data,    setData]    = useState<OrgTreeResult | null>(null);
  const [loading, setLoading] = useState(true);  // true to prevent blank flash on mount
  const [error,   setError]   = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result, error: rpcErr } = await supabase.rpc("fn_org_tree");
      if (rpcErr) throw rpcErr;
      setData(result as OrgTreeResult);
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? "Failed to load org tree.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading Org Chart…</div>;
  if (error)   return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
      ⚠ {error}
      <button onClick={load} className="ml-4 underline">Retry</button>
    </div>
  );
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400">
      No org chart data available yet.
    </div>
  );

  const roots = buildTree(data.nodes ?? [], null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6 text-xs">
        {Object.entries(LEADER_STATUS_STYLE).filter(([k]) => k !== "n/a").map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${v.dot}`} />
            <span className="text-gray-600">{v.label}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 overflow-x-auto">
        <div className="flex gap-10 items-start justify-center min-w-max">
          {roots.map((root) => (
            <OrgNodeCard key={root.id} node={root}>
              <OrgTreeRender nodes={data.nodes ?? []} parentId={root.id} />
            </OrgNodeCard>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400 text-right">
        {data.year}/{String(data.month).padStart(2, "0")} — {(data.nodes ?? []).length} active staff
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L Report Generator — formal print-to-PDF HTML
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function generatePLReport(data: PLResult, year: number, month: number): void {
  const rmFmt = (n: number) =>
    `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const period    = `${MONTH_NAMES[month]} ${year}`;
  const genDate   = new Date().toLocaleString("en-MY", {
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const skuRows = (data.top_skus ?? []).map((s, i) => `
    <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
      <td class="mono">${s.sku}</td>
      <td>${s.name}</td>
      <td class="num">${s.qty}</td>
      <td class="num">${rmFmt(s.revenue)}</td>
      <td class="num">${rmFmt(s.cogs)}</td>
      <td class="num gp">${rmFmt(s.revenue - s.cogs)}</td>
    </tr>`).join("");

  const supplierRows = (data.supplier_spend ?? []).map((s, i) => `
    <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
      <td>${s.supplier}</td>
      <td class="num">${s.boxes}</td>
      <td class="num red">${rmFmt(s.spend)}</td>
    </tr>`).join("");

  const marginColor = data.gross_margin_pct >= 20 ? "#166534" : data.gross_margin_pct >= 10 ? "#92400e" : "#991b1b";
  const profitColor = data.net_company_profit >= 0 ? "#166534" : "#991b1b";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>P&L Statement — ${period}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; background: #fff; }
  @page { size: A4; margin: 18mm 20mm; }

  /* ── Header ── */
  .header { border-bottom: 3px solid #0B1B2A; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  .company-name { font-size: 18pt; font-weight: 700; color: #0B1B2A; letter-spacing: -0.3px; }
  .company-reg  { font-size: 8.5pt; color: #6b7280; margin-top: 2px; }
  .report-meta  { text-align: right; }
  .report-title { font-size: 13pt; font-weight: 600; color: #0B1B2A; }
  .report-period { font-size: 9pt; color: #6b7280; margin-top: 3px; }

  /* ── Section titles ── */
  .section-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #6b7280; margin: 22px 0 10px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }

  /* ── KPI grid ── */
  .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 6px; }
  .kpi-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; background: #f9fafb; }
  .kpi-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: #9ca3af; font-weight: 600; }
  .kpi-value { font-size: 13pt; font-weight: 700; margin-top: 3px; }
  .kpi-sub   { font-size: 7.5pt; color: #9ca3af; margin-top: 2px; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th { background: #0B1B2A; color: #fff; font-size: 8pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 7px 10px; text-align: left; }
  th.num, td.num { text-align: right; }
  td { padding: 6px 10px; vertical-align: middle; }
  .row-even { background: #fff; }
  .row-odd  { background: #f8fafc; }
  tr:last-child td { border-bottom: 1px solid #e5e7eb; }
  .mono { font-family: 'Courier New', monospace; font-size: 8.5pt; color: #6b7280; }
  .gp   { color: #166534; font-weight: 600; }
  .red  { color: #991b1b; }

  /* ── Divider line in KPI block ── */
  .pl-summary-table { width: 100%; border-collapse: collapse; }
  .pl-summary-table td { padding: 5px 14px; font-size: 10.5pt; }
  .pl-summary-table .lbl { color: #4b5563; width: 55%; }
  .pl-summary-table .val { text-align: right; font-weight: 600; width: 45%; }
  .pl-summary-table tr.divider td { border-top: 1px solid #d1d5db; padding-top: 8px; margin-top: 4px; }
  .pl-summary-table tr.total td { font-size: 12pt; font-weight: 700; border-top: 2px solid #0B1B2A; }

  /* ── Footer ── */
  .footer { margin-top: 28px; border-top: 1px solid #e5e7eb; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8pt; color: #9ca3af; }
  .confidential { font-weight: 700; color: #6b7280; letter-spacing: 0.5px; text-transform: uppercase; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div>
    <div class="company-name">Equimed Supply Enterprise</div>
    <div class="company-reg">Registration No: AS0514499 · info@equimedsupply.com</div>
  </div>
  <div class="report-meta">
    <div class="report-title">Profit &amp; Loss Statement</div>
    <div class="report-period">Period: ${period} &nbsp;·&nbsp; Generated: ${genDate}</div>
  </div>
</div>

<!-- Financial Summary -->
<div class="section-title">Financial Summary</div>
<table class="pl-summary-table">
  <tr><td class="lbl">Gross Revenue</td>
      <td class="val">${rmFmt(data.gross_revenue)}</td></tr>
  <tr><td class="lbl">Total Cost of Goods Sold (COGS)</td>
      <td class="val" style="color:#991b1b">${rmFmt(data.total_cogs)}</td></tr>
  <tr class="divider">
      <td class="lbl">Gross Profit</td>
      <td class="val" style="color:${marginColor}">${rmFmt(data.gross_profit)} &nbsp;<span style="font-size:9pt;font-weight:400">(${data.gross_margin_pct}% margin)</span></td></tr>
  <tr><td class="lbl">Staff Commission Payouts</td>
      <td class="val" style="color:#92400e">${rmFmt(data.approx_payout)}</td></tr>
  <tr class="total">
      <td class="lbl">Net Company Profit</td>
      <td class="val" style="color:${profitColor}">${rmFmt(data.net_company_profit)}</td></tr>
</table>

<!-- Top SKUs -->
<div class="section-title">Top Products by Revenue</div>
<table>
  <thead>
    <tr>
      <th style="width:90px">SKU</th>
      <th>Product Name</th>
      <th class="num" style="width:60px">Qty</th>
      <th class="num" style="width:110px">Revenue</th>
      <th class="num" style="width:110px">COGS</th>
      <th class="num" style="width:110px">Gross Profit</th>
    </tr>
  </thead>
  <tbody>${skuRows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:16px">No data for this period</td></tr>'}</tbody>
</table>

<!-- Supplier Spend -->
<div class="section-title">Supplier Spend (COGS)</div>
<table>
  <thead>
    <tr>
      <th>Supplier</th>
      <th class="num" style="width:80px">Boxes</th>
      <th class="num" style="width:130px">Amount</th>
    </tr>
  </thead>
  <tbody>${supplierRows || '<tr><td colspan="3" style="text-align:center;color:#9ca3af;padding:16px">No data for this period</td></tr>'}</tbody>
</table>

<!-- Footer -->
<div class="footer">
  <div>
    Commission figures represent actual earned commissions from Paid invoices only (见款发佣原则).<br/>
    This report is generated by MediGlove ERP. Figures are subject to final month-end reconciliation.
  </div>
  <div class="confidential">Confidential — Management Use Only</div>
</div>

<script>window.onload = () => { window.print(); };</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site and try again.");
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// P&L Tab
// ─────────────────────────────────────────────────────────────────────────────
function PLTab({ supabase }: { supabase: SupabaseClientType }) {
  const now   = new Date();
  const [year,    setYear]    = useState(now.getFullYear());
  const [month,   setMonth]   = useState(now.getMonth() + 1);
  const [data,    setData]    = useState<PLResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result, error: rpcErr } = await supabase.rpc("fn_pl_summary", {
        p_year:  year,
        p_month: month,
      });
      if (rpcErr) throw rpcErr;
      setData(result as PLResult);
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? "Failed to load P&L.");
    } finally {
      setLoading(false);
    }
  }, [supabase, year, month]);

  useEffect(() => { load(); }, [load]);

  const PLCard = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) => (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Period picker */}
      <div className="flex items-center gap-3">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {[2024, 2025, 2026, 2027].map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <option key={m} value={m}>
              {new Date(2000, m - 1).toLocaleString("en-MY", { month: "long" })}
            </option>
          ))}
        </select>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700
                     rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        {data && (
          <button
            onClick={() => generatePLReport(data, year, month)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white
                       bg-gray-800 hover:bg-gray-900 rounded-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            Download Report
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">⚠ {error}</div>
      )}

      {data && (
        <>
          {/* P&L KPI Strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <PLCard label="Gross Revenue"       value={rm(data.gross_revenue)} />
            <PLCard label="Total COGS"          value={rm(data.total_cogs)}    accent="text-red-600" />
            <PLCard label="Gross Profit"        value={rm(data.gross_profit)}  accent="text-emerald-700"
                    sub={`${data.gross_margin_pct}% margin`} />
            <PLCard label="Approx. Payouts"     value={rm(data.approx_payout)} accent="text-amber-700"
                    sub="Actual commissions (paid invoices)" />
            <PLCard label="Net Company Profit"  value={rm(data.net_company_profit)}
                    accent={data.net_company_profit >= 0 ? "text-emerald-800" : "text-red-700"} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Top SKUs */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50">
                <h3 className="text-sm font-bold text-gray-900">🔥 Top 10 SKUs by Revenue</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
                      <th className="text-left px-4 py-2">SKU</th>
                      <th className="text-left px-4 py-2">Product</th>
                      <th className="text-right px-4 py-2">Qty</th>
                      <th className="text-right px-4 py-2">Revenue</th>
                      <th className="text-right px-4 py-2">GP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data.top_skus ?? []).map((sku, _i) => (
                      <tr key={sku.sku} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{sku.sku}</td>
                        <td className="px-4 py-2 text-gray-700 max-w-[120px] truncate">{sku.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{sku.qty}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">{rm(sku.revenue)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                          {rm(sku.revenue - sku.cogs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Supplier Spend */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50">
                <h3 className="text-sm font-bold text-gray-900">🏭 Supplier Spend (COGS)</h3>
              </div>
              <div className="space-y-3 p-5">
                {(() => {
                  const maxSpend = Math.max(...(data.supplier_spend ?? []).map(s => s.spend), 1);
                  return (data.supplier_spend ?? []).map((s) => (
                    <div key={s.supplier}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-700 font-medium truncate max-w-[160px]">{s.supplier}</span>
                        <span className="text-gray-500 tabular-nums">{rm(s.spend)} · {s.boxes} boxes</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-2 bg-blue-500 rounded-full transition-all"
                          style={{ width: `${(s.spend / maxSpend * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
            ⚠ Staff commission is the live sum of Actual commission rows for this period (见款发佣 — paid invoices only).
            Net Company Profit updates in real-time as invoices are marked Paid.
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportsPage
// ─────────────────────────────────────────────────────────────────────────────
type ReportTab = "ar" | "org" | "pl";

export function ReportsPage() {
  const { data: identity, isLoading: identityLoading } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const supabase = supabaseClient;

  const isAdmin = identity?.role === "Admin";
  const isHR    = identity?.role === "HR";

  const [tab, setTab] = useState<ReportTab>("ar");

  // Wait for identity before showing access-denied — avoids false blank on load
  if (identityLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!isAdmin && !isHR) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <p className="text-sm text-gray-500">🔒 Reports are accessible to Admin and HR only.</p>
        </div>
      </div>
    );
  }

  const tabs: { id: ReportTab; label: string; adminOnly?: boolean }[] = [
    { id: "ar",  label: "📊 AR Aging"  },
    { id: "org", label: "🏢 Org Chart" },
    { id: "pl",  label: "💰 P&L",       adminOnly: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Admin / HR view</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.filter(t => !t.adminOnly || isAdmin).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "ar"  && <ARAgingTab   supabase={supabase} />}
      {tab === "org" && <OrgChartTab  supabase={supabase} />}
      {tab === "pl"  && isAdmin && <PLTab supabase={supabase} />}
    </div>
  );
}
