import { verifyMediaToken, signMediaToken } from "../../server/lib/sign.js";
import { rateLimit, clientIp } from "../../server/lib/ratelimit.js";
import { safeFetch } from "../../server/lib/safehttp.js";
import { rewritePlaylist } from "../../server/lib/hls.js";
import { AppError } from "../../server/lib/errors.js";
import { errorResponse, json } from "../../server/http.js";

export const config = { path: "/api/media" };

/**
 * Hosts whose links are signed for the IP that fetched them (Streamtape
 * family). Those MUST be proxied — a browser redirect would arrive from the
 * visitor's IP and be rejected upstream.
 */
const PROXY_ONLY_HOST_SUFFIXES = [
  "streamtape.com", "streamtape.net", "streamtape.to", "streamta.pe", "streamtape.site",
  "streamtape.cc", "streamtape.xyz", "strtape.cloud", "strcloud.link", "strcloud.club",
  "scloud.online", "stape.fun",
];

const RANGE_RE = /^bytes=\d*-\d*$/;
const PLAYLIST_RE = /mpegurl|m3u8/i;
const MAX_PLAYLIST_BYTES = 512 * 1024;
/** Downloads proxied through the function must fit Netlify's ~26 s budget. */
const PROXY_DOWNLOAD_MAX_BYTES = Number(process.env.PROXY_DOWNLOAD_MAX_BYTES || 350 * 1024 * 1024);

function mustProxy(hostname) {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  return PROXY_ONLY_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

function isPlaylistUrl(url, contentType) {
  if (PLAYLIST_RE.test(contentType || "")) return true;
  return /\.m3u8([?#]|$)/i.test(url);
}

function contentDisposition(kind, filename) {
  if (!filename) return null;
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(filename);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const BASE_CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers":
    "content-length, content-range, accept-ranges, content-type, content-disposition, etag",
};

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...BASE_CORS,
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "range, content-type",
        "access-control-max-age": "86400",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, error: { code: "E_METHOD", message: "Only GET is supported." } }, 405);
  }

  try {
    const ip = clientIp(request);
    const rl = rateLimit(`media:${ip}`, {
      capacity: Number(process.env.MEDIA_BURST || 120),
      refillPerSec: Number(process.env.MEDIA_PER_MIN || 120) / 60,
      cost: 1,
    });
    if (!rl.ok) {
      return json(
        { ok: false, error: { code: "E_RATE_LIMITED", message: "Too many media requests — slow down." } },
        429,
        { "retry-after": String(rl.retryAfterSec) },
      );
    }

    const u = new URL(request.url);
    const token = u.searchParams.get("t") || "";
    const verified = await verifyMediaToken(token);

    const requestedMode = u.searchParams.get("mode");
    const dl = u.searchParams.get("dl") === "1";
    const mediaUrl = new URL(verified.url);

    let mode = verified.mode || "auto";
    if (mode === "auto") mode = mustProxy(mediaUrl.hostname) ? "proxy" : "redirect";
    if (requestedMode === "proxy" || requestedMode === "redirect") {
      mode = mustProxy(mediaUrl.hostname) ? "proxy" : requestedMode;
    }

    // ---- redirect mode ----------------------------------------------------
    if (mode === "redirect") {
      if (dl && request.method === "GET") {
        // A download must land as a file. Peek at upstream's disposition:
        // if it already forces an attachment, a 302 is enough; otherwise pull
        // through the proxy (up to the size budget) so we can set the header.
        const decision = await upstreamDisposition(verified);
        if (decision === "attachment") {
          return redirectResponse(verified.url);
        }
        if (decision === "unknown-small") {
          return proxyResponse(request, verified, { forceAttachment: true });
        }
        // Large/unknown upstream: fall back to redirect (best effort).
        return redirectResponse(verified.url);
      }
      return redirectResponse(verified.url);
    }

    // ---- proxy mode -------------------------------------------------------
    return await proxyResponse(request, verified, { forceAttachment: dl });
  } catch (err) {
    return errorResponse(err);
  }
}

function redirectResponse(location) {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "private, no-store",
      "access-control-allow-origin": "*",
    },
  });
}

/**
 * HEAD the upstream file (falling back to a 1-byte GET) and decide whether a
 * plain redirect would produce a file download.
 * @returns {Promise<"attachment"|"unknown-small"|"large"|"unknown">}
 */
async function upstreamDisposition(verified) {
  let head;
  try {
    head = await safeFetch(verified.url, {
      method: "HEAD",
      referer: verified.ref || undefined,
      timeoutMs: 8000,
      maxBytes: 4096,
    });
  } catch {
    return "unknown";
  }
  if (head.status >= 400) {
    // HEAD often rejected — try a 1-byte probe.
    try {
      const probe = await safeFetch(verified.url, {
        range: "bytes=0-0",
        referer: verified.ref || undefined,
        timeoutMs: 8000,
        maxBytes: 4096,
        truncateOk: true,
      });
      if (probe.status >= 400) return "unknown";
      const cd = probe.headers["content-disposition"] || "";
      if (/attachment/i.test(cd)) return "attachment";
      const total = probe.headers["content-length"] ? Number(probe.headers["content-length"]) : null;
      if (total && total > PROXY_DOWNLOAD_MAX_BYTES) return "large";
      return "unknown-small";
    } catch {
      return "unknown";
    }
  }
  const cd = head.headers["content-disposition"] || "";
  if (/attachment/i.test(cd)) return "attachment";
  const len = head.headers["content-length"] ? Number(head.headers["content-length"]) : NaN;
  if (Number.isFinite(len) && len > PROXY_DOWNLOAD_MAX_BYTES) return "large";
  if (Number.isFinite(len)) return "unknown-small";
  return "unknown";
}

