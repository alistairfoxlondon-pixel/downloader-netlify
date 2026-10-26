import { AppError } from "../lib/errors.js";
import { safeFetch, safeFetchText } from "../lib/safehttp.js";
import { scriptBlocks, pageTitle, firstH1, stripComments, decodeEntities } from "../lib/dom.js";
import { unpackScripts, expandFromCharCodes } from "../lib/packer.js";
import { classifyMediaUrl, sizeTextToBytes } from "./_shared.js";

export const id = "streamtape";
export const label = "Streamtape";

/** Known Streamtape hostnames (rotating mirror list). */
export const hosts = [
  "streamtape.com", "streamtape.net", "streamtape.to", "streamta.pe", "streamtape.site",
  "streamtape.cc", "streamtape.xyz", "strtape.cloud", "strtape.site", "strcloud.link",
  "strcloud.club", "strtpe.link", "scloud.online", "stape.fun", "streamnoads.com",
  "tapeblocker.com", "gettapeads.com", "advertape.net", "tpead.net", "advtpe.com",
  "antiadtape.com", "adblocktape.wiki", "watchadsontape.com", "shavetape.cash",
  "streamadblockplus.com", "streamadblocker.xyz", "tapeadvertisement.com",
  "tapeadsenjoyer.com", "streamtapeadblock.art", "streamtapeadblockuser.xyz",
  "strtapeadblock.me", "streamadblocker.com", "streamnoads.net",
];

export function match(url) {
  return hosts.includes(url.hostname.toLowerCase().replace(/^www\./, ""));
}

export function mediaId(url) {
  const m = /\/(?:v|e)\/([0-9A-Za-z]+)\/?/.exec(url.pathname);
  return m ? m[1] : null;
}

/**
 * Decode the obfuscated `get_video` link that Streamtape's player builds with
 * string concatenation + substring() calls (no eval — a faithful port of the
 * pattern used by common resolvers).
 */
function decodeConcatAssignment(chunk) {
  try {
    const parts = chunk.replace(/'/g, '"').split("+");
    let out = "";
    for (const part of parts) {
      const strMatch = /"([^"]*)/.exec(part);
      if (!strMatch) continue;
      let piece = strMatch[1];
      if (part.includes("substring")) {
        const sm = /substring\((\d+)/.exec(part);
        if (sm) piece = piece.slice(Number(sm[1]));
      }
      out += piece;
    }
    return out || null;
  } catch {
    return null;
  }
}

function normalizeGetVideo(candidate, pageUrl) {
  // Strip document.write-style decoration: keep from `get_v…` onwards.
  const idx = /get_v[a-z]{2,6}\?/i.exec(candidate)?.index;
  if (idx === undefined || idx === null) return null;
  let c = candidate.slice(idx);
  const qIndex = c.indexOf("?");
  if (qIndex === -1) return null;
  // HTML attributes escape ampersands; normalize before parsing params.
  const query = c.slice(qIndex + 1).replace(/&amp;/gi, "&").replace(/\\u0026/gi, "&");
  const params = new URLSearchParams(query);
  if (!params.get("id") || !params.get("token") || !params.get("expires") || !params.get("ip")) return null;
  const host = pageUrl.hostname;
  return `https://${host}/get_video?${params.toString()}`;
}

