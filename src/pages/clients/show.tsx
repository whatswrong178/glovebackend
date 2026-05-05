// ══════════════════════════════════════════════════════════════════════════════
// src/pages/clients/show.tsx — Client Detail + Neglect Gauge + Edit Requests
// MediGlove ERP · EPIC-04 / T-04.2 / T-04.4 / T-04.5
//                EPIC-05 / T-05.4 (Sample DO request button)
//
// Tabs:
//   "Overview"      — client fields + neglect gauge + Sample DO request
//   "Edit Requests" — pending/history of edit_requests for this client (Admin/HR)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import {
  useOne, useList, useUpdate, useGetIdentity, useNavigation
} from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
import { useParams } from "react-router-dom";
import type { Client, EditRequest } from "../../types/client";
import {
  NEGLECT_COLOR, NEGLECT_LABEL, NEGLECT_SPLIT_TABLE,
} from "../../types/client";
import type { StaffRole } from "../../types/staff";

type ShowTab = "overview" | "requests";

// ── Neglect gauge ─────────────────────────────────────────────────────────────
function NeglectGauge({ index }: { index: number }) {
  const split = NEGLECT_SPLIT_TABLE[index];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${NEGLECT_COLOR[index]}`}>
          Index {index} · {NEGLECT_LABEL[index]}
        </span>
        <span className="text-xs text-gray-500">
          Owner commission: <strong>{split.owner}%</strong> · Invoicer: <strong>{split.invoicer}%</strong>
        </span>
      </div>
      <div className="flex gap-0.5 h-3">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm ${
              i <= index ? NEGLECT_COLOR[index] : "bg-gray-100"
            }`}
          />
        ))}
      </div>
      {index >= 4 && (
        <p className="text-xs text-red-600 font-medium">
          ⚠️ {index === 6
            ? "Ownership has been forcibly transferred to the last invoicer."
            : "Approaching forced ownership transfer. Owner should engage this client urgently."}
        </p>
      )}
    </div>
  );
}

// ── Field display ─────────────────────────────────────────────────────────────
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-gray-50 last:border-0">
      <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

