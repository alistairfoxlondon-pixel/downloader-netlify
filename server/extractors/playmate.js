import { AppError } from "../lib/errors.js";
import { safeFetchJson } from "../lib/safehttp.js";
import { absolutize, fetchAndParseHls, classifyMediaUrl } from "./_shared.js";

export const id = "playmate";
export const label = "Playmate";

export const hosts = ["playmate.to"];

export function match(url) {
  return hosts.includes(url.hostname.toLowerCase().replace(/^www\./, ""));
}

export function mediaId(url) {
  const m = /\/(?:watch|embed|e|v)\/([0-9A-Za-z]+)\/?$/.exec(url.pathname);
  return m ? m[1] : null;
}

/**
 * Playmate exposes POST /api/s {c: filecode, d: "web"} which answers with
 * {sx: <HLS master>, kx: [{sl, sf} subtitles]}. Metadata (title) comes from
 * GET /api/video-meta?filecode=…
 */
export async function extract(url) {
  const filecode = mediaId(url);
  if (!filecode) {
    throw new AppError("E_BAD_URL", "This does not look like a Playmate video link (expected /watch/…).", {
      status: 400,
    });
  }
  const origin = `${url.protocol}//${url.hostname}`;
  const api = `${origin}/api/s`;
  const headers = { origin, referer: `${origin}/watch/${filecode}` };

  let data;
  try {
    // The JS client posts JSON; some integrations post form data — try both.
    try {
      const res = await safeFetchJson(api, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...headers,
        body: JSON.stringify({ c: filecode, d: "web" }),
      });
      data = res.data;
    } catch (jsonErr) {
      const res = await safeFetchJson(api, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        ...headers,
        body: `c=${encodeURIComponent(filecode)}&d=web`,
      });
      data = res.data;
      if (!data?.sx) throw jsonErr;
    }
  } catch (cause) {
    const status = cause?.details ? undefined : undefined;
    throw new AppError(
      "E_UPSTREAM",
      "playmate.to is currently unreachable (the origin server returned an error or timed out). Try again later.",
      { status: 502, cause },
    );
  }

  const sx = typeof data?.sx === "string" && data.sx ? data.sx : null;
  if (!sx) {
    throw new AppError(
      "E_EXTRACT_FAILED",
      "Playmate returned no stream URL — the video may be deleted or restricted.",
      { status: 502, details: { response: JSON.stringify(data ?? {}).slice(0, 200) } },
    );
  }

  const streamAbs = absolutize(sx, origin) || sx;
  const subtitles = Array.isArray(data?.kx)
    ? data.kx.map((s) => ({ label: s?.sl || "Subtitle", url: absolutize(s?.sf || "", origin) })).filter((s) => s.url)
    : [];

  const sources = [];
  if (/\.m3u8([?#]|$)/i.test(streamAbs)) {
    const playlist = await fetchAndParseHls(streamAbs, { referer: headers.referer, origin });
    if (playlist.isMaster && playlist.variants.length) {
      for (const v of playlist.variants) {
        sources.push({
          url: v.url,
          container: "m3u8",
          protocol: "hls",
          quality: v.label
            ? { label: v.label, width: v.resolution?.width ?? null, height: v.resolution?.height ?? null, bandwidth: v.bandwidth }
            : null,
          sizeBytes: null,
          ipBound: false,
          verified: true,
          requiresConversion: true,
          note: "HLS variant — MP4 requires the conversion service.",
        });
      }
    } else {
      sources.push({
        url: streamAbs,
        container: "m3u8",
        protocol: "hls",
        quality: null,
        sizeBytes: playlist.estimatedBytes,
        ipBound: false,
        verified: true,
        requiresConversion: true,
        note: "HLS stream — MP4 requires the conversion service.",
      });
    }
  } else {
    const cls = await classifyMediaUrl(streamAbs, { referer: headers.referer, origin });
    sources.push({
      url: streamAbs,
      container: cls.container,
      protocol: cls.container === "mp4" ? "mp4" : cls.container === "m3u8" ? "hls" : "other",
      quality: null,
      sizeBytes: cls.totalBytes,
      ipBound: false,
      verified: true,
      requiresConversion: cls.container !== "mp4",
      note: cls.container === "mp4" ? "Direct MP4 file." : `Detected container: ${cls.container}.`,
    });
  }

  // Title from metadata endpoint — best effort.
  let title = null;
  try {
    const meta = await safeFetchJson(`${origin}/api/video-meta?filecode=${encodeURIComponent(filecode)}`, {
      referer: headers.referer,
      origin,
      timeoutMs: 10000,
    });
    if (typeof meta.data?.title === "string" && meta.data.title.trim()) title = meta.data.title.trim();
  } catch {
    /* metadata is optional */
  }

  return {
    ok: true,
    site: id,
    sourcePage: url.href,
    title: title || `Playmate video ${filecode}`,
    thumbnail: null,
    subtitles,
    sources,
    warnings: title ? [] : [{ code: "W_META", message: "Video metadata endpoint did not return a title." }],
  };
}