async function proxyResponse(request, verified, { forceAttachment = false } = {}) {
  const clientRange = request.headers.get("range");
  if (clientRange && !RANGE_RE.test(clientRange)) {
    throw new AppError("E_BAD_RANGE", "Unsupported Range header.", { status: 400 });
  }

  const fetchUpstream = () =>
    safeFetch(verified.url, {
      stream: true,
      range: clientRange || undefined,
      referer: verified.ref || undefined,
      timeoutMs: Number(process.env.MEDIA_FETCH_TIMEOUT_MS || 20000),
    });

  const ensureUsable = (res) => {
    if (res.status >= 400) {
      res.stream?.cancel?.().catch(() => {});
      const friendly =
        res.status === 404
          ? "The media file is no longer available (link expired or file removed)."
          : res.status === 403 || res.status === 401
            ? "The media server rejected this request — the link may be IP-bound, expired, or captcha-protected."
            : `The media server returned HTTP ${res.status}.`;
      throw new AppError(res.status === 404 ? "E_MEDIA_GONE" : "E_ACCESS_DENIED", friendly, {
        status: 502,
        details: { upstreamStatus: res.status },
      });
    }
    if (!res.stream) {
      throw new AppError("E_UPSTREAM", "The media server sent an empty body.", { status: 502 });
    }
    return res;
  };

  let upstream = ensureUsable(await fetchUpstream());

  const headers = { ...BASE_CORS, "cache-control": "private, max-age=300" };
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    if (upstream.headers[h]) headers[h] = upstream.headers[h];
  }

  const wantsPlaylist = isPlaylistUrl(verified.url, upstream.contentType);
  const disposition = contentDisposition(forceAttachment ? "attachment" : "inline", verified.name || null);
  if (disposition) headers["content-disposition"] = disposition;

  if (request.method === "HEAD") {
    upstream.stream.cancel?.().catch(() => {});
    return new Response(null, { status: upstream.status, headers });
  }

  // ---- Byte peek: never stream a web page as if it were the video ---------
  // Hosts intermittently answer media fetches with an HTML interstitial
  // (CAPTCHA/bot wall). Read the first bytes, retry the upstream request once
  // on a fresh connection, and fail honestly if it still is not media.
  const peek = async (stream) => {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (total < 96) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    return { reader, head: Buffer.concat(chunks.map((c) => Buffer.from(c))) };
  };
  const looksLikePage = (ctype, head) => {
    if (PLAYLIST_RE.test(ctype || "")) return false;
    if (/text\/html|application\/xhtml|application\/xml|text\/xml/i.test(ctype || "")) return true;
    const s = head.subarray(0, 64).toString("latin1").trimStart().toLowerCase();
    return s.startsWith("<!doctype html") || s.startsWith("<html") || s.startsWith("<head") || s.startsWith("<error>");
  };

  let peeked = await peek(upstream.stream);
  if (!wantsPlaylist && looksLikePage(upstream.contentType, peeked.head)) {
    // Interstitial — one fresh upstream attempt, then refuse honestly.
    peeked.reader.cancel?.().catch(() => {});
    upstream = ensureUsable(await fetchUpstream());
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      if (upstream.headers[h]) headers[h] = upstream.headers[h];
      else delete headers[h];
    }
    peeked = await peek(upstream.stream);
    if (looksLikePage(upstream.contentType, peeked.head)) {
      peeked.reader.cancel?.().catch(() => {});
      throw new AppError(
        "E_ACCESS_DENIED",
        "The host returned a web page instead of the video (bot check or expired link). Preview/download refused — no fake file is served.",
        { status: 502, details: { contentType: upstream.contentType || null } },
      );
    }
  }

  const pipeHead = (head, reader) =>
    new ReadableStream({
      start(controller) {
        if (head.length) controller.enqueue(head);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

  // ---- HLS playlist rewriting -------------------------------------------
  if (wantsPlaylist && !clientRange) {
    const chunks = [peeked.head];
    let total = peeked.head.length;
    const reader = peeked.reader;
    let tooLarge = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PLAYLIST_BYTES) {
        tooLarge = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(Buffer.from(value));
    }
    if (tooLarge) {
      throw new AppError("E_TOO_LARGE", "Playlist exceeds the proxy size budget.", { status: 502 });
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const rewritten = rewritePlaylist(text, upstream.url, (absUrl) => {
      const child = signMediaToken({
        url: absUrl,
        mode: "proxy",
        name: verified.name,
        ref: verified.ref,
        ttl: 60 * 20,
      });
      return `/api/media?t=${encodeURIComponent(child)}`;
    });
    delete headers["content-length"];
    delete headers["etag"];
    headers["content-type"] = "application/vnd.apple.mpegurl; charset=utf-8";
    headers["cache-control"] = "private, max-age=60";
    return new Response(rewritten, { status: 200, headers });
  }

  return new Response(pipeHead(peeked.head, peeked.reader), { status: upstream.status, headers });
}
