import { AppError } from "../lib/errors.js";
import { safeFetchText } from "../lib/safehttp.js";
import { scriptBlocks, pageTitle, ogMeta, firstH1, stripComments, decodeEntities } from "../lib/dom.js";
import { unpackScripts, expandFromCharCodes } from "../lib/packer.js";
import { absolutize, classifyMediaUrl } from "./_shared.js";

export const id = "lulustream";
export const label = "LuluStream / LuluVdo";

/** LuluStream family (LuluVdo, LuluStream, aliases) — one player codebase. */
export const hosts = [
  "lulustream.com", "luluvdo.com", "lulu.st", "luluvid.com", "luluvdoo.com",
  "lulust.com", "luluvido.com", "luluvid.io", "luluvdo.net",
  "streamhihi.com",
];

export function match(url) {
  return hosts.includes(url.hostname.toLowerCase().replace(/^www\./, ""));
}

export function mediaId(url) {
  const m = /^\/(?:e|d|v|w|embed)?\/?([0-9A-Za-z]+)\/?$/.exec(url.pathname);
  return m ? m[1] : null;
}

const SOURCE_RES = [
  /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i,
  /sources\s*:\s*\[\s*\{\s*(?:src|url)\s*:\s*["']([^"']+)["']/i,
  /\bfile\s*:\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/i,
];

function findSources(text) {
  for (const re of SOURCE_RES) {
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}

function findSubtitles(text) {
  const trackBlock = /tracks\s*:\s*\[([\s\S]*?)\]/i.exec(text)?.[1] || "";
  if (!trackBlock) return [];
  const out = [];
  const re = /file\s*:\s*["']([^"']+)["']\s*,\s*label\s*:\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(trackBlock))) {
    const label = decodeEntities(m[2]).trim();
    if (!label || /upload captions/i.test(label)) continue;
    out.push({ label, url: m[1] });
  }
  return out;
}

/**
 * LuluStream pages embed the source in a <script> — plain or packed with a
 * Dean-Edwards obfuscator. We search: comments-stripped HTML → raw scripts →
 * statically unpacked scripts → fromCharCode expansions. No eval.
 */
export async function extract(url) {
  const mid = mediaId(url);
  if (!mid) {
    throw new AppError("E_BAD_URL", "This does not look like a LuluStream video link.", { status: 400 });
  }
  const page = await safeFetchText(url, { timeoutMs: 15000 });
  const html = stripComments(page.text);

  const blobs = [html];
  for (const block of scriptBlocks(html)) {
    blobs.push(block.body);
    for (const unpacked of unpackScripts(block.body)) blobs.push(unpacked);
  }
  // Second pass: expanded char codes across everything already collected.
  const expanded = blobs.map((b) => expandFromCharCodes(b));
  const all = [...blobs, ...expanded];

  let rawUrl = null;
  let rawSubs = [];
  for (const blob of all) {
    rawUrl = findSources(blob);
    if (rawUrl) {
      rawSubs = findSubtitles(blob);
      break;
    }
  }

  if (!rawUrl) {
    throw new AppError(
      "E_EXTRACT_FAILED",
      "Could not locate a video source on this LuluStream page. The video may have been removed or the player layout changed.",
      { status: 502 },
    );
  }

  const mediaAbs = absolutize(rawUrl, page.url) || rawUrl;
  const origin = new URL(page.url).origin;
  const isExtHls = /\.m3u8([?#]|$)/i.test(mediaAbs);
  const isExtMp4 = /\.mp4([?#]|$)/i.test(mediaAbs) || /\.m4v([?#]|$)/i.test(mediaAbs);

  const sources = [];
  if (isExtHls) {
    const { fetchAndParseHls } = await import("./_shared.js");
    const playlist = await fetchAndParseHls(mediaAbs, { referer: page.url, origin });
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
    const cls = await classifyMediaUrl(mediaAbs, { referer: page.url, origin });
    sources.push({
      url: mediaAbs,
      container: cls.container,
      protocol: cls.container === "mp4" ? "mp4" : cls.container === "m3u8" ? "hls" : "other",
      quality: null,
      sizeBytes: cls.totalBytes,
      ipBound: false,
      verified: true,
      requiresConversion: cls.container !== "mp4",
      note: cls.container === "mp4" || !isExtMp4
        ? cls.container === "mp4"
          ? "Direct MP4 file."
          : `Detected container: ${cls.container}.`
        : `Detected container: ${cls.container}.`,
    });
  }

  const title =
    ogMeta(page.text, "og:title") ||
    pageTitle(page.text) ||
    firstH1(page.text) ||
    `LuluStream video ${mid}`;
  const ogImg = ogMeta(page.text, "og:image");

  return {
    ok: true,
    site: id,
    sourcePage: page.url,
    title: decodeEntities(title),
    thumbnail: ogImg ? absolutize(ogImg, page.url) : null,
    subtitles: rawSubs
      .map((s) => ({ label: s.label, url: absolutize(s.url, page.url) }))
      .filter((s) => s.url),
    sources,
    warnings: [],
  };
}
