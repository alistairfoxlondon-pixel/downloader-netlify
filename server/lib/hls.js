/**
 * Minimal HLS playlist parsing — enough to enumerate variant streams and to
 * detect DRM-protected content (which this project refuses to touch).
 */

/**
 * @typedef {{url: string, bandwidth: number|null, resolution: {width:number,height:number}|null,
 *            label: string|null, codecs: string|null, isMediaPlaylist: boolean,
 *            estimatedBytes: number|null, segments: number|null, durationSec: number|null,
 *            encryption: "none"|"aes-128"|"sample-aes"|"unknown"}} ParsedPlaylist
 */

const ATTRIBUTE_RE = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;

function parseAttributes(line) {
  const attrs = {};
  let m;
  ATTRIBUTE_RE.lastIndex = line.indexOf(":") + 1;
  const body = line.slice(line.indexOf(":") + 1);
  const re = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^\s,]+)/g;
  while ((m = re.exec(body))) {
    let v = m[2];
    if (v.startsWith('"')) v = v.slice(1, -1);
    attrs[m[1]] = v;
  }
  return attrs;
}

function resolveUrl(rel, baseUrl) {
  try {
    return new URL(rel, baseUrl).href;
  } catch {
    return rel;
  }
}

function qualityLabel(variant) {
  if (variant.resolution) {
    const h = variant.resolution.height;
    const w = variant.resolution.width;
    if (h >= 2160) return "2160p (4K)";
    if (h >= 1440) return "1440p";
    if (h >= 1080) return "1080p HD";
    if (h >= 720) return "720p HD";
    if (h >= 480) return "480p";
    if (h >= 360) return "360p";
    if (h >= 240) return "240p";
    return `${h}p`;
  }
  if (variant.name) return variant.name;
  if (variant.bandwidth) return `${Math.round(variant.bandwidth / 1000)} kbps`;
  return null;
}

function detectEncryption(line) {
  if (!line || !line.includes("#EXT-X-KEY")) return null;
  const attrs = parseAttributes(line);
  const method = (attrs.METHOD || "NONE").toUpperCase();
  if (method === "NONE") return "none";
  if (method === "AES-128") return "aes-128";
  if (method.startsWith("SAMPLE-AES")) return "sample-aes"; // typically DRM (Widevine/FairPlay/PlayReady)
  return "unknown";
}

/**
 * Parse an M3U8 playlist fetched from `playlistUrl`.
 * Master playlists return one entry per variant; media playlists return a
 * single entry with segment/duration info when available.
 *
 * @param {string} text raw playlist text
 * @param {string} playlistUrl absolute URL the text was fetched from
 * @returns {ParsedPlaylist & {isMaster: boolean, variants?: ParsedPlaylist[]}}
 */
export function parseM3u8(text, playlistUrl) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines[0] || !lines[0].startsWith("#EXTM3U")) {
    const err = new Error("Not an M3U8 playlist (missing #EXTM3U header).");
    err.code = "E_NOT_PLAYLIST";
    throw err;
  }

  const encryptionLine = lines.find((l) => detectEncryption(l));
  const encryption = detectEncryption(encryptionLine) || "none";

  const variants = [];
  let targetDuration = null;
  let mediaSeqPresent = false;
  let segmentCount = 0;
  let totalDuration = 0;
  let hasMap = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attrs = parseAttributes(line);
      // Next non-comment line is the variant URI.
      let uri = null;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].startsWith("#")) {
          uri = lines[j];
          break;
        }
      }
      if (!uri) continue;
      let resolution = null;
      if (attrs.RESOLUTION) {
        const m = /(\d+)x(\d+)/.exec(attrs.RESOLUTION);
        if (m) resolution = { width: Number(m[1]), height: Number(m[2]) };
      }
      const v = {
        url: resolveUrl(uri, playlistUrl),
        bandwidth: attrs.BANDWIDTH ? Number(attrs.BANDWIDTH) : null,
        resolution,
        label: null,
        codecs: attrs.CODECS || null,
        isMediaPlaylist: false,
        estimatedBytes: null,
        segments: null,
        durationSec: null,
        encryption,
      };
      v.label = qualityLabel(v);
      variants.push(v);
    } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = Number(line.split(":")[1]) || null;
    } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSeqPresent = true;
    } else if (line.startsWith("#EXTINF:")) {
      const d = parseFloat(line.slice(8));
      if (!Number.isNaN(d)) totalDuration += d;
      segmentCount++;
    } else if (line.startsWith("#EXT-X-MAP:")) {
      hasMap = true;
    }
  }

  if (variants.length > 0) {
    return { isMaster: true, url: playlistUrl, variants, encryption };
  }

  // Media (variant) playlist — a single rendition.
  const info = {
    isMaster: false,
    url: playlistUrl,
    bandwidth: null,
    resolution: null,
    label: null,
    codecs: null,
    isMediaPlaylist: true,
    segments: segmentCount || null,
    durationSec: totalDuration > 0 ? Math.round(totalDuration) : null,
    estimatedBytes: null,
    encryption,
  };
  if (info.durationSec && targetDuration && segmentCount) {
    // Rough lower bound: media playlists rarely average below ~500 kbit/s.
    info.estimatedBytes = Math.round((info.durationSec * 500_000) / 8);
  }
  return info;
}

/** DRMs we refuse (and must report honestly) are flagged when SAMPLE-AES appears. */
export function isDrmProtected(parsed) {
  const enc = parsed.encryption ?? "none";
  return enc === "sample-aes" || enc === "unknown";
}

/**
 * Rewrite an M3U8 playlist so every referenced URI (variants, segments,
 * encryption keys, init maps) points back at our tokenised media proxy.
 * Without this, relative segment paths in a proxied playlist would resolve
 * against the proxy endpoint and 401.
 *
 * @param {string} text playlist body
 * @param {string} baseUrl absolute URL the playlist was fetched from
 * @param {(absUrl: string) => string} toProxyUrl maps an absolute URL to our proxy path
 * @param {number} [maxUris] safety cap
 */
export function rewritePlaylist(text, baseUrl, toProxyUrl, maxUris = 2000) {
  const lines = String(text).split(/\r?\n/);
  let rewritten = 0;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Attribute lists carrying URI="…": EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF…
    if (trimmed.startsWith("#")) {
      if (/URI="/.test(trimmed) && rewritten < maxUris) {
        const next = trimmed.replace(/URI="([^"]+)"/g, (whole, uri) => {
          const abs = resolveUri(uri, baseUrl);
          if (!abs) return whole;
          rewritten++;
          return `URI="${toProxyUrl(abs)}"`;
        });
        return next;
      }
      return line;
    }

    // Bare URI lines: variant streams / segments.
    if (rewritten >= maxUris) return line;
    const abs = resolveUri(trimmed, baseUrl);
    if (!abs) return line;
    rewritten++;
    return toProxyUrl(abs);
  });
  return out.join("\n");
}

function resolveUri(uri, baseUrl) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    // Already absolute http(s) — anything else (data:, etc.) left untouched.
    return /^https?:/i.test(uri) ? uri : null;
  }
  try {
    const u = new URL(uri, baseUrl);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
