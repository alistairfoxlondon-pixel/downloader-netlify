/** Client-side API helpers + formatting utilities. */

async function parseJsonSafe(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, data };
}

export async function fetchConfig(signal) {
  const res = await fetch("/api/config", { signal });
  const { data } = await parseJsonSafe(res);
  if (!res.ok || !data?.ok) {
    throw Object.assign(new Error(data?.error?.message || "Failed to load configuration"), {
      code: data?.error?.code || "E_CONFIG",
    });
  }
  return data;
}

export async function extractVideo(url, signal) {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  const { data } = await parseJsonSafe(res);
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.error?.message || `Request failed (HTTP ${res.status}).`);
    err.code = data?.error?.code || "E_INTERNAL";
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function createConversionJob({ url, name, referer }) {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, name, referer }),
  });
  const { data } = await parseJsonSafe(res);
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.error?.message || "Could not start conversion.");
    err.code = data?.error?.code || "E_WORKER";
    throw err;
  }
  return data;
}

export async function getConversionJob(id) {
  const res = await fetch(`/api/jobs?id=${encodeURIComponent(id)}`);
  const { data } = await parseJsonSafe(res);
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.error?.message || "Could not read conversion status.");
    err.code = data?.error?.code || "E_WORKER";
    throw err;
  }
  return data;
}

/** Build the final media URL (download = forces file behaviour when proxied). */
export function mediaHref(source, { download = false, mode } = {}) {
  const base = download ? source.downloadUrl : source.previewUrl;
  const u = new URL(base, window.location.origin);
  if (download) u.searchParams.set("dl", "1");
  if (mode) u.searchParams.set("mode", mode);
  return `${u.pathname}${u.search}`;
}

/** Trigger a same-origin download navigation for a signed media URL. */
export function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename; // same-origin: honoured for proxied responses
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function formatBytes(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const num = Number(n);
  if (num < 1024) return `${num} B`;
  if (num < 1024 ** 2) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 ** 3) return `${(num / 1024 ** 2).toFixed(1)} MB`;
  return `${(num / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Human titles for API error codes (message from server stays primary). */
export const ERROR_HINTS = {
  E_BAD_URL: "Check the link — it must be a full http(s) URL such as https://example.com/video.mp4",
  E_UNSUPPORTED_HOST: "That domain is not supported yet.",
  E_NO_MEDIA: "Try a direct .mp4 or .m3u8 link, or a page that embeds the video.",
  E_EXTRACT_FAILED: "The site responded, but its player layout did not expose a media link.",
  E_UPSTREAM: "The source site is unreachable or returned an unexpected response.",
  E_TIMEOUT: "The source site is slow or blocking automated requests — try again in a moment.",
  E_NOT_FOUND: "The source page no longer exists.",
  E_RATE_LIMITED: "You are extracting too quickly — wait for the cooldown and retry.",
  E_DRM: "DRM-protected streams are never downloaded by this service.",
  E_NO_WORKER: "Enable the conversion service (MEDIA_WORKER_URL) to use this feature.",
  E_TOKEN_EXPIRED: "Links are short-lived for safety — fetch the video again to refresh them.",
  E_ACCESS_DENIED: "The media host rejected the request — the link may be IP-bound or expired.",
  E_MEDIA_GONE: "The media file no longer exists upstream.",
  E_FORBIDDEN_HOST: "For security, local/internal addresses cannot be fetched.",
  E_INTERNAL: "Unexpected server error — please try again.",
};

export function normalizeError(err) {
  return {
    code: err?.code || "E_INTERNAL",
    message: err?.message || "Something went wrong.",
    hint: ERROR_HINTS[err?.code] || null,
  };
}
