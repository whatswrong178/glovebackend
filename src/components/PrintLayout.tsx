/**
 * PrintLayout — Universal A4 Print Wrapper (T-01.3)
 *
 * Professional redesign: deep-navy accent, clean table striping, scoped CSS.
 * PRINT_CSS is exported for use in popup windows (invoices, DO, PO).
 * The component self-injects the same CSS via <style> so the PO preview modal
 * renders identically to the printed output.
 *
 * Usage (caller):
 *   import { PrintLayout, PRINT_CSS } from "../../components/PrintLayout";
 *
 *   const openPrintWindow = (innerHTML: string, title: string) => {
 *     const win = window.open("", "_blank");
 *     win.document.write(
 *       `<!DOCTYPE html><html><head><title>${title}</title>
 *        <style>@page{size:A4;margin:15mm 14mm}body{margin:0}${PRINT_CSS}</style>
 *       </head><body><div class="print-area">${innerHTML}</div></body></html>`
 *     );
 *     win.document.close(); win.focus();
 *     setTimeout(() => win.print(), 400);
 *   };
 *
 *   // innerHTML = printRef.current?.innerHTML  (ref on <PrintLayout>)
 */

import React, { forwardRef } from "react";

// ─── Shared document types ────────────────────────────────────────────────────
export type PrintDocType =
  | "Invoice"
  | "DeliveryOrder"
  | "PurchaseOrder"
  | "Receipt"
  | "SampleDO";

export interface PrintLineItem {
  no:          number;
  description: string;
  sku?:        string;
  qty:         number;
  unit?:       string;   // e.g. "Carton", "Box"
  unitPrice?:  number;
  amount?:     number;
}

export interface PrintParty {
  label:    string;
  name:     string;
  address?: string;
  contact?: string;
  email?:   string;
  ssm?:     string;
}

export interface PrintDocData {
  docNumber:        string;
  date:             string;
  dueDate?:         string;
  status?:          string;
  currency?:        string;
  parties:          PrintParty[];
  items:            PrintLineItem[];
  subtotal?:        number;
  discount?:        number;
  discountLabel?:   string;   // e.g. "Discount (10%)"
  deliveryCharge?:  number;
  total?:           number;
  notes?:           string;
  terms?:           string;
  isDraft?:         boolean;
  isSample?:        boolean;
  signatureBase64?: string;
}

export interface CompanyInfo {
  name:             string;
  regNo?:           string;
  address?:         string;
  phone?:           string;
  email?:           string;
  website?:         string;
  logoUrl?:         string;
  bankName?:        string;
  bankAccountName?: string;
  bankAccountNo?:   string;
  bankSwiftCode?:   string;
}

