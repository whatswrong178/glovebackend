/**
 * usePrint — Global Print Hook (T-01.3)
 *
 * Provides:
 *   - printRef: attach to any printable container
 *   - triggerPrint(): prepares DOM, calls window.print(), then restores
 *   - isPrinting: boolean (debounce guard — disables button during print)
 *
 * Anti-pattern enforced: this hook NEVER calls jspdf or any PDF library.
 * All rendering is via the browser's native print engine.
 *
 * Usage:
 *   const { printRef, triggerPrint, isPrinting } = usePrint();
 *   <div ref={printRef} className="print-area"> ... </div>
 *   <button onClick={triggerPrint} disabled={isPrinting}>Print</button>
 */

import { useRef, useState, useCallback } from "react";

interface UsePrintOptions {
  /** Document title shown in browser print dialog. Defaults to current page title. */
  documentTitle?: string;
  /** Called just before window.print() fires. Use to finalise last-minute state. */
  onBeforePrint?: () => void | Promise<void>;
  /** Called after the print dialog is dismissed (always fires, success or cancel). */
  onAfterPrint?: () => void;
}

interface UsePrintReturn {
  printRef:     React.RefObject<HTMLDivElement>;
  triggerPrint: () => Promise<void>;
  isPrinting:   boolean;
}

export function usePrint(options: UsePrintOptions = {}): UsePrintReturn {
  const { documentTitle, onBeforePrint, onAfterPrint } = options;
  const printRef   = useRef<HTMLDivElement>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const triggerPrint = useCallback(async () => {
    if (isPrinting) return;  // debounce guard
    setIsPrinting(true);

    // ── 1. Save & override document title ────────────────────────────────────
    const originalTitle = document.title;
    if (documentTitle) {
      document.title = documentTitle;
    }

    // ── 2. Before-print callback (e.g. fetch last-minute data) ───────────────
    if (onBeforePrint) {
      await onBeforePrint();
    }

    // ── 3. Register afterprint listener BEFORE calling print() ───────────────
    const handleAfterPrint = () => {
      document.title = originalTitle;
      setIsPrinting(false);
      onAfterPrint?.();
      window.removeEventListener("afterprint", handleAfterPrint);
    };
    window.addEventListener("afterprint", handleAfterPrint);

    // ── 4. Small tick so React can flush pending state ────────────────────────
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // ── 5. Fire native print ──────────────────────────────────────────────────
    window.print();

    // Fallback: if afterprint never fires (some browsers), clean up after 10s
    const fallbackTimer = setTimeout(() => {
      document.title = originalTitle;
      setIsPrinting(false);
      window.removeEventListener("afterprint", handleAfterPrint);
    }, 10_000);

    window.addEventListener("afterprint", () => clearTimeout(fallbackTimer), { once: true });
  }, [isPrinting, documentTitle, onBeforePrint, onAfterPrint]);

  return { printRef, triggerPrint, isPrinting };
}
