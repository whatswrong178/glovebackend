/**
 * PrintLayout — Universal A4 Print Wrapper (T-01.3)
 *
 * Wraps any document (Invoice / DO / PO / Receipt / Sample DO) and renders
 * a standardised A4 header, party grid, line-items table, totals, and footer.
 * The consumer only passes typed props — layout is fully managed here.
 *
 * Anti-pattern enforced: no jspdf, no canvas2pdf, no third-party libs.
 *
 * Usage:
 *   <PrintLayout ref={printRef} doc={invoiceData} type="Invoice" company={companyInfo} />
 *
 * Then call triggerPrint() from usePrint() to invoke window.print().
 */

import React, { forwardRef } from "react";

// ─── Shared document types ────────────────────────────────────────────────────
export type PrintDocType = "Invoice" | "DeliveryOrder" | "PurchaseOrder" | "Receipt" | "SampleDO";

export interface PrintLineItem {
  no:           number;
  description:  string;
  sku?:         string;
  qty:          number;
  unitPrice?:   number;   // hidden for Logistics / DO
  amount?:      number;   // hidden for Logistics / DO
}

export interface PrintParty {
  label:    string;   // "Bill To" | "Ship To" | "Supplier"
  name:     string;
  address?: string;
  contact?: string;
  email?:   string;
  ssm?:     string;
}

export interface PrintDocData {
  docNumber:       string;       // e.g. "240601-0001"
  date:            string;       // formatted display date
  dueDate?:        string;
  status?:         string;
  currency?:       string;       // default "MYR"
  parties:         PrintParty[];
  items:           PrintLineItem[];
  subtotal?:       number;
  discount?:       number;
  deliveryCharge?: number;
  total?:          number;
  notes?:          string;
  terms?:          string;
  isDraft?:        boolean;
  isSample?:       boolean;
  signatureBase64?: string;     // e-POD signature image
}

// ─── Company info (passed from caller, fetched from company_settings) ─────────
export interface CompanyInfo {
  name:     string;
  regNo?:   string;
  address?: string;
  phone?:   string;
  email?:   string;
  website?: string;
  logoUrl?: string;
}

// ─── Fallback constants (used when company prop is not yet loaded) ─────────────
const COMPANY_FALLBACK: CompanyInfo = {
  name:    "MediGlove Supply Sdn. Bhd.",
  regNo:   "",
  address: "",
  phone:   "",
  email:   "",
  website: "",
};

// ─── Component ────────────────────────────────────────────────────────────────
interface PrintLayoutProps {
  doc:          PrintDocData;
  type:         PrintDocType;
  /** Show unit prices and amounts (false for DO and Logistics role) */
  showPricing?: boolean;
  /** Company info from company_settings table. Falls back to placeholder if not provided. */
  company?:     CompanyInfo;
}

const DOC_LABELS: Record<PrintDocType, string> = {
  Invoice:        "TAX INVOICE",
  DeliveryOrder:  "DELIVERY ORDER",
  PurchaseOrder:  "PURCHASE ORDER",
  Receipt:        "OFFICIAL RECEIPT",
  SampleDO:       "SAMPLE DELIVERY ORDER",
};