// ─── Exported CSS — used in both popup windows and the component <style> ──────
export const PRINT_CSS = `
/* Force all backgrounds + colours to print (critical for grayscale) */
*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}

.print-area{
  font-family:Arial,Helvetica,sans-serif;
  font-size:11pt;
  color:#000;
  background:#fff;
  position:relative;
  text-rendering:optimizeLegibility;
  -webkit-font-smoothing:antialiased;
}
.print-area *{box-sizing:border-box}

/* Watermark */
.print-watermark{position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);
  font-size:80pt;font-weight:900;color:rgba(0,0,0,.06);pointer-events:none;z-index:0;
  letter-spacing:8pt;white-space:nowrap}

/* ── Header ── */
.p-header{display:flex;justify-content:space-between;align-items:flex-start;
  padding-bottom:10pt;margin-bottom:12pt;border-bottom:2pt solid #000}
.p-co-name{font-size:17pt;font-weight:900;color:#000;line-height:1.1;margin:0 0 4pt 0}
.p-co-sub{font-size:9pt;color:#333;line-height:1.7;font-weight:500}
.p-doc-type{font-size:20pt;font-weight:900;color:#000;text-align:right;letter-spacing:.3pt}
.p-doc-ref{font-size:11pt;font-weight:700;color:#000;text-align:right;margin-top:3pt;font-family:monospace}
.p-meta-tbl{width:auto;border-collapse:collapse;margin-top:8pt;margin-left:auto}
.p-meta-tbl td{border:none!important;padding:2pt 0;font-size:9.5pt;background:transparent!important}
.p-meta-label{color:#444;padding-right:12pt;white-space:nowrap;font-weight:500}
.p-meta-value{text-align:right;font-weight:700;color:#000}

/* ── Badge — transparent background, solid border ── */
.p-badge{display:inline-block;padding:2pt 7pt;border-radius:3pt;
  font-size:8.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.3pt;
  background:transparent;border:1.5pt solid #000;color:#000}
.p-badge-draft{border-color:#000}
.p-badge-active{border-color:#000}
.p-badge-paid{border-color:#000}
.p-badge-sent{border-color:#000}
.p-badge-approved{border-color:#000}
.p-badge-cancelled{color:#555;border-color:#555}
.p-badge-pending{border-color:#000}
.p-badge-delivered{border-color:#000}
.p-badge-in-transit{border-color:#000}
.p-badge-sample{border-color:#000}

/* ── Party grid ── */
.p-party-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10pt;margin-bottom:14pt}
.p-party{background:#f2f2f2;border:1pt solid #888;border-radius:2pt;padding:10pt}
.p-party-label{font-size:7.5pt;font-weight:800;text-transform:uppercase;letter-spacing:1pt;
  color:#000;margin-bottom:5pt;padding-bottom:4pt;border-bottom:1pt solid #aaa}
.p-party-name{font-size:12pt;font-weight:800;color:#000;margin-bottom:2pt;line-height:1.2}
.p-party-reg{font-size:9pt;color:#333;margin-top:1pt;font-weight:500}
.p-party-detail{font-size:9.5pt;color:#222;line-height:1.6;margin-top:2pt;white-space:pre-line;font-weight:500}
.p-party-attn{font-size:9.5pt;color:#222;margin-top:3pt;font-weight:500}
.p-party-email{font-size:9.5pt;color:#222;font-weight:500}

/* ── Items table ── */
.p-table{width:100%;border-collapse:collapse;border:1pt solid #aaa}
.p-table thead tr{background:#000}
.p-table thead th{font-size:9pt;font-weight:700;color:#fff;padding:7pt 8pt;
  text-align:left;border-right:1pt solid #444}
.p-table thead th.r{text-align:right}
/* Zebra rows — neutral grays survive grayscale perfectly */
.p-table tbody tr:nth-child(even){background:#f0f0f0}
/* td borders on all 4 sides ensures visible grid in every print mode */
.p-table tbody td{font-size:10pt;padding:6.5pt 8pt;color:#000;border:1pt solid #ccc}
.p-table tbody td.r{text-align:right}
.p-table tbody td.mono{font-family:monospace;font-size:9.5pt;color:#000;font-weight:600}
.p-table tbody td.num{text-align:right;font-weight:700;color:#000}
.p-table tbody td.muted{color:#444;font-size:9.5pt;font-weight:500}
.p-table tbody td.unit-tag{font-size:9pt;color:#444;font-style:italic;font-weight:500}

/* ── Tfoot totals ── */
.p-table tfoot td{border:none!important;background:transparent!important}
.p-tot-row td{padding:3pt 8pt;border-top:1pt solid #ccc}
.p-tot-label{text-align:right;color:#333;font-size:10pt;font-weight:600}
.p-tot-val{text-align:right;font-size:10pt;font-weight:600;color:#000}
.p-tot-disc{color:#000;font-weight:700;text-decoration:underline}
/* Grand total — pure black background; survives any print mode */
.p-grand td{padding:8pt 8pt;background:#000!important;border-top:2pt solid #000!important}
.p-grand .p-tot-label{color:#fff!important;font-size:11pt;font-weight:700;text-align:right}
.p-grand .p-tot-val{color:#fff!important;font-size:14pt;font-weight:900;text-align:right}

/* ── Notes / Terms ── */
.p-notes-section{margin-top:12pt;border-top:1pt solid #aaa;padding-top:8pt}
.p-note-box{background:#f2f2f2;border-left:3pt solid #000;padding:7pt 10pt;
  margin-bottom:6pt;font-size:9.5pt;color:#000;line-height:1.6}
.p-note-label{font-weight:800;color:#000;margin-right:4pt}
.p-terms-box{font-size:9.5pt;color:#333;line-height:1.6;font-weight:500}
.p-terms-label{font-weight:700;color:#000;margin-right:4pt}

/* ── Payment details ── */
.p-payment-section{margin-top:14pt;border-top:1pt solid #aaa;padding-top:10pt}
.p-payment-title{font-size:9.5pt;font-weight:800;color:#000;margin-bottom:8pt;
  text-transform:uppercase;letter-spacing:.5pt}
.p-payment-box{display:inline-block;background:#f2f2f2;border:1pt solid #888;
  border-radius:3pt;padding:10pt 14pt;min-width:220pt}
.p-payment-tbl{border-collapse:collapse;width:100%}
.p-payment-tbl td{border:none!important;padding:4pt 0;font-size:10pt;
  background:transparent!important;vertical-align:middle}
.p-pay-label{color:#444;padding-right:24pt;white-space:nowrap;font-size:9.5pt;font-weight:600}
.p-pay-val{font-weight:700;font-family:monospace;font-size:10.5pt;color:#000}

/* ── e-POD ── */
.p-epod-section{margin-top:12pt;border-top:1pt solid #aaa;padding-top:8pt}
.p-epod-title{font-size:9.5pt;font-weight:800;color:#000;margin-bottom:5pt}
.p-epod-note{font-size:9pt;color:#333;margin-top:3pt;font-weight:500}

/* ── Footer ── */
.p-footer{margin-top:22pt;padding-top:10pt;border-top:1pt solid #888}
.p-sig-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16pt}
.p-sig{padding-top:32pt;border-top:1pt solid #666;font-size:9pt;color:#333;font-weight:500}
.p-sig-title{font-weight:700;color:#000;font-size:9pt}
.p-sig-sub{font-size:8.5pt;color:#444;margin-top:2pt;font-weight:500}
.p-legal{margin-top:10pt;text-align:center;font-size:8pt;color:#555;font-weight:500;
  border-top:1pt solid #ccc;padding-top:5pt}
`;

