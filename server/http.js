import { AppError } from "./lib/errors.js";

/** Shared response helpers for the Netlify Functions (web-standard Request/Response). */

export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function noContent() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}

/** Map any thrown value to a safe JSON error response (never leaks internals). */
export function errorResponse(err, fallbackCode = "E_INTERNAL") {
  if (err instanceof AppError) {
    return json(err.toJSON(), err.status);
  }
  console.error("[unhandled]", err);
  return json(
    { ok: false, error: { code: fallbackCode, message: "Something went wrong while processing that request." } },
    500,
  );
}

/** Read a JSON body with a hard size cap. */
export async function readJsonBody(request, maxBytes = 4096) {
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new AppError("E_BAD_REQUEST", "Request body is too large.", { status: 413 });
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new AppError("E_BAD_REQUEST", "Request body must be valid JSON.", { status: 400 });
  }
}

/** Suggest a safe download filename from a title + container. */
export function suggestedFilename(title, container) {
  const ext =
    container === "m3u8" ? ".m3u8" :
    container === "mp4" ? ".mp4" :
    container === "webm" ? ".webm" :
    container === "mov" ? ".mov" :
    container === "mkv" ? ".mkv" :
    container === "mpd" ? ".mpd" :
    container === "ts" ? ".ts" : "";
  const base = String(title || "video")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, "");
  return `${base || "video"}${ext}`;
}
