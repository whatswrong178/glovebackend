/**
 * SecurityShield — T-01.2 Anti-Leak System
 *
 * Three layers of protection:
 * 1. Dynamic canvas watermark (employee ID + name + timestamp, low opacity)
 * 2. window.onblur / visibilitychange → full-screen Gaussian blur
 * 3. Disable right-click, PrintScreen key, and drag-to-copy on the document
 */
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useGetIdentity } from "@refinedev/core";

interface StaffIdentity {
  id:    string;
  name:  string;
  role:  string;
}

interface SecurityShieldProps {
  children: ReactNode;
}

export function SecurityShield({ children }: SecurityShieldProps) {
  const { data: identity } = useGetIdentity<StaffIdentity>();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const [blurred, setBlurred] = useState(false);

  // ── 1. Render watermark on canvas ─────────────────────────────────────────
  const renderWatermark = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !identity) return;

    const ctx  = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width  = window.innerWidth;
    const H = canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    const text = `${identity.name}  •  ID:${identity.id.slice(0, 8).toUpperCase()}  •  ${new Date().toLocaleString("en-MY")}`;

    ctx.font      = "13px Inter, sans-serif";
    ctx.fillStyle = "#1e3a8a";
    ctx.textAlign = "center";

    // Tile the watermark diagonally across the entire viewport
    const tileW = 420;
    const tileH = 160;

    for (let x = -tileW; x < W + tileW; x += tileW) {
      for (let y = -tileH; y < H + tileH; y += tileH) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 6);   // –30° diagonal
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  }, [identity]);

  useEffect(() => {
    // Re-render watermark whenever the identity changes
    renderWatermark();

    const handleResize = () => renderWatermark();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [renderWatermark]);

  // Refresh timestamp on the watermark every 60 seconds
  useEffect(() => {
    const timer = setInterval(renderWatermark, 60_000);
    return () => clearInterval(timer);
  }, [renderWatermark]);

  // ── 2. Blur shield on focus loss / tab switch / recording detection ────────
  useEffect(() => {
    const applyBlur   = () => setBlurred(true);
    const removeBlur  = () => setBlurred(false);

    // Window loses focus (alt-tab, screen-record capture starting)
    window.addEventListener("blur", applyBlur);
    window.addEventListener("focus", removeBlur);

    // Page visibility API (switching browser tabs)
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") applyBlur();
      else removeBlur();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("blur", applyBlur);
      window.removeEventListener("focus", removeBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // ── 3. Disable right-click, PrintScreen, drag-to-copy ─────────────────────
  useEffect(() => {
    // Right-click context menu
    const blockContext = (e: MouseEvent) => e.preventDefault();

    // Keyboard: block PrintScreen (keyCode 44) and Ctrl+P
    const blockKeys = (e: KeyboardEvent) => {
      if (
        e.key === "PrintScreen" ||
        (e.ctrlKey && e.key === "p") ||
        (e.metaKey && e.key === "p")
      ) {
        e.preventDefault();
        // Trigger blur as extra deterrent when PrintScreen is pressed
        setBlurred(true);
        setTimeout(() => setBlurred(false), 2000);
      }
    };

    // Prevent native drag-select copy of sensitive text
    const blockDragStart = (e: DragEvent) => e.preventDefault();

    document.addEventListener("contextmenu", blockContext);
    document.addEventListener("keydown",     blockKeys);
    document.addEventListener("dragstart",   blockDragStart);

    return () => {
      document.removeEventListener("contextmenu", blockContext);
      document.removeEventListener("keydown",     blockKeys);
      document.removeEventListener("dragstart",   blockDragStart);
    };
  }, []);

  return (
    <>
      {/* Watermark canvas — pointer-events: none so it never blocks UI */}
      <canvas
        ref={canvasRef}
        className="watermark-overlay"
        aria-hidden="true"
      />

      {/* Main content with conditional blur */}
      <div className={blurred ? "blur-shield" : undefined}>
        {children}
      </div>

      {/* Blur overlay message (shown when blurred) */}
      {blurred && (
        <div
          className="fixed inset-0 z-[10000] flex flex-col items-center justify-center
                     bg-gray-900/80 text-white select-none"
          aria-live="polite"
        >
          <p className="text-2xl font-bold tracking-tight">🔒 Screen Protected</p>
          <p className="mt-2 text-sm text-gray-300">
            Click anywhere or switch back to this tab to resume.
          </p>
        </div>
      )}
    </>
  );
}
