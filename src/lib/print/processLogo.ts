/**
 * processLogoForPrint
 *
 * Takes a logo image URL (e.g. dark-background PNG) and returns a new
 * base64 PNG data URL suitable for printing on white paper:
 *
 *  1. Removes black/near-black background pixels  → transparent
 *  2. Darkens remaining logo content              → readable on white in B&W
 *  3. Boosts dim/light pixels (e.g. tagline text) → force to near-black
 *
 * Works entirely in-browser via <canvas>. No server round-trip needed.
 * Falls back to plain toDataUrl() if CORS blocks canvas pixel read.
 */
import { toDataUrl } from "./toDataUrl";

export async function processLogoForPrint(url: string): Promise<string> {
  try {
    // ── 1. Load image ──────────────────────────────────────────────────────────
    const img = new Image();
    img.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      img.onload  = () => resolve();
      img.onerror = () => reject(new Error(`Cannot load logo: ${url}`));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width  = img.naturalWidth  || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return toDataUrl(url); // fallback — canvas not supported
    ctx.drawImage(img, 0, 0);

    // ── 2. Pixel manipulation ──────────────────────────────────────────────────
    // May throw SecurityError if CORS not allowed → caught below
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = imageData.data;

    const BG_MAX   = 45;   // pixels darker than this luma → background (erase)
    const EDGE_MAX = 90;   // transition zone → fade out smoothly

    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];

      // Perceptual luminance (0–255)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      if (lum <= BG_MAX) {
        // Pure background → fully transparent
        px[i + 3] = 0;

      } else if (lum <= EDGE_MAX) {
        // Anti-aliased edge → partial transparency
        const alpha = Math.round(255 * (lum - BG_MAX) / (EDGE_MAX - BG_MAX));
        px[i + 3] = alpha;
        // Darken edge pixels so they look clean on white
        px[i]     = Math.round(r * 0.25);
        px[i + 1] = Math.round(g * 0.25);
        px[i + 2] = Math.round(b * 0.25);

      } else {
        // Logo content — darken significantly for B&W legibility.
        // Light pixels (tagline, fine details) are forced very dark.
        // Darker pixels (navy text, lines) stay near-black.
        const factor = lum > 180
          ? 0.08   // light/gold content  → near-black
          : lum > 100
            ? 0.15 // mid-tone content   → dark
            : 0.25; // already-dark content → keep slightly lighter

        px[i]     = Math.round(r * factor);
        px[i + 1] = Math.round(g * factor);
        px[i + 2] = Math.round(b * factor);
        // alpha stays 255 (fully opaque)
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");

  } catch {
    // CORS or canvas security error — fall back to plain base64 fetch
    return toDataUrl(url);
  }
}