export const PrintLayout = forwardRef<HTMLDivElement, PrintLayoutProps>(
  ({ doc, type, showPricing = true, company }, ref) => {
    const co       = company ?? COMPANY_FALLBACK;
    const currency = doc.currency ?? "MYR";
    const fmt      = (n: number) =>
      n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const hasSku = doc.items.some((i) => i.sku);

    // Build address string (single line for header, multi-line looks bad on print)
    const companySubLines: string[] = [];
    if (co.regNo)   companySubLines.push(`Reg No: ${co.regNo}`);
    if (co.address) companySubLines.push(co.address);
    const contactParts: string[] = [];
    if (co.phone)   contactParts.push(`Tel: ${co.phone}`);
    if (co.email)   contactParts.push(co.email);
    if (co.website) contactParts.push(co.website);
    if (contactParts.length > 0) companySubLines.push(contactParts.join("  ·  "));

    return (
      <div ref={ref} className="print-area" role="document" aria-label={`${DOC_LABELS[type]} ${doc.docNumber}`}>

        {/* Draft / Sample diagonal watermark */}
        {(doc.isDraft || doc.isSample) && (
          <div className="print-watermark-text">
            {doc.isDraft ? "DRAFT" : "SAMPLE"}
          </div>
        )}

        {/* ── Document Header ──────────────────────────────────── */}
        <div className="print-doc-header">

          {/* Company block — logo or name */}
          <div className="company-block">
            {co.logoUrl ? (
              <img
                src={co.logoUrl}
                alt={co.name}
                style={{ maxHeight: "40pt", maxWidth: "140pt", objectFit: "contain", display: "block", marginBottom: "6pt" }}
              />
            ) : (
              <h1>{co.name}</h1>
            )}
            {companySubLines.length > 0 && (
              <div className="company-sub">
                {companySubLines.map((line, i) => (
                  <React.Fragment key={i}>
                    {line}
                    {i < companySubLines.length - 1 && <br />}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Doc meta block */}
          <div className="doc-meta">
            <div className="doc-title">{DOC_LABELS[type]}</div>
            <div className="doc-number">{doc.docNumber}</div>
            <table style={{ marginTop: "8pt", fontSize: "10pt", width: "100%" }}>
              <tbody>
                <tr>
                  <td style={{ color: "#6b7280", paddingRight: "10pt", whiteSpace: "nowrap" }}>Date</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{doc.date}</td>
                </tr>
                {doc.dueDate && (
                  <tr>
                    <td style={{ color: "#6b7280", whiteSpace: "nowrap" }}>Due Date</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#dc2626" }}>
                      {doc.dueDate}
                    </td>
                  </tr>
                )}
                {doc.status && (
                  <tr>
                    <td style={{ color: "#6b7280", whiteSpace: "nowrap" }}>Status</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`print-badge ${doc.status.toLowerCase()}`}>
                        {doc.status}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Party Grid ───────────────────────────────────────── */}
        {doc.parties.length > 0 && (
          <div className="print-party-grid">
            {doc.parties.map((party, i) => (
              <div key={i} className="party-block">
                <div className="party-label">{party.label}</div>
                <div className="party-name">{party.name}</div>
                {party.ssm && (
                  <div style={{ fontSize: "9pt", color: "#6b7280", marginTop: "2pt" }}>
                    Reg: {party.ssm}
                  </div>
                )}
                {party.address && (
                  <div style={{ fontSize: "9pt", marginTop: "3pt", color: "#374151" }}>
                    {party.address}
                  </div>
                )}
                {party.contact && (
                  <div style={{ fontSize: "9pt", color: "#374151", marginTop: "2pt" }}>
                    Attn: {party.contact}
                  </div>
                )}
                {party.email && (
                  <div style={{ fontSize: "9pt", color: "#374151" }}>
                    {party.email}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Line Items Table ─────────────────────────────────── */}
        <table style={{ marginTop: "10pt" }}>
          <thead>
            <tr>
              <th style={{ width: "26pt" }}>No.</th>
              <th>Description</th>
              {hasSku && <th style={{ width: "64pt" }}>SKU</th>}
              <th className="numeric" style={{ width: "36pt" }}>Qty</th>
              {showPricing && (
                <>
                  <th className="numeric" style={{ width: "68pt" }}>
                    Unit Price ({currency})
                  </th>
                  <th className="numeric" style={{ width: "72pt" }}>
                    Amount ({currency})
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => (
              <tr key={item.no}>
                <td style={{ color: "#6b7280", fontSize: "9.5pt" }}>{item.no}</td>
                <td style={{ fontWeight: 500 }}>{item.description}</td>
                {hasSku && (
                  <td style={{ fontFamily: "monospace", fontSize: "9pt", color: "#374151" }}>
                    {item.sku ?? "—"}
                  </td>
                )}
                <td className="numeric" style={{ fontWeight: 600 }}>{item.qty}</td>
                {showPricing && (
                  <>
                    <td className="numeric">
                      {item.unitPrice != null ? fmt(item.unitPrice) : "—"}
                    </td>
                    <td className="numeric" style={{ fontWeight: 600 }}>
                      {item.amount != null ? fmt(item.amount) : "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>

          {/* Totals block — Invoice / Receipt only */}
          {showPricing && (doc.subtotal != null || doc.total != null) && (
            <tfoot>
              {doc.subtotal != null && (
                <tr className="totals-row">
                  <td colSpan={hasSku ? 4 : 3} style={{ border: "none" }} />
                  <td style={{ textAlign: "right", color: "#6b7280" }}>Subtotal</td>
                  <td className="numeric">{fmt(doc.subtotal)}</td>
                </tr>
              )}
              {doc.discount != null && doc.discount > 0 && (
                <tr className="totals-row">
                  <td colSpan={hasSku ? 4 : 3} style={{ border: "none" }} />
                  <td style={{ textAlign: "right", color: "#6b7280" }}>Discount</td>
                  <td className="numeric" style={{ color: "#dc2626" }}>
                    ({fmt(doc.discount)})
                  </td>
                </tr>
              )}
              {doc.deliveryCharge != null && (
                <tr className="totals-row">
                  <td colSpan={hasSku ? 4 : 3} style={{ border: "none" }} />
                  <td style={{ textAlign: "right", color: "#6b7280" }}>Delivery</td>
                  <td className="numeric">
                    {doc.deliveryCharge === 0 ? (
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>FREE</span>
                    ) : (
                      fmt(doc.deliveryCharge)
                    )}
                  </td>
                </tr>
              )}
              {doc.total != null && (
                <tr className="grand-total">
                  <td colSpan={hasSku ? 4 : 3} style={{ border: "none" }} />
                  <td style={{ textAlign: "right" }}>
                    TOTAL ({currency})
                  </td>
                  <td className="numeric">{fmt(doc.total)}</td>
                </tr>
              )}
            </tfoot>
          )}
        </table>

        {/* ── Notes / Terms ────────────────────────────────────── */}
        {(doc.notes || doc.terms) && (
          <div style={{ marginTop: "12pt", fontSize: "9.5pt", borderTop: "0.4pt solid #e5e7eb", paddingTop: "8pt" }}>
            {doc.notes && (
              <div style={{ marginBottom: "4pt" }}>
                <span style={{ fontWeight: 700 }}>Notes: </span>{doc.notes}
              </div>
            )}
            {doc.terms && (
              <div style={{ color: "#6b7280" }}>
                <span style={{ fontWeight: 700 }}>Payment Terms: </span>{doc.terms}
              </div>
            )}
          </div>
        )}

        {/* ── e-POD Signature (Delivery Order only) ───────────── */}
        {doc.signatureBase64 && (
          <div style={{ marginTop: "12pt", borderTop: "0.4pt solid #d1d5db", paddingTop: "8pt" }}>
            <div style={{ fontSize: "9pt", fontWeight: 700, marginBottom: "4pt" }}>
              Recipient Signature (e-POD)
            </div>
            <img
              src={doc.signatureBase64}
              alt="Recipient Signature"
              style={{ height: "44pt", border: "0.6pt solid #d1d5db", display: "block", borderRadius: "2pt" }}
            />
            <div style={{ fontSize: "8pt", color: "#6b7280", marginTop: "3pt" }}>
              Electronically captured at time of delivery. Date: {doc.date}
            </div>
          </div>
        )}

        {/* ── Document Footer ──────────────────────────────────── */}
        <div className="print-doc-footer">
          <div className="print-signature-grid">
            <div className="sig-block">
              Prepared By
              <div style={{ marginTop: "3pt", fontWeight: 700, fontSize: "9.5pt" }}>
                {co.name}
              </div>
            </div>
            <div className="sig-block">
              Authorised Signature
            </div>
            <div className="sig-block">
              Received By
              {(type === "DeliveryOrder" || type === "SampleDO") && (
                <div style={{ marginTop: "3pt", fontSize: "8pt", color: "#9ca3af" }}>
                  Signature &amp; Company Chop
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: "12pt", textAlign: "center", fontSize: "8pt", color: "#9ca3af", borderTop: "0.4pt solid #e5e7eb", paddingTop: "5pt" }}>
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
    );
  }
);

PrintLayout.displayName = "PrintLayout";
