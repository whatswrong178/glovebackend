// ══════════════════════════════════════════════════════════════════════════════
// src/pages/deliveryOrders/list.tsx — Delivery Orders (Dual Track)
// MediGlove ERP · EPIC-07 / T-07.1 + T-07.2
//
// T-07.1: Physical exclusion of financial fields for Logistics role.
//         Logistics sees only assigned_logistics_id = self.
// T-07.2: Inline e-POD modal — Canvas signature + camera photo (both mandatory).
//         submit_epod RPC → status=Delivered, lock row permanently.
//
// Print UX: click DO No. → preview modal → Print button → window.print()
// DO NEVER shows prices — only qty and unit (per business rule).
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { CrudFilters } from "@refinedev/core";
import { useList, useUpdate, useGetIdentity } from "@refinedev/core";
import { supabaseClient } from "../../supabaseClient";
import type { StaffRole } from "../../types/staff";
import { PrintLayout } from "../../components/PrintLayout";
import type { PrintDocData, PrintDocType, CompanyInfo } from "../../components/PrintLayout";
import { usePrint } from "../../lib/print/usePrint";

type DOType   = "Invoice" | "Sample";
type DOStatus = "Pending" | "In Transit" | "Delivered" | "Cancelled";

interface DeliveryOrder {
  id:                    string;
  do_no:                 string;
  type:                  DOType;
  status:                DOStatus;
  invoice_id:            string | null;
  client_id:             string;
  created_by:            string;
  assigned_logistics_id: string | null;
  delivered_at:          string | null;
  created_at:            string;
  signature_base64:      string | null;
  photo_url:             string | null;
}

type RichDO = DeliveryOrder & {
  client?:   { name: string };
  creator?:  { name: string };
  assignee?: { name: string } | null;
  invoice?:  { invoice_no: string } | null;
};

interface PrintJob {
  doc:  PrintDocData;
  type: PrintDocType;
}

// ── StatusBadge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: DOStatus }) {
  const styles: Record<DOStatus, string> = {
    "Pending":    "bg-yellow-100 text-yellow-800",
    "In Transit": "bg-blue-100 text-blue-800",
    "Delivered":  "bg-emerald-100 text-emerald-800",
    "Cancelled":  "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

// ── Canvas Signature Pad ─────────────────────────────────────────────────────
function SignaturePad({
  onCapture,
  onClear,
}: {
  onCapture: (base64: string) => void;
  onClear:   () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing   = useRef(false);
  const lastPos   = useRef<{ x: number; y: number } | null>(null);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || !lastPos.current) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth   = 2;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    onCapture(canvas.toDataURL("image/png"));
  };

  const endDraw = () => {
    drawing.current = false;
    lastPos.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onClear();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Recipient Signature <span className="text-red-500">*</span>
        </span>
        <button type="button" onClick={clear} className="text-xs text-gray-400 hover:text-gray-600 underline">
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={480}
        height={180}
        className="w-full border-2 border-dashed border-gray-300 rounded-lg bg-slate-50
                   touch-none cursor-crosshair"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      <p className="text-xs text-gray-400">Sign above with finger or stylus</p>
    </div>
  );
}

