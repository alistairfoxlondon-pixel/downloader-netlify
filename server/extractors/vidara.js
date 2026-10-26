import { AppError } from "../lib/errors.js";
import { safeFetchJson, safeFetchText } from "../lib/safehttp.js";
import { ogMeta, pageTitle, firstH1 } from "../lib/dom.js";
import { absolutize, fetchAndParseHls, classifyMediaUrl } from "./_shared.js";

export const id = "vidara";
export const label = "Vidara";

/** Vidara rotates domains; both the known brand hosts and community-tracked mirrors. */
export const hosts = [
  "vidara.to", "vidara.so", "vidara.cc",
  "vidavaca.net", "vidaarax.net", "vidaarax.com", "vidaratem.com", "vidaratem.so",
  "vidaraw.com", "vidarax.cc", "vidaraa.cc",
  "odysseusa.cc", "handfacesnap.cc", "namefacesnap.cc",
  "thebesthosterv.com", "vidmatrixa.com", "vidchampions.com",
  "antarcticadocs.com", "nameitweb.com",
];

export function match(url) {
  return hosts.includes(url.hostname.toLowerCase().replace(/^www\./, ""));
}

export function mediaId(url) {
  const m = /\/(?:v|e)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname) || /\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  return m ? m[1] : null;
}

/**
 * Vidara's embed player calls POST /api/stream {filecode, device:"web"} and
 * receives {streaming_url (master m3u8), title, thumbnail, subtitles}.
 */
export async function extract(url) {
  const filecode = mediaId(url);
  if (!filecode) {
    throw new AppError("E_BAD_URL", "This does not look like a Vidara video link.", { status: 400 });
  }
  const origin = `${url.protocol}//${url.hostname}`;
  const api = `${origin}/api/stream`;

  let data;
  try {
    const res = await safeFetchJson(api, {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" },
      origin,
      referer: url.href,
      body: JSON.stringify({ filecode, device: "web" }),
    });
    data = res.data;
  } catch (cause) {
    throw new AppError("E_UPSTREAM", "Vidara's stream API did not respond. The site may be down or blocking requests.", {
      status: 502,
      cause,
    });
  }

  const streamingUrl =
    (typeof data?.streaming_url === "string" && data.streaming_url) ||
    (typeof data?.file === "string" && data.file) ||
    (typeof data?.url === "string" && data.url) ||
    null;

  if (!streamingUrl) {
    throw new AppError(
      "E_EXTRACT_FAILED",
      "Vidara returned no media URL — the video may be deleted, private, or region-restricted.",
      { status: 502, details: { response: JSON.stringify(data ?? {}).slice(0, 200) } },
    );
  }

  const streamAbs = absolutize(streamingUrl, origin) || streamingUrl;
  const subtitles = Array.isArray(data?.subtitles)
    ? data.subtitles
        .map((s) => ({
          label: s?.language || s?.label || "Subtitle",
          url: absolutize(s?.file_path || s?.url || "", origin),
        }))
        .filter((s) => s.url)
    : [];

  let title = typeof data?.title === "string" && data.title.trim() ? data.title.trim() : null;
  let thumbnail = typeof data?.thumbnail === "string" ? absolutize(data.thumbnail, origin) : null;

  const isHls = /\.m3u8([?#]|$)/i.test(streamAbs) || !/\.[a-z0-9]{2,4}([?#]|$)/i.test(streamAbs);
  const sources = [];

  if (isHls) {
    const playlist = await fetchAndParseHls(streamAbs, { referer: url.href, origin });
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
        sizeBytes: playlist.durationSec ? playlist.estimatedBytes : null,
        ipBound: false,
        verified: true,
        requiresConversion: true,
        note: playlist.isMediaPlaylist
          ? `HLS media playlist${playlist.durationSec ? ` (~${Math.round(playlist.durationSec / 60)} min)` : ""} — MP4 requires the conversion service.`
          : "HLS stream — MP4 requires the conversion service.",
      });
    }
  } else {
    const cls = await classifyMediaUrl(streamAbs, { referer: url.href, origin });
    sources.push({
      url: streamAbs,
      container: cls.container,
      protocol: cls.container === "m3u8" ? "hls" : cls.container === "mp4" ? "mp4" : "other",
      quality: null,
      sizeBytes: cls.totalBytes,
      ipBound: false,
      verified: true,
      requiresConversion: cls.container !== "mp4",
      note: cls.container === "mp4" ? "Direct MP4 file." : `Detected container: ${cls.container}.`,
    });
  }

  // Best-effort page metadata when the API payload lacks a title/thumbnail.
  if (!title || !thumbnail) {
    try {
      const page = await safeFetchText(url, { maxBytes: 1024 * 1024 });
      title = title || ogMeta(page.text, "og:title") || pageTitle(page.text) || firstH1(page.text) || `Vidara video ${filecode}`;
      thumbnail = thumbnail || (ogMeta(page.text, "og:image") ? absolutize(ogMeta(page.text, "og:image"), page.url) : null);
    } catch {
      title = title || `Vidara video ${filecode}`;
    }
  }

  return {
    ok: true,
    site: id,
    sourcePage: url.href,
    title,
    thumbnail,
    subtitles,
    sources,
    warnings: [],
  };
}
