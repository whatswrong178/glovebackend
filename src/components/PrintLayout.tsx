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
 *   <PrintLayout ref={printRef} doc={invoiceData} type="Invoice" />
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
  unitPrice?:   number;   // hidden for Logistics / PO cost
  amount?:      number;   // hidden for Logistics
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
  docNumber:      string;       // e.g. "240601-0001"
  date:           string;       // formatted display date
  dueDate?:       string;
  status?:        string;
  currency?:      string;       // default "MYR"
  parties:        PrintParty[];
  items:          PrintLineItem[];
  subtotal?:      number;
  discount?:      number;
  deliveryCharge?: number;
  total?:         number;
  notes?:         string;
  terms?:         string;
  isDraft?:       boolean;
  isSample?:      boolean;
  signatureBase64?: string;     // e-POD signature image
}

// ─── Company constants (replace with env-driven config in EPIC-09) ──────────
const COMPANY = {
  name:    "MediGlove Supply Sdn. Bhd.",
  regNo:   "202X-XXXXXX-X",
  address: "Unit X, Jalan XX, Taman XX, XXXXX Kuala Lumpur, Malaysia",
  phone:   "+60 X-XXXX XXXX",
  email:   "info@yourdomain.com",
  website: "www.yourdomain.com",
} as const;

// ─── Component ────────────────────────────────────────────────────────────────
interface PrintLayoutProps {
  doc:  PrintDocData;
  type: PrintDocType;
  /** Show unit prices and amounts (hide for Logistics role) */
  showPricing?: boolean;
}

const DOC_LABELS: Record<PrintDocType, string> = {
  Invoice:        "TAX INVOICE",
  DeliveryOrder:  "DELIVERY ORDER",
  PurchaseOrder:  "PURCHASE ORDER",
  Receipt:        "OFFICIAL RECEIPT",
  SampleDO:       "SAMPLE DELIVERY ORDER",
};

