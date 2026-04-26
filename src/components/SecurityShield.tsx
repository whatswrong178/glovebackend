/**
 * SecurityShield — T-01.2 Anti-Leak System + Idle Session Guard
 *
 * Four layers of protection:
 * 1. Dynamic canvas watermark (employee ID + name + timestamp, low opacity)
 * 2. window.onblur / visibilitychange → full-screen Gaussian blur
 * 3. Disable right-click, PrintScreen key, and drag-to-copy on the document
 * 4. Idle timeout: 30 minutes of no activity → force logout with 60s countdown warning
 */
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useGetIdentity } from "@refinedev/core";
import { supabaseClient } from "../supabaseClient";

interface StaffIdentity {
  id:    string;
  name:  string;
  role:  string;
}

interface SecurityShieldProps {
  children: ReactNode;
}

// ─── Idle timeout constants ────────────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;              // 30 minutes → sign out
const WARN_AT_MS      = IDLE_TIMEOUT_MS - 60 * 1000; // warn 1 minute before

// Activity events that reset the idle timer
const ACTIVITY_EVENTS: (keyof DocumentEventMap)[] = [
  "mousemove", "mousedown", "keydown", "touchstart", "scroll", "click",
];

export function SecurityShield({ children }: SecurityShieldProps) {
  const { data: identity } = useGetIdentity<StaffIdentity>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [blurred,      setBlurred]      = useState(false);
  const [showIdleWarn, setShowIdleWarn] = useState(false);
  const [countdown,    setCountdown]    = useState(60);

  // Use refs so callbacks never go stale and avoid re-render storms
  const idleTimerRef       = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const warnTimerRef       = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const countdownRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Force sign-out ────────────────────────────────────────────────────────
  const forceSignOut = useCallback(async () => {
    setShowIdleWarn(false);
    await supabaseClient.auth.signOut();
    // Hard redirect — clears all React state, lands on login
    window.location.replace("/login");
  }, []);

  // ── Reset / restart idle timers ───────────────────────────────────────────
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current)   clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current)   clearTimeout(warnTimerRef.current);
    if (countdownRef.current)   clearInterval(countdownRef.current);

    setShowIdleWarn(false);
    setCountdown(60);

    // Warning fires at 29 min
    warnTimerRef.current = setTimeout(() => {
      setShowIdleWarn(true);
      setCountdown(60);

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, WARN_AT_MS);

    // Sign-out fires at 30 min
    idleTimerRef.current = setTimeout(() => {
      forceSignOut();
    }, IDLE_TIMEOUT_MS);
  }, [forceSignOut]);

  // ── Mount/unmount idle listener (only when logged in) ─────────────────────
  useEffect(() => {
    if (!identity?.id) return; // No active session → don't track

    const handler = () => resetIdleTimer();
    ACTIVITY_EVENTS.forEach((evt) =>
      document.addEventListener(evt, handler, { passive: true })
    );
    resetIdleTimer(); // Start on mount

    return () => {
      ACTIVITY_EVENTS.forEach((evt) =>
        document.removeEventListener(evt, handler)
      );
      if (idleTimerRef.current)   clearTimeout(idleTimerRef.current);
      if (warnTimerRef.current)   clearTimeout(warnTimerRef.current);
      if (countdownRef.current)   clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.id]);

  // ── 1. Render watermark on canvas ─────────────────────────────────────────
  const renderWatermark = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !identity) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width  = window.innerWidth;
    const H = canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    const text = `${identity.name}  •  ID:${identity.id.slice(0, 8).toUpperCase()}  •  ${new Date().toLocaleString("en-MY")}`;

    ctx.font      = "13px Inter, sans-serif";
    ctx.fillStyle = "#1e3a8a";
    ctx.textAlign = "center";

    const tileW = 420;
    const tileH = 160;

    for (let x = -tileW; x < W + tileW; x += tileW) {
      for (let y = -tileH; y < H + tileH; y += tileH) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  }, [identity]);

  useEffect(() => {
    renderWatermark();
    const handleResize = () => renderWatermark();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [renderWatermark]);

  useEffect(() => {
    const timer = setInterval(renderWatermark, 60_000);
    return () => clearInterval(timer);
  }, [renderWatermark]);

  // ── 2. Blur shield on focus loss / tab switch ─────────────────────────────
  useEffect(() => {
    const applyBlur  = () => setBlurred(true);
    const removeBlur = () => setBlurred(false);

    window.addEventListener("blur",  applyBlur);
    window.addEventListener("focus", removeBlur);

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") applyBlur();
      else removeBlur();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("blur",  applyBlur);
      window.removeEventListener("focus", removeBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // ── 3. Disable right-click, PrintScreen, drag-to-copy ─────────────────────
  useEffect(() => {
    const blockContext   = (e: MouseEvent)    => e.preventDefault();
    const blockDragStart = (e: DragEvent)     => e.preventDefault();
    const blockKeys      = (e: KeyboardEvent) => {
      if (
        e.key === "PrintScreen" ||
        (e.ctrlKey && e.key === "p") ||
        (e.metaKey && e.key === "p")
      ) {
        e.preventDefault();
        setBlurred(true);
        setTimeout(() => setBlurred(false), 2000);
      }
    };

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

      {/* Main content */}
      <div className={blurred ? "blur-shield" : undefined}>
        {children}
      </div>

      {/* ── Blur overlay (window focus lost) ────────────────────────────── */}
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

      {/* ── Idle timeout warning modal ───────────────────────────────────── */}
      {showIdleWarn && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center
                     bg-gray-900/70 backdrop-blur-sm"
          aria-modal="true"
          role="alertdialog"
          aria-labelledby="idle-warn-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center">
            <div className="text-4xl mb-3">⏱️</div>
            <h2
              id="idle-warn-title"
              className="text-lg font-bold text-gray-900 mb-1"
            >
              Session Expiring
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              You've been inactive. For security, you'll be signed out in:
            </p>

            {/* Countdown */}
            <div className="flex items-center justify-center mb-6">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center
                           border-4 border-red-400 bg-red-50"
              >
                <span className="text-3xl font-bold text-red-600 tabular-nums">
                  {countdown}
                </span>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              <button
                onClick={forceSignOut}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300
                           rounded-lg hover:bg-gray-50 transition-colors"
              >
                Sign Out Now
              </button>
              <button
                onClick={resetIdleTimer}
                autoFocus
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600
                           rounded-lg hover:bg-blue-700 transition-colors"
              >
                I'm Still Here
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
