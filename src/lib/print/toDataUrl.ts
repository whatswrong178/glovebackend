/**
 * toDataUrl — fetch a remote image and return a base64 data URL.
 *
 * Why: window.open("", "_blank") creates a null-origin context. Browsers
 * block cross-origin <img> loads from null-origin pages. Embedding the image
 * as a data URL side-steps the restriction entirely.
 *
 * Also fixes: Supabase Storage may return CORS errors for no-cors img requests
 * from app context while allowing direct-tab navigation.
 */
export async function toDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return url; // fallback: return original URL, let browser try
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => resolve(url); // fallback on error
      reader.readAsDataURL(blob);
    });
  } catch {
    return url; // network error → fallback to original
  }
}