/** Find every `get_v…?…` occurrence and expand backwards to the token boundary. */
function* iterateLinkCandidates(html) {
  const re = /get_v[a-z]{2,6}\?[^"'\\\s<>]+/gi;
  let m;
  while ((m = re.exec(html))) {
    let start = m.index;
    while (start > 0 && !/[\s"'<>\\]/.test(html[start - 1])) start--;
    yield html.slice(start, re.lastIndex);
  }
}

/** Collect all plausible get_video links from the page. */
function collectCandidates(html, pageUrl) {
  const scored = new Map(); // url -> {count, best}
  const add = (raw, score) => {
    const norm = normalizeGetVideo(raw, pageUrl);
    if (!norm) return;
    const prev = scored.get(norm) || { count: 0, best: 0 };
    prev.count += 1;
    prev.best = Math.max(prev.best, score);
    scored.set(norm, prev);
  };

  // (1) Plaintext occurrences anywhere: /get_video?… , //host/get_video?…,
  //     obfuscated host spellings like /streamtape.com/get_viddeo?…
  for (const raw of iterateLinkCandidates(html)) add(raw, 1);

  // (2) Concat-encoded robot link:  getElementById('...').innerHTML = '...'+(...substring(n))+'...'
  const byIdRe = /ById\s*\(\s*['"][^'"]*['"]\s*\)[\s\S]{0,400}?=\s*(["'])\/\/[^;<]+/g;
  let m;
  while ((m = byIdRe.exec(html))) {
    const chunk = m[0].slice(m[0].indexOf("=") + 1);
    const decoded = decodeConcatAssignment(chunk);
    if (decoded) add(decoded, 3);
  }

  // (3) Older style: var link = '//host/get_video?id=...'
  const varRe = /(?:link|src|file|url|robot)\s*=\s*(["'])\/\/[^"'\\\s]+get_v[^"'\\\s]+/gi;
  while ((m = varRe.exec(html))) add(m[0].slice(m[0].indexOf("=") + 1), 2);

  // Prefer candidates that appear repeatedly (embed block shows it 3x) and the
  // concat-decoded one, then ones without the "&download=" param (inline).
  const ranked = [...scored.entries()].sort((a, b) => {
    const [ua, sa] = a;
    const [ub, sb] = b;
    const scoreA = sa.best * 10 + sa.count + (ua.includes("stream=1") ? 5 : 0);
    const scoreB = sb.best * 10 + sb.count + (ub.includes("stream=1") ? 5 : 0);
    return scoreB - scoreA;
  });
  return ranked.map(([url]) => url);
}

function extractTitle(html, id) {
  let title = pageTitle(html) || firstH1(html) || null;
  if (title) {
    title = decodeEntities(title)
      .replace(/\s+at Streamtape\.com\s*$/i, "")
      .replace(/\s*[|·-]\s*Streamtape\s*$/i, "")
      .trim();
  }
  return title || `Streamtape video ${id}`;
}

/** Page shows a size like "2.64 MB" under the player. */
function extractPageSize(html) {
  const h1 = firstH1(html) || "";
  const idx = html.indexOf(h1.slice(0, 40));
  const scope = idx >= 0 ? html.slice(idx) : html;
  const m = /(\d+(?:[.,]\d+)?\s*(?:KB|MB|GB))\b/i.exec(scope);
  return m ? sizeTextToBytes(m[1]) : null;
}

export async function extract(url) {
  const page = await safeFetchText(url, {
    accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    timeoutMs: 15000,
  });
  const html = stripComments(page.text);
  const vid = mediaId(url);
  if (!vid) {
    throw new AppError("E_BAD_URL", "This does not look like a Streamtape video link (expected /v/… or /e/…).", {
      status: 400,
    });
  }
  if (/video (?:has been )?(?:deleted|removed)|file (?:was )?not found/i.test(html) && !/get_video\?/.test(html)) {
    throw new AppError("E_NOT_FOUND", "This Streamtape video has been deleted or is unavailable.", { status: 404 });
  }

  const candidates = collectCandidates(html, new URL(page.url));
  // Also try script bodies unpacked — some mirrors move the link into packed JS.
  if (!candidates.length) {
    for (const block of scriptBlocks(html)) {
      const unpackedSources = unpackScripts(block.body);
      for (const src of [block.body, ...unpackedSources]) {
        for (const raw of iterateLinkCandidates(src)) {
          const norm = normalizeGetVideo(raw, new URL(page.url));
          if (norm && !candidates.includes(norm)) candidates.push(norm);
        }
      }
    }
  }

  if (!candidates.length) {
    throw new AppError(
      "E_EXTRACT_FAILED",
      "Could not locate the direct video link on this Streamtape page. The page may require a CAPTCHA, be region-blocked, or use a new layout.",
      { status: 502 },
    );
  }

  let mediaUrl = candidates[0];
  let verified = null;
  // `stream=1` asks Streamtape for an inline (non-attachment) response, which
  // is what we want for preview + our own Content-Disposition handling.
  const streamUrl = `${mediaUrl}${mediaUrl.includes("?") ? "&" : "?"}stream=1`;
  try {
    verified = await classifyMediaUrl(streamUrl, { referer: page.url });
    mediaUrl = streamUrl;
  } catch {
    try {
      verified = await classifyMediaUrl(mediaUrl, { referer: page.url });
    } catch {
      verified = null; // link found but not probeable from this network — report honestly
    }
  }

  const container = verified?.container || "mp4";
  const sizeBytes = verified?.totalBytes ?? extractPageSize(html);

  return {
    ok: true,
    site: id,
    sourcePage: page.url,
    title: extractTitle(html, vid),
    thumbnail: null,
    subtitles: [],
    sources: [
      {
        url: mediaUrl,
        container,
        protocol: container === "m3u8" ? "hls" : "mp4",
        quality: null,
        sizeBytes,
        ipBound: true,
        verified: Boolean(verified),
        requiresConversion: container !== "mp4",
        note: verified
          ? "Direct MP4. Link is signed for the fetching IP, so preview/download is proxied by this service."
          : "Direct MP4 link found, but it could not be probed from this network — try preview/download and check the result.",
      },
    ],
    warnings: verified ? [] : [{ code: "W_UNVERIFIED", message: "Media URL could not be verified (probe failed)." }],
  };
}
