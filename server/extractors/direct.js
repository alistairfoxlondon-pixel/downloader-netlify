import { AppError } from "../lib/errors.js";
import { safeFetch, safeFetchText, looksHtml, sniffContainer } from "../lib/safehttp.js";
import { ogMeta, pageTitle, firstH1, stripComments, scriptBlocks } from "../lib/dom.js";
import { absolutize, classifyMediaUrl, fetchAndParseHls, protocolOfContainer } from "./_shared.js";

export const id = "direct";
export const label = "Direct media URL";

export function match() {
  // Direct extraction is the fallback for any public http(s) URL.
  return true;
}

const MEDIA_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|m3u8|mpd|ts|flv|avi)([?#]|$)/i;

function extOf(url) {
  return (url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
}

function pageCandidates(html) {
  const out = [];
  const push = (u) => {
    if (u && /^(https?:)?\/\//i.test(u)) out.push(u);
  };
  push(ogMeta(html, "og:video"));
  push(ogMeta(html, "og:video:url"));
  push(ogMeta(html, "og:video:secure_url"));
  push(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:video/i.exec(html)?.[1]);
  for (const m of html.matchAll(/<video\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<source\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/"contentUrl"\s*:\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/file\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/gi)) push(m[1]);
  for (const block of scriptBlocks(html)) {
    for (const m of block.body.matchAll(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi)) push(m[1]);
    for (const m of block.body.matchAll(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi)) push(m[1]);
  }
  return [...new Set(out)];
}

async function hlsSources(masterUrl, { referer, origin }) {
  const playlist = await fetchAndParseHls(masterUrl, { referer, origin });
  const sources = [];
  const variants = playlist.isMaster ? playlist.variants : [playlist];
  for (const v of variants) {
    sources.push({
      url: v.url,
      container: "m3u8",
      protocol: "hls",
      quality: v.label
        ? { label: v.label, width: v.resolution?.width ?? null, height: v.resolution?.height ?? null, bandwidth: v.bandwidth }
        : null,
      sizeBytes: v.estimatedBytes ?? null,
      ipBound: false,
      verified: true,
      requiresConversion: true,
      note: v.isMediaPlaylist
        ? `HLS media playlist${v.durationSec ? ` (~${Math.round(v.durationSec / 60)} min)` : ""} — MP4 requires the conversion service.`
        : "HLS variant — MP4 requires the conversion service.",
    });
  }
  if (!sources.length) {
    throw new AppError("E_EXTRACT_FAILED", "The M3U8 playlist contains no playable variants.", { status: 502 });
  }
  return sources;
}

/**
 * Generic fallback: direct media files (.mp4/.m3u8/…) and HTML pages that
 * embed a detectable video source. Everything is SSRF-checked hop-by-hop.
 */
export async function extract(url) {
  const ext = extOf(url);
  const referer = url.href;
  const origin = url.origin;

  // ---- direct .m3u8 ------------------------------------------------------
  if (ext === "m3u8") {
    const sources = await hlsSources(url.href, { referer, origin });
    return {
      ok: true, site: id, sourcePage: url.href,
      title: decodeTitle(url.pathname), thumbnail: null, subtitles: [], sources, warnings: [],
    };
  }

  // ---- other known media extensions -------------------------------------
  if (MEDIA_EXT_RE.test(url.pathname) && ext !== "mpd") {
    const cls = await classifyMediaUrl(url.href, { referer, origin });
    if (cls.container === "m3u8") {
      const sources = await hlsSources(url.href, { referer, origin });
      return { ok: true, site: id, sourcePage: url.href, title: decodeTitle(url.pathname), thumbnail: null, subtitles: [], sources, warnings: [] };
    }
    if (cls.container === "mpd") {
      return dashResult(url.href, cls);
    }
    return {
      ok: true,
      site: id,
      sourcePage: url.href,
      title: decodeTitle(url.pathname),
      thumbnail: null,
      subtitles: [],
      sources: [
        {
          url: cls.finalUrl,
          container: cls.container,
          protocol: protocolOfContainer(cls.container),
          quality: null,
          sizeBytes: cls.totalBytes,
          ipBound: false,
          verified: true,
          requiresConversion: cls.container !== "mp4",
          note:
            cls.container === "mp4"
              ? `Direct MP4${cls.supportsRange ? " with byte-range support" : ""}.`
              : `Detected container: ${cls.container}.`,
        },
      ],
      warnings: cls.container === "unknown" ? [{ code: "W_SNIFF", message: "Container type could not be identified from the first bytes." }] : [],
    };
  }

  // ---- HTML page: look for embedded media -------------------------------
  const page = await safeFetchText(url, { maxBytes: 3 * 1024 * 1024 });
  if (!looksHtml(page.contentType) && !/^\s*</.test(page.text)) {
    throw new AppError("E_NO_MEDIA", "That URL did not return an HTML page or a recognised media file.", { status: 422 });
  }

  const candidates = pageCandidates(stripComments(page.text));
  const tried = [];
  for (const cand of candidates) {
    const abs = absolutize(cand, page.url);
    if (!abs || tried.includes(abs)) continue;
    tried.push(abs);
    try {
      if (/\.m3u8([?#]|$)/i.test(abs)) {
        const sources = await hlsSources(abs, { referer: page.url, origin: new URL(page.url).origin });
        return {
          ok: true, site: id, sourcePage: page.url,
          title: pageTitle(page.text) || firstH1(page.text) || decodeTitle(url.pathname),
          thumbnail: ogMeta(page.text, "og:image") || null,
          subtitles: [], sources, warnings: [{ code: "W_EMBED", message: "Media URL discovered inside the page markup." }],
        };
      }
      const cls = await classifyMediaUrl(abs, { referer: page.url, origin: new URL(page.url).origin });
      if (cls.container === "m3u8") {
        const sources = await hlsSources(abs, { referer: page.url, origin: new URL(page.url).origin });
        return {
          ok: true, site: id, sourcePage: page.url,
          title: pageTitle(page.text) || firstH1(page.text) || decodeTitle(url.pathname),
          thumbnail: ogMeta(page.text, "og:image") || null,
          subtitles: [], sources, warnings: [],
        };
      }
      if (cls.container === "mpd") return dashResult(abs, cls);
      if (["mp4", "mov", "webm", "mkv", "ts"].includes(cls.container)) {
        return {
          ok: true, site: id, sourcePage: page.url,
          title: pageTitle(page.text) || firstH1(page.text) || decodeTitle(url.pathname),
          thumbnail: ogMeta(page.text, "og:image") || null,
          subtitles: [],
          sources: [
            {
              url: cls.finalUrl,
              container: cls.container,
              protocol: protocolOfContainer(cls.container),
              quality: null,
              sizeBytes: cls.totalBytes,
              ipBound: false,
              verified: true,
              requiresConversion: cls.container !== "mp4",
              note: `Direct ${cls.container.toUpperCase()} discovered in page markup.`,
            },
          ],
          warnings: [{ code: "W_EMBED", message: "Media URL discovered inside the page markup." }],
        };
      }
    } catch {
      // try next candidate
    }
  }

  throw new AppError(
    "E_NO_MEDIA",
    "No downloadable video source was found at that URL. Paste a direct .mp4/.m3u8 link or a page that embeds one.",
    { status: 422 },
  );
}

function dashResult(url, cls) {
  return {
    ok: true,
    site: id,
    sourcePage: url,
    title: decodeTitle(new URL(url).pathname),
    thumbnail: null,
    subtitles: [],
    sources: [
      {
        url: cls.finalUrl,
        container: "mpd",
        protocol: "dash",
        quality: null,
        sizeBytes: cls.totalBytes,
        ipBound: false,
        verified: true,
        requiresConversion: true,
        note: "MPEG-DASH manifest detected. Browsers cannot download DASH as MP4 directly — conversion service required.",
      },
    ],
    warnings: [{ code: "W_DASH", message: "DASH playback/download is limited to the conversion service when enabled." }],
  };
}

function decodeTitle(pathname) {
  try {
    const base = pathname.split("/").filter(Boolean).pop() || "video";
    return decodeURIComponent(base);
  } catch {
    return "video";
  }
}
