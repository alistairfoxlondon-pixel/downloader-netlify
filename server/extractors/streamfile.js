import { AppError } from "../lib/errors.js";
import { safeFetchText, NAVIGATION_HEADERS } from "../lib/safehttp.js";
import { scriptBlocks, pageTitle, ogMeta, firstH1, stripComments } from "../lib/dom.js";
import { unpackScripts, expandFromCharCodes } from "../lib/packer.js";
import { absolutize, fetchAndParseHls, sizeTextToBytes } from "./_shared.js";

export const id = "streamfile";
export const label = "StreamFile";

export const hosts = ["streamfile.net"];

export function match(url) {
  return hosts.includes(url.hostname.toLowerCase().replace(/^www\./, ""));
}

export function mediaId(url) {
  const m = /^\/([0-9A-Za-z_-]+?)(?:\.html)?\/?$/.exec(url.pathname);
  return m && !["login", "premium", "faq", "tos", "contact", "api", "registration", "check_files"].includes(m[1])
    ? m[1]
    : null;
}

/** Pull every variant of the HLS master URL out of (unpacked) script text. */
function findHlsUrl(text) {
  const patterns = [
    /plyrHlsSrc\s*=\s*['"](https?:\/\/[^'"]+)['"]/i,
    /plyrHlsSrc\s*=\s*['"](\/\/[^'"]+)['"]/i,
    /['"](https?:\/\/[^'"]+\.urlset\/master\.m3u8[^'"]*)['"]/i,
    /['"](https?:\/\/[^'"]+\/master\.m3u8[^'"]*)['"]/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** StreamFile's premium tab prints "<w>x<h>, <n> MB" sizes — harvest them. */
function parseSizeHints(html) {
  const hints = new Map(); // `${w}x${h}` -> bytes
  const re = /(\d{2,4})\s*x\s*(\d{2,4})\s*,\s*([\d.,]+)\s*(KB|MB|GB)/gi;
  let m;
  while ((m = re.exec(html))) {
    const key = `${m[1]}x${m[2]}`;
    hints.set(key, sizeTextToBytes(`${m[3]} ${m[4]}`));
  }
  return hints;
}

/**
 * StreamFile serves an HLS multi-variant (urlset) master playlist; the page
 * itself lists the quality ladder. Their *direct download link* is a premium
 * feature on their site — we report the HLS sources the player uses.
 */
export async function extract(url) {
  const mid = mediaId(url);
  if (!mid) {
    throw new AppError("E_BAD_URL", "This does not look like a StreamFile video link.", { status: 400 });
  }
  const page = await safeFetchText(url, { timeoutMs: 15000, headers: { ...NAVIGATION_HEADERS } });
  const html = stripComments(page.text);

  const blobs = [html];
  for (const block of scriptBlocks(html)) {
    blobs.push(block.body);
    for (const unpacked of unpackScripts(block.body)) blobs.push(unpacked);
  }
  const all = [...blobs, ...blobs.map((b) => expandFromCharCodes(b))];

  let rawUrl = null;
  for (const blob of all) {
    rawUrl = findHlsUrl(blob);
    if (rawUrl) break;
  }
  if (!rawUrl) {
    throw new AppError(
      "E_EXTRACT_FAILED",
      "Could not locate the HLS playlist on this StreamFile page. The file may have expired or been removed.",
      { status: 502 },
    );
  }

  const masterAbs = absolutize(rawUrl, page.url) || rawUrl;
  const origin = new URL(page.url).origin;
  const sizeHints = parseSizeHints(html);
  const playlist = await fetchAndParseHls(masterAbs, { referer: page.url, origin });

  const sources = [];
  const variants = playlist.isMaster ? playlist.variants : [playlist];
  for (const v of variants) {
    let sizeBytes = null;
    if (v.resolution) {
      sizeBytes =
        sizeHints.get(`${v.resolution.width}x${v.resolution.height}`) ??
        [...sizeHints.entries()].find(([k]) => k.endsWith(`x${v.resolution.height}`))?.[1] ??
        null;
    }
    sources.push({
      url: v.url,
      container: "m3u8",
      protocol: "hls",
      quality: v.label
        ? { label: v.label, width: v.resolution?.width ?? null, height: v.resolution?.height ?? null, bandwidth: v.bandwidth }
        : null,
      sizeBytes,
      ipBound: false,
      verified: true,
      requiresConversion: true,
      note: v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : "HLS variant — MP4 requires the conversion service.",
    });
  }

  const title = firstH1(html) || ogMeta(html, "og:title") || pageTitle(html) || `StreamFile video ${mid}`;
  const ogImg = ogMeta(html, "og:image");

  return {
    ok: true,
    site: id,
    sourcePage: page.url,
    title: title.trim ? title.trim() : title,
    thumbnail: ogImg ? absolutize(ogImg, page.url) : null,
    subtitles: [],
    sources,
    warnings: [
      {
        code: "W_PREMIUM_HOST",
        message:
          "StreamFile restricts its own direct-download links to premium accounts; the HLS streams used by their player are what is listed here.",
      },
    ],
  };
}