// ─── Constants ────────────────────────────────────────────────────────────────
const COMPANY_FALLBACK: CompanyInfo = {
  name: "Equimed Supply Enterprise",
};

const DOC_LABELS: Record<PrintDocType, string> = {
  Invoice:       "PROFORMA INVOICE",
  DeliveryOrder: "DELIVERY ORDER",
  PurchaseOrder: "PURCHASE ORDER",
  Receipt:       "OFFICIAL RECEIPT",
  SampleDO:      "SAMPLE DELIVERY ORDER",
};

function badgeClass(status?: string): string {
  if (!status) return "p-badge";
  const key = status.toLowerCase().replace(/\s+/g, "-");
  return `p-badge p-badge-${key}`;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface PrintLayoutProps {
  doc:          PrintDocData;
  type:         PrintDocType;
  showPricing?: boolean;
  company?:     CompanyInfo;
}

export const PrintLayout = forwardRef<HTMLDivElement, PrintLayoutProps>(
  ({ doc, type, showPricing = true, company }, ref) => {
    const co       = company ?? COMPANY_FALLBACK;
    const currency = doc.currency ?? "MYR";
    const fmt      = (n: number) =>
      n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const hasSku  = doc.items.some((i) => i.sku);
    const hasUnit = doc.items.some((i) => i.unit);

    // Company sub-lines
    const coSubLines: string[] = [];
    if (co.regNo)   coSubLines.push(`Reg No: ${co.regNo}`);
    if (co.address) coSubLines.push(co.address);
    const contactLine = [
      co.phone   && `Tel: ${co.phone}`,
      co.email,
      co.website,
    ].filter(Boolean).join("  ·  ");
    if (contactLine) coSubLines.push(contactLine);

    // Colspan for tfoot padding cells
    // Columns: No(1) + Desc(1) + [SKU(1)] + [Unit(1)] + Qty(1) = base
    // Then Unit Price and Amount (showPricing only)
    const leftCols =
      1 +                       // No.
      1 +                       // Description
      (hasSku  ? 1 : 0) +      // SKU
      (hasUnit ? 1 : 0) +      // Unit
      1;                        // Qty
    // tfoot spans leftCols + (showPricing ? 0 : 0) — unit price & amount are the last 2
    const tfootPadCols = leftCols;

    return (
      <>
        {/* Self-inject CSS so the web preview (PO preview modal) matches print output */}
        {/* eslint-disable-next-line react/no-danger */}
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

        <div ref={ref} className="print-area" role="document"
          aria-label={`${DOC_LABELS[type]} ${doc.docNumber}`}>

          {/* Watermark */}
          {(doc.isDraft || doc.isSample) && (
            <div className="print-watermark">
              {doc.isDraft ? "DRAFT" : "SAMPLE"}
            </div>
          )}

          {/* ── Header ──────────────────────────────────────── */}
          <div className="p-header">

            {/* Company / Logo */}
            <div>
              {co.logoUrl && (
                <img
                  src={co.logoUrl}
                  alt={co.name}
                  style={{
                    maxHeight: "90pt", maxWidth: "220pt", objectFit: "contain",
                    display: "block", marginBottom: "6pt",
                  }}
                />
              )}
              {/* Always show company name — under logo if logo present, as primary if not */}
              <div
                className="p-co-name"
                style={co.logoUrl ? { fontSize: "11pt", fontWeight: 700, color: "#000" } : undefined}
              >
                {co.name}
              </div>
              {coSubLines.length > 0 && (
                <div className="p-co-sub">
                  {coSubLines.map((line, i) => (
                    <React.Fragment key={i}>
                      {line}
                      {i < coSubLines.length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>

            {/* Doc meta */}
            <div>
              <div className="p-doc-type">{DOC_LABELS[type]}</div>
              <div className="p-doc-ref"># {doc.docNumber}</div>
              <table className="p-meta-tbl">
                <tbody>
                  <tr>
                    <td className="p-meta-label">Date</td>
                    <td className="p-meta-value">{doc.date}</td>
                  </tr>
                  {doc.dueDate && (
                    <tr>
                      <td className="p-meta-label">Due Date</td>
                      <td className="p-meta-value" style={{ color: "#dc2626" }}>{doc.dueDate}</td>
                    </tr>
                  )}
                  {doc.status && (
                    <tr>
                      <td className="p-meta-label">Status</td>
                      <td className="p-meta-value">
                        <span className={badgeClass(doc.status)}>{doc.status}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Party grid ──────────────────────────────────── */}
          {doc.parties.length > 0 && (
            <div
              className="p-party-grid"
              style={{ gridTemplateColumns: `repeat(${Math.min(doc.parties.length, 2)}, 1fr)` }}
            >
              {doc.parties.map((party, i) => (
                <div key={i} className="p-party">
                  <div className="p-party-label">{party.label}</div>
                  <div className="p-party-name">{party.name}</div>
                  {party.ssm && (
                    <div className="p-party-reg">Reg No: {party.ssm}</div>
                  )}
                  {party.address && (
                    <div className="p-party-detail">{party.address}</div>
                  )}
                  {party.contact && (
                    <div className="p-party-attn">Attn: {party.contact}</div>
                  )}
                  {party.email && (
                    <div className="p-party-email">{party.email}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Line items table ────────────────────────────── */}
          <table className="p-table">
            <thead>
              <tr>
                <th style={{ width: "24pt" }}>No.</th>
                <th>Description</th>
                {hasSku  && <th style={{ width: "62pt" }}>SKU</th>}
                {hasUnit && <th style={{ width: "44pt" }}>Unit</th>}
                <th className="r" style={{ width: "34pt" }}>Qty</th>
                {showPricing && (
                  <>
                    <th className="r" style={{ width: "70pt" }}>Unit Price ({currency})</th>
                    <th className="r" style={{ width: "74pt" }}>Amount ({currency})</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {doc.items.map((item) => (
                <tr key={item.no}>
                  <td className="muted">{item.no}</td>
                  <td style={{ fontWeight: 500 }}>{item.description}</td>
                  {hasSku  && <td className="mono">{item.sku ?? "—"}</td>}
                  {hasUnit && <td className="unit-tag">{item.unit ?? "—"}</td>}
                  <td className="num">{item.qty}</td>
                  {showPricing && (
                    <>
                      <td className="r">
                        {item.unitPrice != null ? fmt(item.unitPrice) : "—"}
                      </td>
                      <td className="num">
                        {item.amount != null ? fmt(item.amount) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>

            {/* Totals — Invoice / Receipt / PO only */}
            {showPricing && (doc.subtotal != null || doc.total != null) && (
              <tfoot>
                {doc.subtotal != null && (
                  <tr className="p-tot-row">
                    <td colSpan={tfootPadCols} />
                    <td className="p-tot-label">Subtotal</td>
                    <td className="p-tot-val">{fmt(doc.subtotal)}</td>
                  </tr>
                )}
                {doc.discount != null && doc.discount > 0 && (
                  <tr className="p-tot-row">
                    <td colSpan={tfootPadCols} />
                    <td className="p-tot-label">{doc.discountLabel ?? "Discount"}</td>
                    <td className="p-tot-val p-tot-disc">({fmt(doc.discount)})</td>
                  </tr>
                )}
                {doc.deliveryCharge != null && (
                  <tr className="p-tot-row">
                    <td colSpan={tfootPadCols} />
                    <td className="p-tot-label">Delivery</td>
                    <td className="p-tot-val">
                      {doc.deliveryCharge === 0 ? (
                        <span style={{ color: "#16a34a", fontWeight: 700 }}>FREE</span>
                      ) : (
                        fmt(doc.deliveryCharge)
                      )}
                    </td>
                  </tr>
                )}
                {doc.total != null && (
                  <tr className="p-grand">
                    <td colSpan={tfootPadCols} />
                    <td className="p-tot-label">TOTAL ({currency})</td>
                    <td className="p-tot-val">{fmt(doc.total)}</td>
                  </tr>
                )}
              </tfoot>
            )}
          </table>

          {/* ── Notes / Terms ────────────────────────────────── */}
          {(doc.notes || doc.terms) && (
            <div className="p-notes-section">
              {doc.notes && (
                <div className="p-note-box">
                  <span className="p-note-label">Notes:</span>
                  {doc.notes}
                </div>
              )}
              {doc.terms && (
                <div className="p-terms-box">
                  <span className="p-terms-label">Terms &amp; Conditions:</span>
                  {doc.terms}
                </div>
              )}
            </div>
          )}

          {/* ── Payment details (Invoice only) ──────────────── */}
          {type === "Invoice" && (co.bankName || co.bankAccountNo) && (
            <div className="p-payment-section">
              <div className="p-payment-title">Payment Details</div>
              <div className="p-payment-box">
                <table className="p-payment-tbl">
                  <tbody>
                    {co.bankName        && (
                      <tr>
                        <td className="p-pay-label">Bank</td>
                        <td className="p-pay-val">{co.bankName}</td>
                      </tr>
                    )}
                    {co.bankAccountName && (
                      <tr>
                        <td className="p-pay-label">Account Name</td>
                        <td className="p-pay-val">{co.bankAccountName}</td>
                      </tr>
                    )}
                    {co.bankAccountNo   && (
                      <tr>
                        <td className="p-pay-label">Account No.</td>
                        <td className="p-pay-val">{co.bankAccountNo}</td>
                      </tr>
                    )}
                    {co.bankSwiftCode   && (
                      <tr>
                        <td className="p-pay-label">SWIFT / BIC</td>
                        <td className="p-pay-val">{co.bankSwiftCode}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── e-POD Signature (Delivery Order only) ───────── */}
          {doc.signatureBase64 && (
            <div className="p-epod-section">
              <div className="p-epod-title">Recipient Signature (e-POD)</div>
              <img
                src={doc.signatureBase64}
                alt="Recipient Signature"
                style={{ height: "44pt", border: "0.6pt solid #d1d5db",
                         display: "block", borderRadius: "2pt" }}
              />
              <div className="p-epod-note">
                Electronically captured at time of delivery. Date: {doc.date}
              </div>
            </div>
          )}

          {/* ── Footer ──────────────────────────────────────── */}
          <div className="p-footer">
            <div className="p-sig-grid">
              <div className="p-sig">
                <div className="p-sig-title">Prepared By</div>
                <div className="p-sig-sub">{co.name}</div>
              </div>
              <div className="p-sig">
                <div className="p-sig-title">Authorised Signature</div>
              </div>
              <div className="p-sig">
                <div className="p-sig-title">Received By</div>
                {(type === "DeliveryOrder" || type === "SampleDO") && (
                  <div className="p-sig-sub">Signature &amp; Company Chop</div>
                )}
              </div>
            </div>
            <div className="p-legal">
              This is a computer-generated document. No signature is required unless stated above.
              {(co.name || co.phone || co.email) && (
                <>
                  <br />
                  {[co.name, co.phone, co.email, co.website].filter(Boolean).join("  ·  ")}
                </>
              )}
            </div>
          </div>

        </div>
      </>
    );
  }
);

PrintLayout.displayName = "PrintLayout";