// ── ePOD Modal ───────────────────────────────────────────────────────────────
function EPODModal({
  do_: doRecord,
  onClose,
  onSuccess,
}: {
  do_:       RichDO;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const supabase = supabaseClient;

  const [signatureBase64, setSignatureBase64] = useState<string | null>(null);
  const [photoDataUrl,    setPhotoDataUrl]    = useState<string | null>(null);
  const [geoLat,          setGeoLat]          = useState<number | null>(null);
  const [geoLng,          setGeoLng]          = useState<number | null>(null);
  const [geoError,        setGeoError]        = useState<string>("");
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported — coordinates will be null.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGeoLat(pos.coords.latitude); setGeoLng(pos.coords.longitude); },
      () => setGeoError("Location access denied — coordinates will be null.")
    );
  }, []);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoDataUrl(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    setError("");
    if (!signatureBase64) { setError("Signature is required."); return; }
    if (!photoDataUrl)    { setError("Photo is required."); return; }

    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc("submit_epod", {
        p_do_id:            doRecord.id,
        p_signature_base64: signatureBase64,
        p_photo_url:        photoDataUrl,
        p_geo_lat:          geoLat,
        p_geo_lng:          geoLng,
      });
      if (rpcError) throw rpcError;
      onSuccess();
    } catch (err: unknown) {
      setError((err as { message?: string }).message ?? "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">e-POD Submission</h2>
            <p className="text-xs text-gray-500 mt-0.5">DO No. {doRecord.do_no} — {doRecord.client?.name ?? "—"}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-6 py-5 space-y-6">
          <SignaturePad
            onCapture={(b64) => setSignatureBase64(b64)}
            onClear={() => setSignatureBase64(null)}
          />

          <div className="space-y-2">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Delivery Photo <span className="text-red-500">*</span>
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg
                           text-gray-700 hover:bg-gray-50 transition-colors"
              >
                📷 Take / Upload Photo
              </button>
              {photoDataUrl && (
                <span className="text-xs text-emerald-600 font-medium">✓ Photo captured</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhoto}
            />
            {photoDataUrl && (
              <img
                src={photoDataUrl}
                alt="Delivery proof"
                className="mt-2 rounded-lg border border-gray-200 max-h-48 object-cover w-full"
              />
            )}
          </div>

          <div className="text-xs text-gray-400">
            {geoError
              ? `⚠ ${geoError}`
              : geoLat !== null
              ? `📍 Location: ${geoLat.toFixed(5)}, ${geoLng?.toFixed(5)}`
              : "📍 Acquiring location…"}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              ⚠ {error}
            </div>
          )}

          <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-1 text-xs">
            <div className={signatureBase64 ? "text-emerald-600" : "text-gray-400"}>
              {signatureBase64 ? "✓" : "○"} Signature captured
            </div>
            <div className={photoDataUrl ? "text-emerald-600" : "text-gray-400"}>
              {photoDataUrl ? "✓" : "○"} Photo captured
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                       hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !signatureBase64 || !photoDataUrl}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700
                       rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Confirm Delivery ✓"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DO Print Preview Modal ────────────────────────────────────────────────────
interface DOPreviewModalProps {
  job:     PrintJob;
  onClose: () => void;
  onPrint: () => void;
}

