import { AppError } from "../lib/errors.js";
import { safeFetch, sniffContainer } from "../lib/safehttp.js";
import { parseM3u8, isDrmProtected } from "../lib/hls.js";

/** Parse a human size string like "2.64 MB" into bytes. */
export function sizeTextToBytes(text) {
  if (!text) return null;
  const m = /([\d.,]+)\s*(KB|MB|GB|kB|mb|gb|B)\b/i.exec(String(text));
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  if (Number.isNaN(n)) return null;
  const unit = m[2].toUpperCase();
  const mult = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : unit === "KB" ? 1024 : 1;
  return Math.round(n * mult);
}

/** Absolute URL against a base; returns null when unresolvable. */
export function absolutize(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/** Container -> protocol mapping used across extractors. */
export function protocolOfContainer(container) {
  if (container === "m3u8") return "hls";
  if (container === "mp4" || container === "mov") return "mp4";
  if (container === "webm" || container === "mkv") return "other";
  if (container === "mpd") return "dash";
  if (container === "ts") return "mpegts";
  return "other";
}

export const CONTAINER_EXT = {
  m3u8: ".m3u8",
  mp4: ".mp4",
  mov: ".mov",
  webm: ".webm",
  mkv: ".mkv",
  mpd: ".mpd",
  ts: ".ts",
};

/**
 * Determine container for a media URL: by extension first, then a 2 KB range
 * probe when the extension is missing/ambiguous. Verifies the URL is actually
 * reachable at the same time (status 200/206).
 *
 * With `opts.expectMedia` a response that is really an HTML page (captcha
 * interstitial, “get link” wall, error page…) throws E_NOT_MEDIA instead of
 * being silently classified — callers then fall back to alternative links.
 *
 * @returns {Promise<{container: string, contentType: string|null, totalBytes: number|null,
 *   head: Buffer, supportsRange: boolean, status: number, finalUrl: string}>}
 */
export async function classifyMediaUrl(url, opts = {}) {
  const ext = (url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
  const extGuess =
    ext === "m3u8" ? "m3u8" : ext === "mp4" ? "mp4" : ext === "m4v" ? "mp4" : ext === "mov" ? "mov" :
    ext === "webm" ? "webm" : ext === "mkv" ? "mkv" : ext === "mpd" ? "mpd" : ext === "ts" ? "ts" : null;

  const probe = async ({ withExtraHeaders }) => {
    const res = await safeFetch(url, {
      range: "bytes=0-2047",
      referer: withExtraHeaders ? opts.referer : undefined,
      origin: withExtraHeaders ? opts.origin : undefined,
      timeoutMs: opts.timeoutMs ?? 15000,
      maxBytes: 64 * 1024,
      truncateOk: true, // servers that ignore Range may reply with the full body
      accept: "*/*",
    });
    return res;
  };

  let res = await probe({ withExtraHeaders: true });
  // Some media hosts 403 requests that carry Referer/Origin headers even
  // though a plain browser <video> GET (no Origin, minimal Referer) is served
  // fine. Retry once exactly like the browser would before declaring failure.
  if ((res.status === 403 || res.status === 401) && (opts.referer || opts.origin)) {
    res = await probe({ withExtraHeaders: false });
  }
  if (res.status >= 400) {
    throw new AppError(
      res.status === 403 || res.status === 401 ? "E_ACCESS_DENIED" : "E_MEDIA_UNREACHABLE",
      res.status === 403 || res.status === 401
        ? "The media server denied access to this file (expired or IP-restricted link)."
        : `The media server returned HTTP ${res.status}.`,
      { status: 502, details: { url } },
    );
  }
  const totalFromRange = parseContentRangeTotal(res.headers["content-range"]);
  const totalBytes =
    totalFromRange ??
    (res.status === 200 && res.headers["content-length"] ? Number(res.headers["content-length"]) : null);
  const supportsRange = Boolean(res.headers["content-range"]) || (res.headers["accept-ranges"] || "").includes("bytes");
  const sniffed = sniffContainer(res.body);

  let container = extGuess;
  if (sniffed !== "unknown" && sniffed !== container) {
    // Trust the magic bytes over the extension.
    container = sniffed;
  } else if (!container) {
    const ct = (res.contentType || "").toLowerCase();
    if (ct.includes("mpegurl") || ct.includes("m3u8")) container = "m3u8";
    else if (ct.startsWith("video/mp4")) container = "mp4";
    else if (ct.startsWith("video/webm")) container = "webm";
    else if (ct.includes("dash+xml")) container = "mpd";
    else if (ct.startsWith("video/")) container = "other";
    else container = "unknown";
  }

  // Non-media response detection (HTML walls, captcha pages, tiny error docs).
  const looksLikePage =
    sniffed === "unknown" &&
    (/text\/html|application\/xhtml/i.test(res.contentType || "") ||
      /^\s*<!doctype html|^\s*<html/i.test(res.body.subarray(0, 200).toString("latin1")));
  if (opts.expectMedia && (container === "unknown" || looksLikePage)) {
    throw new AppError(
      "E_NOT_MEDIA",
      `The host returned ${res.contentType || "a non-media response"} instead of video bytes (possible CAPTCHA, IP block or expired link).`,
      { status: 502, details: { httpStatus: res.status, contentType: res.contentType || null } },
    );
  }

  return {
    container,
    contentType: res.headers["content-type"] || null,
    totalBytes,
    head: res.body,
    supportsRange,
    status: res.status,
    finalUrl: res.url,
  };
}

export function parseContentRangeTotal(cr) {
  if (!cr) return null;
  const m = /\/(\d+|\*)$/.exec(cr);
  if (!m || m[1] === "*") return null;
  return Number(m[1]);
}

/**
 * Fetch + parse an HLS playlist, enforcing DRM refusal.
 * Returns { playlist, variants } where variants is [] for media playlists.
 */
export async function fetchAndParseHls(url, opts = {}) {
  const res = await safeFetch(url, {
    referer: opts.referer,
    origin: opts.origin,
    accept: "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*",
    maxBytes: 512 * 1024,
    timeoutMs: opts.timeoutMs ?? 15000,
  });
  if (res.status >= 400) {
    throw new AppError("E_MEDIA_UNREACHABLE", `Could not read the HLS playlist (HTTP ${res.status}).`, {
      status: 502,
      details: { url },
    });
  }
  const text = res.body.toString("utf8");
  let playlist;
  try {
    playlist = parseM3u8(text, res.url);
  } catch (cause) {
    throw new AppError("E_NOT_PLAYLIST", "The URL did not return a valid M3U8 playlist.", { status: 502, cause });
  }
  if (isDrmProtected(playlist) || (playlist.variants || []).some((v) => isDrmProtected(v))) {
    throw new AppError(
      "E_DRM",
      "This stream is DRM-protected. This service does not bypass DRM — playback/download is not offered.",
      { status: 422 },
    );
  }
  return playlist;
}
