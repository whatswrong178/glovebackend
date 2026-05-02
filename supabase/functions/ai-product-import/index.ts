// ══════════════════════════════════════════════════════════════════════════════
// supabase/functions/ai-product-import/index.ts
// MediGlove ERP · EPIC-03 / T-03.1 — Gemini 1.5 Flash AI Product Parser
//
// Endpoint: POST /functions/v1/ai-product-import
// Auth:     Supabase JWT required (Admin only — enforced inside function)
//
// Request:  multipart/form-data
//   file    — binary: supplier PDF or image (JPEG/PNG/WEBP/HEIC)
//
// Response 200: { products: ExtractedProduct[], rawText: string }
// Response 400: { error: string }
// Response 403: { error: "Admin only" }
// Response 500: { error: string }
//
// Gemini API: generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash
// Env vars:   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractedProduct {
  name:              string;
  sku:               string;
  cost_price:        number | null;
  min_selling_price: number | null;
  suggested_price:   number | null;
  description:       string;
  confidence:        "high" | "medium" | "low";
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
}

interface GeminiRequest {
  contents: Array<{
    parts: GeminiPart[];
  }>;
  generationConfig: {
    temperature:     number;
    maxOutputTokens: number;
    responseMimeType: string;
  };
}

// ── CORS headers ──────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// ── Utility: uint8Array → base64 (chunked — avoids OOM on large files) ───────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 32768; // 32 KB per chunk — keeps peak heap low
  const parts: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}

// ── Utility: detect MIME type from file header bytes ─────────────────────────

function detectMimeType(bytes: Uint8Array): string {
  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return "image/png";
  }
  // WEBP: RIFF....WEBP
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return "image/webp";
  }
  // Fallback
  return "application/octet-stream";
}

// ── Gemini extraction prompt ──────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a precise data extraction assistant for a medical supply company ERP system.

Analyze the provided supplier document (PDF or image) and extract ALL product/item entries.

Return a JSON object with this exact structure:
{
  "products": [
    {
      "name": "Full product name as written",
      "sku": "Product code or SKU (generate a reasonable slug like 'PROD-001' if not present)",
      "cost_price": 12.50,
      "min_selling_price": null,
      "suggested_price": null,
      "description": "Any additional details, specifications, or notes about this product",
      "confidence": "high"
    }
  ],
  "rawText": "Brief summary of what document type was detected and total items found"
}

Rules:
1. Extract EVERY product line item — do not summarize or skip any.
2. cost_price: extract the supplier/purchase price if visible. Use null if not found.
3. min_selling_price and suggested_price: leave as null — Admin will fill these in.
4. sku: use the supplier's product code if available; otherwise generate "AUTO-{n}" where n is 1-based index.
5. confidence: "high" if name+price both found, "medium" if name only, "low" if ambiguous.
6. All prices must be numeric (no currency symbols). Use Malaysian Ringgit values as-is.
7. Return ONLY valid JSON — no markdown, no explanation outside the JSON.`;

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Auth: validate JWT + Admin role ────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Check Admin role
  const { data: staffRow, error: staffError } = await supabase
    .from("staff")
    .select("role")
    .eq("auth_user_id", user.id)
    .single();

  if (staffError || staffRow?.role !== "Admin") {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Parse multipart form ────────────────────────────────────────────────────
  let fileBytes: Uint8Array;
  let mimeType: string;

  try {
    const contentType = req.headers.get("Content-Type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const fileField = formData.get("file");

      if (!fileField || typeof fileField === "string") {
        return new Response(JSON.stringify({ error: "No file field in form data" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      const blob = fileField as File;
      const arrayBuf = await blob.arrayBuffer();
      fileBytes = new Uint8Array(arrayBuf);
      mimeType = blob.type || detectMimeType(fileBytes);
    } else {
      // Raw binary body (Content-Type from header)
      const arrayBuf = await req.arrayBuffer();
      fileBytes = new Uint8Array(arrayBuf);
      mimeType = contentType || detectMimeType(fileBytes);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to read file: ${(err as Error).message}` }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Validate supported MIME
  const SUPPORTED_MIMES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ];

  if (!SUPPORTED_MIMES.includes(mimeType)) {
    return new Response(
      JSON.stringify({ error: `Unsupported file type: ${mimeType}. Supported: PDF, JPEG, PNG, WEBP, HEIC` }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // File size guard: Gemini free tier limit ~20MB inline
  const MAX_BYTES = 20 * 1024 * 1024;
  if (fileBytes.byteLength > MAX_BYTES) {
    return new Response(
      JSON.stringify({ error: "File too large. Maximum 20 MB." }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ── Call Gemini 1.5 Flash ───────────────────────────────────────────────────
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const base64Data = uint8ArrayToBase64(fileBytes);

  const geminiBody: GeminiRequest = {
    contents: [
      {
        parts: [
          {
            text: EXTRACTION_PROMPT,
          },
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature:      0.1,   // Low temperature for deterministic extraction
      maxOutputTokens:  8192,
      responseMimeType: "application/json",
    },
  };

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(geminiBody),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Gemini API network error: ${(err as Error).message}` }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text();
    return new Response(
      JSON.stringify({ error: `Gemini API error ${geminiResponse.status}: ${errText}` }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ── Parse Gemini response ───────────────────────────────────────────────────
  let geminiJson: unknown;
  try {
    geminiJson = await geminiResponse.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to parse Gemini response as JSON" }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Extract the generated text from Gemini's response envelope
  type GeminiApiResponse = {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const geminiData = geminiJson as GeminiApiResponse;
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  if (!rawText) {
    return new Response(
      JSON.stringify({ error: "Gemini returned empty response", products: [] }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Parse the JSON content Gemini produced
  let extracted: { products: ExtractedProduct[]; rawText: string };
  try {
    // Gemini may wrap in markdown code fences — strip them
    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    extracted = JSON.parse(cleaned);
  } catch {
    return new Response(
      JSON.stringify({
        error: "Gemini response was not valid JSON",
        rawText,
        products: [],
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Sanitize: ensure each product has required fields
  const sanitized: ExtractedProduct[] = (extracted.products ?? []).map(
    (p, i) => ({
      name:              String(p.name ?? `Product ${i + 1}`).trim(),
      sku:               String(p.sku  ?? `AUTO-${String(i + 1).padStart(3, "0")}`).trim(),
      cost_price:        typeof p.cost_price === "number" ? p.cost_price : null,
      min_selling_price: typeof p.min_selling_price === "number" ? p.min_selling_price : null,
      suggested_price:   typeof p.suggested_price === "number" ? p.suggested_price : null,
      description:       String(p.description ?? "").trim(),
      confidence:        (["high", "medium", "low"].includes(p.confidence))
                           ? p.confidence
                           : "medium",
    })
  );

  return new Response(
    JSON.stringify({
      products:  sanitized,
      rawText:   extracted.rawText ?? `Extracted ${sanitized.length} products`,
      fileSize:  fileBytes.byteLength,
      mimeType,
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