function DOPrintPreviewModal({ job, onClose, onPrint }: DOPreviewModalProps) {
  const { doc, type } = job;
  const docLabel      = type === "SampleDO" ? "SAMPLE DELIVERY ORDER" : "DELIVERY ORDER";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Print Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{docLabel} · {doc.docNumber}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none font-light"
          >
            ✕
          </button>
        </div>

        {/* Document summary */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4">
            {doc.parties.filter(p => ["Deliver To"].includes(p.label)).map((party, i) => (
              <div key={i} className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{party.label}</p>
                <p className="text-sm font-semibold text-gray-900">{party.name}</p>
                {party.address && <p className="text-xs text-gray-500">{party.address}</p>}
                {party.contact && <p className="text-xs text-gray-500">Attn: {party.contact}</p>}
              </div>
            ))}
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Date / Status</p>
              <p className="text-sm font-semibold text-gray-900">{doc.date}</p>
              {doc.status && <StatusBadge status={doc.status as DOStatus} />}
            </div>
          </div>

          {/* Ref info (Invoice ref, driver) */}
          {doc.parties.filter(p => !["Deliver To"].includes(p.label)).length > 0 && (
            <div className="flex flex-wrap gap-3">
              {doc.parties.filter(p => !["Deliver To"].includes(p.label)).map((p, i) => (
                <div key={i} className="bg-blue-50 rounded-lg px-3 py-2 text-xs">
                  <span className="font-semibold text-blue-700">{p.label}: </span>
                  <span className="text-blue-900">{p.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Items table — qty and description only, NO prices */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Items ({doc.items.length}) — Qty &amp; Unit Only
            </p>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">No.</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Description</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {doc.items.map((item) => (
                    <tr key={item.no}>
                      <td className="px-4 py-2 text-gray-400 text-xs">{item.no}</td>
                      <td className="px-4 py-2 text-gray-800">{item.description}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{item.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes */}
          {doc.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-800">
              <span className="font-semibold">Notes:</span> {doc.notes}
            </div>
          )}

          {/* Signature indicator */}
          {doc.signatureBase64 && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs text-emerald-700 font-medium">
              ✓ e-POD signature captured — will appear on printed document
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg
                       hover:bg-white transition-colors"
          >
            Close
          </button>
          <button
            onClick={onPrint}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700
                       rounded-lg transition-colors flex items-center gap-2"
          >
            🖨 Print DO
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DOListPage ───────────────────────────────────────────────────────────────
export function DOListPage() {
  const { data: identity } = useGetIdentity<{ id: string; name: string; role: StaffRole }>();
  const isAdmin     = identity?.role === "Admin";
  const isHR        = identity?.role === "HR";
  const isLogistics = identity?.role === "Logistics";
  const canSeeAll   = isAdmin || isHR;
  const canApprove  = isAdmin || isHR;

  const [tab,            setTab]            = useState<DOType>("Invoice");
  const [statusFilter,   setStatusFilter]   = useState<DOStatus | "">("");
  const [page,           setPage]           = useState(1);
  const [epodTarget,     setEpodTarget]     = useState<RichDO | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null); // do ID being fetched
  const [previewJob,     setPreviewJob]     = useState<PrintJob | null>(null); // modal open
  const [printJob,       setPrintJob]       = useState<PrintJob | null>(null); // triggers window.print()
  const [companyInfo,    setCompanyInfo]    = useState<CompanyInfo>({ name: "MediGlove Supply Sdn. Bhd." });
  const PAGE_SIZE = 25;

  const { mutate: updateDO } = useUpdate();

  // ── Fetch company settings once on mount ─────────────────────────────────
  useEffect(() => {
    supabaseClient
      .from("company_settings")
      .select("company_name,registration_no,address_line1,address_line2,city,postcode,state,phone,email,website,logo_url,bank_name,bank_account_name,bank_account_no,bank_swift_code")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .single()
      .then(({ data }) => {
        if (!data) return;
        const addrParts = [
          data.address_line1,
          data.address_line2,
          [data.postcode, data.city].filter(Boolean).join(" "),
          data.state,
        ].filter(Boolean);
        setCompanyInfo({
          name:            data.company_name      ?? "MediGlove Supply Sdn. Bhd.",
          regNo:           data.registration_no   ?? undefined,
          address:         addrParts.join(", ")   || undefined,
          phone:           data.phone             ?? undefined,
          email:           data.email             ?? undefined,
          website:         data.website           ?? undefined,
          logoUrl:         data.logo_url          ?? undefined,
          bankName:        data.bank_name         ?? undefined,
          bankAccountName: data.bank_account_name ?? undefined,
          bankAccountNo:   data.bank_account_no   ?? undefined,
          bankSwiftCode:   data.bank_swift_code   ?? undefined,
        });
      });
  }, []);

  // ── Print hook ──────────────────────────────────────────────────────────
  const { printRef, triggerPrint, isPrinting } = usePrint({
    onAfterPrint: () => setPrintJob(null),
  });

  useEffect(() => {
    if (!printJob) return;
    const rafId = requestAnimationFrame(() => { triggerPrint(); });
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  // ── Preview handler — called when DO number is clicked ───────────────────
  const handlePreview = useCallback(async (do_: RichDO) => {
    if (previewLoading) return;
    setPreviewLoading(do_.id);

    try {
      const { data: clientData } = await supabaseClient
        .from("clients")
        .select("name,ssm_no,region,contact_person,contact_email,contact_phone")
        .eq("id", do_.client_id)
        .single();

      type ClientRow = {
        name: string; ssm_no: string | null; region: string | null;
        contact_person: string | null; contact_email: string | null; contact_phone: string | null;
      };
      const client = clientData as ClientRow | null;

      type ItemRow = {
        qty: number; selling_price: number; unit: string;
        product: { name: string; sku: string } | null;
      };

      let lineItems: ItemRow[] = [];
      if (do_.type === "Invoice" && do_.invoice_id) {
        const { data: items } = await supabaseClient
          .from("invoice_items")
          .select("qty,selling_price,unit,product:products!product_id(name,sku)")
          .eq("invoice_id", do_.invoice_id);
        lineItems = (items ?? []) as unknown as ItemRow[];
      }

      const docDate = new Date(do_.created_at).toLocaleDateString("en-MY", {
        day: "2-digit", month: "long", year: "numeric",
      });

      const printType: PrintDocType = do_.type === "Sample" ? "SampleDO" : "DeliveryOrder";

      const docData: PrintDocData = {
        docNumber: do_.do_no,
        date:      docDate,
        status:    do_.status,
        currency:  "MYR",
        isSample:  do_.type === "Sample",

        parties: [
          {
            label:   "Deliver To",
            name:    client?.name ?? "—",
            ssm:     client?.ssm_no ?? undefined,
            address: client?.region ?? undefined,
            contact: client?.contact_person ?? undefined,
            email:   client?.contact_email ?? undefined,
          },
          ...(do_.invoice?.invoice_no
            ? [{ label: "Invoice Ref", name: do_.invoice.invoice_no }]
            : []),
          ...(do_.assignee?.name
            ? [{ label: "Assigned Driver", name: do_.assignee.name }]
            : []),
        ],

        // DO: NEVER show prices — only description (with unit) + qty
        items: lineItems.map((it, idx) => ({
          no:          idx + 1,
          description: `${it.product?.name ?? "Unknown Product"} (${it.unit})`,
          sku:         it.product?.sku ?? undefined,
          qty:         it.qty,
          // unitPrice and amount intentionally omitted for DO
        })),

        notes: do_.delivered_at
          ? `Delivered on ${new Date(do_.delivered_at).toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" })}`
          : undefined,

        signatureBase64: do_.signature_base64 ?? undefined,
      };

      setPreviewJob({ doc: docData, type: printType });

    } catch (err) {
      console.error("[DOList] Preview fetch failed:", err);
      alert("Failed to load delivery order. Please try again.");
    } finally {
      setPreviewLoading(null);
    }
  }, [previewLoading]);

  // ── List filters ──────────────────────────────────────────────────────────
  const baseFilters: CrudFilters = [
    { field: "type", operator: "eq", value: tab },
  ];
  if (statusFilter) {
    baseFilters.push({ field: "status", operator: "eq", value: statusFilter });
  }
  if (isLogistics && identity?.id && !canSeeAll) {
    baseFilters.push({ field: "assigned_logistics_id", operator: "eq", value: identity.id });
  }

  const selectFields = isLogistics && !canSeeAll
    ? "id,do_no,type,status,invoice_id,client_id,assigned_logistics_id,delivered_at,created_at,signature_base64,photo_url,client:clients!client_id(name),assignee:staff!assigned_logistics_id(name),invoice:invoices!invoice_id(invoice_no)"
    : "id,do_no,type,status,invoice_id,client_id,assigned_logistics_id,delivered_at,created_at,signature_base64,photo_url,client:clients!client_id(name),creator:staff!created_by(name),assignee:staff!assigned_logistics_id(name),invoice:invoices!invoice_id(invoice_no)";

  const { data, isLoading, refetch } = useList<RichDO>({
    resource:   "delivery_orders",
    pagination: { current: page, pageSize: PAGE_SIZE },
    sorters:    [{ field: "created_at", order: "desc" }],
    filters:    baseFilters,
    meta:       { select: selectFields },
  });

  const orders     = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSimpleStatusChange = (id: string, newStatus: DOStatus) => {
    updateDO(
      {
        resource: "delivery_orders",
        id,
        values: {
          status:       newStatus,
          delivered_at: newStatus === "Delivered" ? new Date().toISOString() : null,
        },
      },
      { onSuccess: () => refetch() }
    );
  };

  const handleEpodSuccess = () => {
    setEpodTarget(null);
    refetch();
  };

  return (
    <div className="space-y-4">

      {/* Hidden print area */}
      {printJob && (
        <div aria-hidden="true" style={{ position: "fixed", left: "-9999px", top: 0, overflow: "hidden" }}>
          <PrintLayout ref={printRef} doc={printJob.doc} type={printJob.type} showPricing={false} company={companyInfo} />
        </div>
      )}

      {/* Preview modal */}
      {previewJob && (
        <DOPrintPreviewModal
          job={previewJob}
          onClose={() => setPreviewJob(null)}
          onPrint={() => { const job = previewJob; setPreviewJob(null); setPrintJob(job); }}
        />
      )}

      {/* ePOD Modal */}
      {epodTarget && (
        <EPODModal do_={epodTarget} onClose={() => setEpodTarget(null)} onSuccess={handleEpodSuccess} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Delivery Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} record{total !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(["Invoice", "Sample"] as DOType[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "Invoice" ? "🧾 Invoice DOs" : "🎁 Sample DOs"}
          </button>
        ))}
      </div>

      {tab === "Sample" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-800">
          Sample DOs are not counted toward sales GP. They require HR &amp; Finance approval before dispatch.
        </div>
      )}

      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={(e) => { setStatusFilter(e.target.value as DOStatus | ""); setPage(1); }}
        className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      >
        <option value="">All Statuses</option>
        <option value="Pending">Pending</option>
        <option value="In Transit">In Transit</option>
        <option value="Delivered">Delivered</option>
        <option value="Cancelled">Cancelled</option>
      </select>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            No {tab} delivery orders found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">DO No.</th>
                  {tab === "Invoice" && (
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice</th>
                  )}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Assigned</th>
                  {canSeeAll && (
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Created By</th>
                  )}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">POD</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orders.map((do_) => {
                  const isDelivered   = do_.status === "Delivered";
                  const isCancelled   = do_.status === "Cancelled";
                  const isLocked      = isDelivered || isCancelled;
                  const canAdvance    = !isLocked && (canSeeAll || isLogistics);
                  const isLoadingThis = previewLoading === do_.id;

                  return (
                    <tr key={do_.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handlePreview(do_)}
                          disabled={!!previewLoading || isPrinting}
                          className="font-mono text-blue-600 hover:text-blue-800 hover:underline text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Click to preview & print"
                        >
                          {isLoadingThis ? <span className="text-gray-400">Loading…</span> : do_.do_no}
                        </button>
                      </td>
                      {tab === "Invoice" && (
                        <td className="px-4 py-3 font-mono text-gray-500 text-xs">
                          {do_.invoice?.invoice_no ?? "—"}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-700">{do_.client?.name ?? "—"}</td>
                      <td className="px-4 py-3"><StatusBadge status={do_.status} /></td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{do_.assignee?.name ?? "Unassigned"}</td>
                      {canSeeAll && (
                        <td className="px-4 py-3 text-gray-500 text-xs">{do_.creator?.name ?? "—"}</td>
                      )}
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(do_.created_at).toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        {do_.signature_base64
                          ? <span className="text-xs text-emerald-600 font-medium">✓ Signed</span>
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        {do_.status === "Pending" && canSeeAll && (
                          <button
                            onClick={() => handleSimpleStatusChange(do_.id, "In Transit")}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            → In Transit
                          </button>
                        )}
                        {do_.status === "In Transit" && canAdvance && (
                          <button
                            onClick={() => setEpodTarget(do_)}
                            className="text-xs text-emerald-600 hover:text-emerald-800 font-medium border border-emerald-300 rounded px-2 py-0.5"
                          >
                            📋 e-POD
                          </button>
                        )}
                        {do_.status === "Pending" && canApprove && (
                          <button
                            onClick={() => handleSimpleStatusChange(do_.id, "Cancelled")}
                            className="text-xs text-red-500 hover:text-red-700 font-medium"
                          >
                            Cancel
                          </button>
                        )}
                        {isDelivered && <span className="text-xs text-gray-400">🔒 Locked</span>}
                      </td>
                    </tr>
                  );
                })}
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
              className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
