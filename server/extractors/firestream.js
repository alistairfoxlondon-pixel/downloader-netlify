import { AppError } from "../lib/errors.js";
import { safeFetchText, safeFetchJson, looksHtml } from "../lib/safehttp.js";
import { scriptById, pageTitle, ogMeta, firstH1 } from "../lib/dom.js";
import { absolutize, classifyMediaUrl } from "./_shared.js";

export const id = "firestream";
export const label = "Firestream";

export const hosts = ["firestream.to", "firestream.site"];

export function match(url) {
  return hosts.includes(url.hostname.toLowerCase().replace(/^www\./, ""));
}

export function mediaId(url) {
  const m = /\/(?:e|v|w|embed)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  return m ? m[1] : null;
}

/**
 * Firestream embeds a signed token in <script id="token-blob">; POSTing it to
 * /api/videos/{id}/resolve returns a short-lived signedVideoUrl.
 */
export async function extract(url) {
  const vid = mediaId(url);
  if (!vid) {
    throw new AppError("E_BAD_URL", "This does not look like a Firestream video link (expected /e/…).", {
      status: 400,
    });
  }

  const page = await safeFetchText(url, { timeoutMs: 15000 });
  const origin = new URL(page.url).origin;

  if (looksHtml(page.contentType) === false && page.contentType.includes("json")) {
    throw new AppError("E_UPSTREAM", "Firestream returned an unexpected response.", { status: 502 });
  }

  const blob = (scriptById(page.text, "token-blob") || "").trim();
  if (!blob) {
    throw new AppError(
      "E_EXTRACT_FAILED",
      "Firestream page loaded but no video token was found — the video may be removed or the page is showing an ad-block wall.",
      { status: 502 },
    );
  }

  const api = `${origin}/api/videos/${vid}/resolve`;
  const headers = { origin, referer: `${origin}/` };
  let signedUrl = null;
  let lastErr = null;

  // Community resolvers use form-encoded bodies; the JS player uses JSON.
  // Try both — we do not assume which one any given deployment expects.
  for (const [ctype, body] of [
    ["application/x-www-form-urlencoded", `blob=${encodeURIComponent(blob)}`],
    ["application/json", JSON.stringify({ blob })],
  ]) {
    try {
      const res = await safeFetchJson(api, {
        method: "POST",
        headers: { "content-type": ctype },
        origin,
        referer: `${origin}/`,
        body,
      });
      const url_ = res.data?.signedVideoUrl || res.data?.signed_video_url || res.data?.url || null;
      if (typeof url_ === "string" && url_) {
        signedUrl = url_;
        break;
      }
      lastErr = new Error("no signedVideoUrl in response");
    } catch (e) {
      lastErr = e;
    }
  }

  if (!signedUrl) {
    throw new AppError(
      "E_EXTRACT_FAILED",
      "Firestream did not return a signed video URL. The link may have expired or the video is unavailable.",
      { status: 502, details: { cause: String(lastErr?.message || lastErr).slice(0, 160) } },
    );
  }

  const mediaAbs = absolutize(signedUrl, origin) || signedUrl;
  const source = { headers, pageUrl: page.url };

  // Classify: signed URLs are often extensionless CDN links — sniff them.
  const cls = await classifyMediaUrl(mediaAbs, { referer: source.headers.referer, origin });
  const container = cls.container;

  const sources = [];
  if (container === "m3u8") {
    // (classify already read the head; parse properly via URL fetch)
    const { fetchAndParseHls } = await import("./_shared.js");
    const playlist = await fetchAndParseHls(mediaAbs, { referer: source.headers.referer, origin });
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
        url: mediaAbs,
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
    sources.push({
      url: mediaAbs,
      container,
      protocol: container === "mp4" ? "mp4" : "other",
      quality: null,
      sizeBytes: cls.totalBytes,
      ipBound: false,
      verified: true,
      requiresConversion: container !== "mp4",
      note:
        container === "mp4"
          ? `Direct MP4${cls.supportsRange ? " with byte-range support" : ""}.`
          : `Detected container: ${container}.`,
    });
  }

  const title = ogMeta(page.text, "og:title") || pageTitle(page.text) || firstH1(page.text) || `Firestream video ${vid}`;
  const ogImg = ogMeta(page.text, "og:image");

  return {
    ok: true,
    site: id,
    sourcePage: page.url,
    title,
    thumbnail: ogImg ? absolutize(ogImg, page.url) : null,
    subtitles: [],
    sources,
    warnings: [],
  };
}
