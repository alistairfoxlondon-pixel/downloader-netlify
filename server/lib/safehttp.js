import { AppError } from "./errors.js";
import { assertSafeUrlWithDns, parseHttpUrl } from "./urlguard.js";

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/**
 * A coherent set of Chromium navigation headers for plain document GETs
 * (address-bar navigation style). Hosts behind basic bot walls reject
 * requests that look like a bare script (no client hints, no sec-fetch).
 * Do NOT send these alongside cross-origin XHR headers (origin/referer)
 * — that combination is inconsistent and can itself trigger WAFs.
 */
export const NAVIGATION_HEADERS = {
  "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

export const MAX_PAGE_BYTES = Number(process.env.MAX_PAGE_BYTES || 3 * 1024 * 1024);
export const DEFAULT_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
export const MAX_REDIRECTS = 6;

const HTML_LIKE = /text\/html|application\/xhtml\+xml|text\/xml|application\/xml/i;

function headersToObject(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) out[k.toLowerCase()] = v;
  return out;
}

/**
 * Fetch a URL with SSRF validation on every hop (redirects handled manually),
 * a hard timeout, and a hard byte cap for buffered responses.
 *
 * @param {string} input
 * @param {object} [opts]
 *  - method (default GET)
 *  - headers: extra request headers
 *  - referer: optional Referer header
 *  - origin: optional Origin header
 *  - timeoutMs (default 15000)
 *  - maxBytes (default MAX_PAGE_BYTES) — ignored when `stream: true`
 *  - stream: when true, resolves with `body` = web ReadableStream (caller must consume/cancel)
 *  - range: Range header value for partial content
 *  - accept: Accept header override
 * @returns {Promise<{url: string, status: number, headers: Record<string,string>, body: Buffer|null, stream: ReadableStream|null, contentType: string}>}
 */
export async function safeFetch(input, opts = {}) {
  const {
    method = "GET",
    headers = {},
    referer,
    origin,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = MAX_PAGE_BYTES,
    stream = false,
    range,
    accept,
  } = opts;

  let current = parseHttpUrl(String(input));
  let redirects = 0;
  const redirectPolicy = opts.redirectPolicy ?? "manual";

  for (;;) {
    await assertSafeUrlWithDns(current);

    const reqHeaders = {
      "user-agent": DEFAULT_UA,
      accept: accept ?? "*/*",
      "accept-language": "en-US,en;q=0.9",
      ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    };
    if (referer) reqHeaders.referer = referer;
    if (origin) reqHeaders.origin = origin;
    if (range) reqHeaders.range = range;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const hasBody = opts.body !== undefined && method !== "GET" && method !== "HEAD";
    let res;
    try {
      res = await fetch(current, {
        method,
        headers: reqHeaders,
        redirect: "manual",
        signal: controller.signal,
        ...(hasBody ? { body: opts.body } : {}),
      });
    } catch (cause) {
      clearTimeout(timer);
      const aborted = cause?.name === "AbortError" || controller.signal.aborted;
      throw new AppError(
        aborted ? "E_TIMEOUT" : "E_UPSTREAM",
        aborted
          ? "The source server did not respond in time."
          : "Could not reach the source server (network error).",
        { status: 504, cause },
      );
    }
    clearTimeout(timer);

    // Redirect handling — re-validate each hop against SSRF rules.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        throw new AppError("E_UPSTREAM", "Source server sent a redirect without a destination.", { status: 502 });
      }
      if (redirectPolicy === "error") {
        res.body?.cancel?.().catch(() => {});
        throw new AppError("E_REDIRECT", "Unexpected redirect from source server.", { status: 502 });
      }
      if (++redirects > MAX_REDIRECTS) {
        throw new AppError("E_REDIRECT", "Too many redirects while fetching the source.", { status: 502 });
      }
      current = new URL(loc, current);
      continue;
    }

    const hs = headersToObject(res.headers);
    const contentType = hs["content-type"] || "";

    if (stream) {
      return {
        url: current.href,
        status: res.status,
        headers: hs,
        body: null,
        stream: res.body,
        contentType,
        redirects,
      };
    }

    // Buffer with a hard cap.
    const { buf, truncated } = await readCapped(res, maxBytes, current.href, {
      truncateOk: Boolean(opts.truncateOk),
    });
    if (truncated && !opts.truncateOk) {
      throw new AppError("E_TOO_LARGE", "The source response was larger than the allowed size.", {
        status: 502,
        details: { url: current.href, maxBytes },
      });
    }
    return {
      url: current.href,
      status: res.status,
      headers: hs,
      body: buf,
      stream: null,
      contentType,
      redirects,
      truncated,
    };
  }
}

async function readCapped(res, maxBytes, urlForError, { truncateOk = false } = {}) {
  if (!res.body) return { buf: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Keep only up to the cap; the caller decides whether truncation is OK.
      const overflow = total - value.byteLength;
      const keep = Math.max(0, maxBytes - overflow);
      if (keep > 0) chunks.push(Buffer.from(value.subarray(0, keep)));
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      return { buf: Buffer.concat(chunks), truncated: true };
    }
    chunks.push(Buffer.from(value));
  }
  return { buf: Buffer.concat(chunks), truncated: false };
}

/** Convenience: fetch + assert 200 + return text. */
export async function safeFetchText(input, opts = {}) {
  const res = await safeFetch(input, { ...opts, accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8" });
  if (res.status >= 400) {
    throw new AppError(
      res.status === 404 ? "E_NOT_FOUND" : "E_UPSTREAM",
      res.status === 404
        ? "The source page was not found (it may have been removed)."
        : `The source server returned HTTP ${res.status}.`,
      { status: res.status === 404 ? 404 : 502, details: { url: res.url } },
    );
  }
  return { ...res, text: res.body.toString("utf8") };
}

/** Convenience: fetch + assert ok + parse JSON. */
export async function safeFetchJson(input, opts = {}) {
  const res = await safeFetch(input, {
    ...opts,
    accept: opts.accept ?? "application/json, text/plain, */*",
  });
  if (res.status >= 400) {
    throw new AppError("E_UPSTREAM", `The source API returned HTTP ${res.status}.`, {
      status: 502,
      details: { url: res.url },
    });
  }
  const text = res.body.toString("utf8");
  try {
    return { ...res, data: JSON.parse(text) };
  } catch (cause) {
    throw new AppError("E_UPSTREAM", "The source API returned a malformed response.", { status: 502, cause });
  }
}

/** True when the content-type header looks like an HTML document. */
export function looksHtml(contentType) {
  return HTML_LIKE.test(contentType || "");
}

/**
 * Sniff the actual media container from the first bytes of a response.
 * Returns one of: "mp4", "m3u8", "mpd", "webm", "mkv", "ts", "mov", "unknown".
 */
export function sniffContainer(headBytes) {
  const b = Buffer.isBuffer(headBytes) ? headBytes : Buffer.from(headBytes || []);
  if (b.length >= 3 && b.subarray(0, 3).toString("latin1") === "\xef\xbb\xbf") b = b.subarray(3);
  const text = b.subarray(0, 16).toString("latin1");
  if (text.startsWith("#EXTM3U") || text.startsWith("#EXTINF")) return "m3u8";
  if (text.startsWith("<?xml") || text.startsWith("<MPD") || b.includes("<MPD")) return "mpd";
  if (b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = b.subarray(8, 12).toString("latin1");
    if (brand.startsWith("qt")) return "mov";
    return "mp4";
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 4 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBM")
    return "webm";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "mkv";
  return "unknown";
}