export const PrintLayout = forwardRef<HTMLDivElement, PrintLayoutProps>(
  ({ doc, type, showPricing = true }, ref) => {
    const currency = doc.currency ?? "MYR";
    const fmt = (n: number) =>
      n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
          {/* Company block */}
          <div className="company-block">
            <h1>{COMPANY.name}</h1>
            <p style={{ fontSize: "7.5pt", color: "#6b7280", lineHeight: 1.6 }}>
              Reg No: {COMPANY.regNo}<br />
              {COMPANY.address}<br />
              Tel: {COMPANY.phone} | {COMPANY.email}
            </p>
          </div>

          {/* Doc meta block */}
          <div className="doc-meta">
            <div className="doc-title">{DOC_LABELS[type]}</div>
            <div className="doc-number"># {doc.docNumber}</div>
            <table style={{ marginTop: "6pt", fontSize: "8pt", width: "100%" }}>
              <tbody>
                <tr>
                  <td style={{ color: "#6b7280", paddingRight: "8pt" }}>Date:</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{doc.date}</td>
                </tr>
                {doc.dueDate && (
                  <tr>
                    <td style={{ color: "#6b7280" }}>Due Date:</td>
                    <td style={{ textAlign: "right", fontWeight: 600, color: "#dc2626" }}>
                      {doc.dueDate}
                    </td>
                  </tr>
                )}
                {doc.status && (
                  <tr>
                    <td style={{ color: "#6b7280" }}>Status:</td>
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
                  <div style={{ fontSize: "7.5pt", color: "#6b7280" }}>
                    Reg: {party.ssm}
                  </div>
                )}
                {party.address && (
                  <div style={{ fontSize: "7.5pt", marginTop: "2pt" }}>{party.address}</div>
                )}
                {party.contact && (
                  <div style={{ fontSize: "7.5pt", color: "#374151" }}>
                    Contact: {party.contact}
                  </div>
                )}
                {party.email && (
                  <div style={{ fontSize: "7.5pt", color: "#374151" }}>
                    Email: {party.email}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Line Items Table ─────────────────────────────────── */}
        <table style={{ marginTop: "8pt" }}>
          <thead>
            <tr>
              <th style={{ width: "24pt" }}>No.</th>
              <th>Description</th>
              {doc.items.some((i) => i.sku) && <th style={{ width: "60pt" }}>SKU</th>}
              <th className="numeric" style={{ width: "32pt" }}>Qty</th>
              {showPricing && (
                <>
                  <th className="numeric" style={{ width: "56pt" }}>
                    Unit Price ({currency})
                  </th>
                  <th className="numeric" style={{ width: "64pt" }}>
                    Amount ({currency})
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item) => (
              <tr key={item.no}>
                <td style={{ color: "#6b7280" }}>{item.no}</td>
                <td>{item.description}</td>
                {doc.items.some((i) => i.sku) && (
                  <td style={{ fontFamily: "monospace", fontSize: "7.5pt", color: "#374151" }}>
                    {item.sku ?? "—"}
                  </td>
                )}
                <td className="numeric">{item.qty}</td>
                {showPricing && (
                  <>
                    <td className="numeric">
                      {item.unitPrice != null ? fmt(item.unitPrice) : "—"}
                    </td>
                    <td className="numeric">
                      {item.amount != null ? fmt(item.amount) : "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>

          {/* Totals block (Invoice / Receipt only) */}
          {showPricing && (doc.subtotal != null || doc.total != null) && (
            <tfoot>
              {doc.subtotal != null && (
                <tr className="totals-row">
                  <td colSpan={doc.items.some((i) => i.sku) ? 4 : 3} />
                  <td style={{ textAlign: "right", color: "#6b7280" }}>Subtotal</td>
                  <td className="numeric">{fmt(doc.subtotal)}</td>
                </tr>
              )}
              {doc.discount != null && doc.discount > 0 && (
                <tr className="totals-row">
                  <td colSpan={doc.items.some((i) => i.sku) ? 4 : 3} />
                  <td style={{ textAlign: "right", color: "#6b7280" }}>Discount</td>
                  <td className="numeric" style={{ color: "#dc2626" }}>
                    ({fmt(doc.discount)})
                  </td>
                </tr>
              )}
              {doc.deliveryCharge != null && (
                <tr className="totals-row">
                  <td colSpan={doc.items.some((i) => i.sku) ? 4 : 3} />
                  <td style={{ textAlign: "right", color: "#6b7280" }}>Delivery</td>
                  <td className="numeric">
                    {doc.deliveryCharge === 0 ? (
                      <span style={{ color: "#16a34a" }}>FREE</span>
                    ) : (
                      fmt(doc.deliveryCharge)
                    )}
                  </td>
                </tr>
              )}
              {doc.total != null && (
                <tr className="grand-total">
                  <td colSpan={doc.items.some((i) => i.sku) ? 4 : 3} />
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
          <div style={{ marginTop: "10pt", fontSize: "7.5pt" }}>
            {doc.notes && (
              <div style={{ marginBottom: "4pt" }}>
                <span style={{ fontWeight: 600 }}>Notes: </span>{doc.notes}
              </div>
            )}
            {doc.terms && (
              <div style={{ color: "#6b7280" }}>
                <span style={{ fontWeight: 600 }}>Payment Terms: </span>{doc.terms}
              </div>
            )}
          </div>
        )}

        {/* ── e-POD Signature (Delivery Order only) ───────────── */}
        {doc.signatureBase64 && (
          <div style={{ marginTop: "10pt", borderTop: "0.4pt solid #d1d5db", paddingTop: "6pt" }}>
            <div style={{ fontSize: "7.5pt", fontWeight: 600, marginBottom: "3pt" }}>
              Recipient Signature (e-POD)
            </div>
            <img
              src={doc.signatureBase64}
              alt="Recipient Signature"
              style={{ height: "40pt", border: "0.4pt solid #d1d5db", display: "block" }}
            />
            <div style={{ fontSize: "7pt", color: "#6b7280", marginTop: "2pt" }}>
              Electronically captured at time of delivery. Date: {doc.date}
            </div>
          </div>
        )}

        {/* ── Document Footer ──────────────────────────────────── */}
        <div className="print-doc-footer">
          <div className="print-signature-grid">
            <div className="sig-block">
              Prepared By
              <div style={{ marginTop: "2pt", fontWeight: 600, fontSize: "8pt" }}>
                {COMPANY.name}
              </div>
            </div>
            <div className="sig-block">
              Authorised By
            </div>
            <div className="sig-block">
              Received By
              {type === "DeliveryOrder" || type === "SampleDO" ? (
                <div style={{ marginTop: "2pt", fontSize: "7pt", color: "#9ca3af" }}>
                  Signature & Chop
                </div>
              ) : null}
            </div>
          </div>

          <div style={{
            marginTop: "10pt",
            textAlign: "center",
            fontSize: "7pt",
            color: "#9ca3af",
            borderTop: "0.4pt solid #e5e7eb",
            paddingTop: "4pt"
          }}>
            This is a computer-generated document. No signature is required unless stated above.
            <br />
            {COMPANY.name} | {COMPANY.phone} | {COMPANY.email} | {COMPANY.website}
          </div>
        </div>
      </div>
    );
  }
);

PrintLayout.displayName = "PrintLayout";
