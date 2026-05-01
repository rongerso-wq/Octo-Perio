/* OctoPerio Phase 7C — Cloud opt-in radiographic analysis.
 *
 * Vercel Edge function that proxies a user-supplied X-ray image to Anthropic's
 * Claude Vision API and returns a structured JSON parse of periodontal
 * findings. The client only ever talks to this same-origin endpoint — the
 * Anthropic API key never reaches the browser.
 *
 * Privacy contract (matches the per-image consent UI):
 *   - The function reads the request body once, forwards the image to
 *     api.anthropic.com, and returns the parsed result. It never logs the
 *     image bytes, never echoes the API key, and never persists anything.
 *   - Patient identifiers must be redacted from the file by the clinician
 *     before upload — there is no server-side de-identification.
 *
 * Hard caps (defense-in-depth on top of the client-side cap):
 *   - Method: POST only
 *   - Content-Type: application/json
 *   - mediaType: image/jpeg or image/png
 *   - imageBase64.length: <= ~7M chars (≈5MB binary, fits Vercel Edge body
 *     limit; client always downscales to JPEG ≤1280px before posting).
 *
 * Model: claude-sonnet-4-6 (cost/latency balanced; can swap to opus-4-7 if
 * concordance gaps appear in the field). max_tokens deliberately small —
 * the response schema is tight.
 */

export const config = { runtime: 'edge' };

const MAX_BASE64_CHARS = 7_000_000;
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png']);
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const PROMPT_HE = `אתה רנטגנולוג שיניים מומחה בפריודונטולוגיה. עליך לנתח את הצילום ולהחזיר JSON תקני בלבד — בלי הקדמה, בלי טקסט נלווה, בלי code fences.

הסכמה:
{
  "rblEstimate": <מספר 0-100, הערכת %RBL חציונית>,
  "worstSiteRbl": <מספר 0-100, %RBL באתר החמור ביותר>,
  "vblEstimate": <מספר 0-15, אובדן עצם אנכי במ"מ באתר החמור>,
  "confidence": "low" | "med" | "high",
  "caries": [<שם שן בFDI או תיאור קצר>...],
  "periapical": [<שם שן בFDI או תיאור קצר>...],
  "calculus": [<תיאור קצר של מיקום אבן>...],
  "notes": "<משפט קצר לקלינאי, עברית, ללא PII>"
}

אם משהו לא ניתן להעריך — החזר null עבור השדה הספציפי. הימנע מהמצאות. ביטחון low אם הצילום באיכות נמוכה.`;

const PROMPT_EN = `You are a dental radiologist with periodontology expertise. Analyze this radiograph and return ONLY valid JSON — no prose, no explanation, no code fences.

Schema:
{
  "rblEstimate": <number 0-100, median %RBL estimate>,
  "worstSiteRbl": <number 0-100, %RBL at the most affected site>,
  "vblEstimate": <number 0-15, vertical bone loss in mm at worst site>,
  "confidence": "low" | "med" | "high",
  "caries": [<FDI tooth number or short description>, ...],
  "periapical": [<FDI tooth number or short description>, ...],
  "calculus": [<short location description>, ...],
  "notes": "<one short sentence for the clinician, English, no PII>"
}

Use null for any field you cannot reliably estimate. No hallucinations. confidence=low if image quality is poor.`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function clampNumber(v, min, max) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function clampStringArray(v, max = 12) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => typeof s === 'string' || typeof s === 'number')
    .map((s) => String(s).slice(0, 80))
    .slice(0, max);
}

function sanitizeResult(parsed) {
  /* Defense-in-depth: even if the model returns garbage, the client only ever
     sees a known-good shape. Out-of-range numbers clamp; non-arrays become
     []; the notes field caps at 240 chars. */
  if (!parsed || typeof parsed !== 'object') return null;
  const conf = ['low', 'med', 'high'].includes(parsed.confidence) ? parsed.confidence : 'low';
  return {
    rblEstimate: clampNumber(parsed.rblEstimate, 0, 100),
    worstSiteRbl: clampNumber(parsed.worstSiteRbl, 0, 100),
    vblEstimate: clampNumber(parsed.vblEstimate, 0, 20),
    confidence: conf,
    caries: clampStringArray(parsed.caries),
    periapical: clampStringArray(parsed.periapical),
    calculus: clampStringArray(parsed.calculus),
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 240) : '',
    source: 'cloud',
  };
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'not_configured' }, 503);
  }

  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    return jsonResponse({ error: 'bad_content_type' }, 415);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad_json' }, 400);
  }

  const { imageBase64, mediaType, lang } = body || {};
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return jsonResponse({ error: 'no_image' }, 400);
  }
  if (imageBase64.length > MAX_BASE64_CHARS) {
    return jsonResponse({ error: 'image_too_large' }, 413);
  }
  if (!ALLOWED_MEDIA.has(mediaType)) {
    return jsonResponse({ error: 'bad_media_type' }, 415);
  }

  const prompt = lang === 'he' ? PROMPT_HE : PROMPT_EN;

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });
  } catch {
    return jsonResponse({ error: 'upstream_unreachable' }, 502);
  }

  if (!upstream.ok) {
    /* Surface the upstream status code without leaking the response body —
       Anthropic error responses can include the prompt and we don't want
       that round-tripping back to the browser. */
    return jsonResponse({ error: 'upstream_error', status: upstream.status }, 502);
  }

  let upstreamJson;
  try {
    upstreamJson = await upstream.json();
  } catch {
    return jsonResponse({ error: 'upstream_bad_json' }, 502);
  }

  const text =
    Array.isArray(upstreamJson?.content) && upstreamJson.content[0]?.text
      ? String(upstreamJson.content[0].text)
      : '';

  let parsed = null;
  try {
    /* The prompt asks for raw JSON, but models occasionally still wrap in
       ```json … ``` fences or leading prose — match the first { … } block. */
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    parsed = null;
  }

  const clean = sanitizeResult(parsed);
  if (!clean) {
    return jsonResponse({ error: 'unparseable' }, 502);
  }

  return jsonResponse(clean, 200);
}