// ── Edit request row ──────────────────────────────────────────────────────────
function EditRequestRow({
  req,
  canReview,
  onApprove,
  onReject,
}: {
  req: EditRequest;
  canReview: boolean;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
}) {
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const statusColor = {
    Pending:  "bg-yellow-100 text-yellow-800",
    Approved: "bg-emerald-100 text-emerald-800",
    Rejected: "bg-red-100 text-red-800",
  }[req.status];

  return (
    <div className="border border-gray-100 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-gray-500">
            {req.requester?.name ?? req.requested_by} · {new Date(req.created_at).toLocaleDateString("en-MY")}
          </span>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
          {req.status}
        </span>
      </div>
      <table className="w-full text-xs text-gray-700">
        <thead>
          <tr className="text-gray-400 font-medium">
            <th className="text-left pb-1 w-1/4">Field</th>
            <th className="text-left pb-1">Requested Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(req.requested_changes).map(([k, v]) => (
            <tr key={k}>
              <td className="py-0.5 font-mono text-gray-500">{k}</td>
              <td className="py-0.5">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {req.status === "Pending" && canReview && (
        <>
          {reviewing ? (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Review note (optional for approval, recommended for rejection)…"
                rows={2}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2
                           focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onApprove(req.id)}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white
                             rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => onReject(req.id)}
                  className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white
                             rounded-lg hover:bg-red-700 transition-colors"
                >
                  ✗ Reject
                </button>
                <button
                  onClick={() => setReviewing(false)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setReviewing(true)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Review this request →
            </button>
          )}
        </>
      )}
      {req.status !== "Pending" && req.reviewed_by && (
        <p className="text-xs text-gray-400">
          {req.status} by {req.reviewer?.name ?? req.reviewed_by}
          {req.review_note ? ` · "${req.review_note}"` : ""}
        </p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function ClientShowPage() {
  const { id }   = useParams<{ id: string }>();
  const { edit, list } = useNavigation();
  const supabase = supabaseClient;
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isAdmin  = identity?.role === "Admin";
  const isHR     = identity?.role === "HR";
  const isLeader = identity?.role === "Leader";
  const isSales  = identity?.role === "Sales";
  const canReview = isAdmin || isHR;
  // Spec: Admin, HR, Leader, and Sales can all submit a Sample DO request
  const canRequestSample = isAdmin || isHR || isLeader || isSales;

  const [activeTab,     setActiveTab]     = useState<ShowTab>("overview");
  const [reviewNote,    setReviewNote]    = useState("");
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleResult,  setSampleResult]  = useState<{ do_no: string } | null>(null);
  const [sampleError,   setSampleError]   = useState("");

  const { data, isLoading, isError, refetch } = useOne<
    Client & {
      owner?:            { name: string } | null;
      creator?:          { name: string } | null;
      last_assistant?:   { name: string } | null;
    }
  >({
    resource: "clients",
    id:       id!,
    meta: {
      select: "id,name,ssm_no,region,credit_terms,neglect_index,is_orphan,contact_person,contact_email,contact_phone,address,first_order_date,created_at,owner_id,created_by,last_assisted_by,owner:staff!owner_id(name),creator:staff!created_by(name),last_assistant:staff!last_assisted_by(name)",
    },
  });

  const { data: requestsData, refetch: refetchReqs } = useList<EditRequest>({
    resource:   "edit_requests",
    sorters:    [{ field: "created_at", order: "desc" }],
    filters:    [{ field: "client_id", operator: "eq", value: id! }],
    pagination: { current: 1, pageSize: 50 },
    meta: {
      select: "id,client_id,requested_by,requested_changes,status,reviewed_by,review_note,created_at,reviewed_at,requester:staff!requested_by(name),reviewer:staff!reviewed_by(name)",
    },
    queryOptions: { enabled: activeTab === "requests" },
  });

  const { mutate: updateRequest } = useUpdate();
  const { mutate: updateClient  } = useUpdate();

  const handleRequestSample = async () => {
    if (!window.confirm(`Request a Sample DO for ${client?.name ?? "this client"}?`)) return;
    setSampleLoading(true);
    setSampleError("");
    setSampleResult(null);
    try {
      const { data, error } = await supabase.rpc("create_sample_do", { p_client_id: id });
      if (error) throw error;
      setSampleResult(data as { do_no: string });
    } catch (err) {
      setSampleError((err as { message?: string })?.message ?? "Failed to create Sample DO.");
    } finally {
      setSampleLoading(false);
    }
  };

  const client   = data?.data;
  const requests = requestsData?.data ?? [];
  const pendingCount = requests.filter((r) => r.status === "Pending").length;

  const handleApprove = (reqId: string) => {
    const req = requests.find((r) => r.id === reqId);
    if (!req || !client) return;

    // Apply changes to client
    updateClient(
      {
        resource: "clients",
        id:       client.id,
        values:   req.requested_changes,
      },
      {
        onSuccess: () => {
          updateRequest(
            {
              resource: "edit_requests",
              id:       reqId,
              values:   {
                status:      "Approved",
                reviewed_by: identity?.id,
                review_note: reviewNote || null,
                reviewed_at: new Date().toISOString(),
              },
            },
            {
              onSuccess: () => { refetch(); refetchReqs(); setReviewNote(""); },
              onError:   (err) => alert((err as unknown as Error).message ?? "Failed to mark request as Approved."),
            }
          );
        },
        onError: (err) => alert((err as unknown as Error).message ?? "Failed to apply client changes. The request was not approved."),
      }
    );
  };

  const handleReject = (reqId: string) => {
    updateRequest(
      {
        resource: "edit_requests",
        id:       reqId,
        values:   {
          status:      "Rejected",
          reviewed_by: identity?.id,
          review_note: reviewNote || null,
          reviewed_at: new Date().toISOString(),
        },
      },
      {
        onSuccess: () => { refetchReqs(); setReviewNote(""); },
        onError:   (err) => alert((err as unknown as Error).message ?? "Failed to reject request. Please try again."),
      }
    );
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
  );
  if (isError || !client) return (
    <div className="flex items-center justify-center h-48 text-sm text-red-500">Client not found.</div>
  );

  const isOwner = identity?.id === client.owner_id;
  const canEdit = isAdmin || isOwner;

  return (
    <div className="max-w-2xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => list("clients")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Clients
          </button>
          <h1 className="text-xl font-bold text-gray-900">{client.name}</h1>
          {client.is_orphan && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
              🏊 Public Pool
            </span>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => edit("clients", client.id)}
            className="px-3 py-2 text-sm font-medium border border-gray-200 rounded-lg
                       text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {isAdmin ? "Edit" : "Request Edit"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["overview", "requests"] as ShowTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "overview" ? "Overview" : (
              <span>
                Edit Requests
                {pendingCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-xs
                                   bg-red-500 text-white rounded-full">
                    {pendingCount}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === "overview" && (
        <>
          {/* Neglect gauge */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Neglect Index</h2>
            <NeglectGauge index={client.neglect_index} />
          </div>

          {/* Sample DO */}
          {canRequestSample && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-700">Sample Request</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Creates a Sample DO (SDO) — not counted toward sales GP. Requires HR & Finance approval.
                  </p>
                </div>
                <button
                  onClick={handleRequestSample}
                  disabled={sampleLoading}
                  className="px-3 py-2 text-sm font-medium border border-amber-300 text-amber-700
                             rounded-lg hover:bg-amber-50 transition-colors
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sampleLoading ? "Creating…" : "🎁 Request Sample DO"}
                </button>
              </div>
              {sampleResult && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-xs text-emerald-700">
                  ✓ Sample DO created: <strong className="font-mono">{sampleResult.do_no}</strong>
                </div>
              )}
              {sampleError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-700">
                  ⚠️ {sampleError}
                </div>
              )}
            </div>
          )}

          {/* Fields */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <dl>
              <Field label="SSM / Licence No." value={<span className="font-mono">{client.ssm_no ?? "—"}</span>} />
              <Field label="Region" value={
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  client.region === "West Malaysia" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                }`}>
                  {client.region}
                </span>
              } />
              <Field label="Credit Terms" value={client.credit_terms} />
              <Field label="Contact Person"  value={client.contact_person ?? "—"} />
              <Field label="Contact Email"   value={client.contact_email  ?? "—"} />
              <Field label="Contact Phone"   value={client.contact_phone  ?? "—"} />
              <Field label="Address" value={(client as any).address ?? "—"} />
              <Field label="First Order Date" value={
                client.first_order_date
                  ? new Date(client.first_order_date).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })
                  : "—"
              } />
              <Field label="Owner" value={(client as unknown as { owner?: { name: string } | null }).owner?.name ?? "None (Public Pool)"} />
              <Field label="Created By" value={(client as unknown as { creator?: { name: string } | null }).creator?.name ?? "—"} />
              <Field label="Last Assisted By" value={(client as unknown as { last_assistant?: { name: string } | null }).last_assistant?.name ?? "—"} />
              <Field label="Created" value={new Date(client.created_at).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })} />
            </dl>
          </div>
        </>
      )}

      {/* Edit Requests tab */}
      {activeTab === "requests" && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400 bg-white rounded-xl border border-gray-100">
              No edit requests for this client.
            </div>
          ) : (
            requests.map((req) => (
              <EditRequestRow
                key={req.id}
                req={req}
                canReview={canReview}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
