import { extractFromUrl, siteList } from "../../server/extractors/registry.js";
import { signMediaToken } from "../../server/lib/sign.js";
import { rateLimit, clientIp } from "../../server/lib/ratelimit.js";
import { workerHealth } from "../../server/lib/worker.js";
import { AppError } from "../../server/lib/errors.js";
import { errorResponse, json, noContent, readJsonBody, suggestedFilename } from "../../server/http.js";

export const config = { path: "/api/extract" };

const TOKEN_TTL = 15 * 60;

/** Distinct hosts whose fetch failed with a connect-level network error since
 * the last successful extraction. Two distinct hosts + no success = this
 * server's network is restricted (e.g. a sandboxed preview), not "the site is
 * down" — say that plainly instead of a generic upstream error. */
const netFailHosts = new Set();
const isNetFail = (err) =>
  (err?.code === "E_UPSTREAM" && String(err.message).includes("(network error)")) || err?.code === "E_TIMEOUT";
const RESTRICTED_MSG =
  "No video site is reachable from this server (restricted network). Run the app on your own machine or deploy it to Netlify.";

export default async function handler(request) {
  if (request.method === "OPTIONS") return noContent();
  if (request.method !== "POST") {
    return json({ ok: false, error: { code: "E_METHOD", message: "Use POST to extract a video." } }, 405);
  }

  let url = "";
  try {
    const ip = clientIp(request);
    const rl = rateLimit(`extract:${ip}`, {
      capacity: Number(process.env.EXTRACT_BURST || 8),
      refillPerSec: Number(process.env.EXTRACT_PER_MIN || 12) / 60,
      cost: 2,
    });
    if (!rl.ok) {
      return json(
        {
          ok: false,
          error: {
            code: "E_RATE_LIMITED",
            message: `Too many requests — please wait ${rl.retryAfterSec}s and try again.`,
          },
        },
        429,
        { "retry-after": String(rl.retryAfterSec) },
      );
    }

    const body = await readJsonBody(request, 4096);
    url = typeof body?.url === "string" ? body.url : "";
    if (!url.trim()) {
      throw new AppError("E_BAD_URL", "Please paste a video URL.", { status: 400 });
    }

    const result = await extractFromUrl(url);
    netFailHosts.clear(); // network demonstrably works
    const worker = await workerHealth();

    const sources = result.sources.map((s, i) => {
      const name = suggestedFilename(result.title, s.container);
      const mode = s.ipBound ? "proxy" : "auto";
      const previewToken = signMediaToken({ url: s.url, mode, name, ref: result.sourcePage, ttl: TOKEN_TTL });
      const downloadToken = signMediaToken({ url: s.url, mode, name, ref: result.sourcePage, ttl: TOKEN_TTL });
      return {
        id: `s${i + 1}`,
        url: s.url,
        container: s.container,
        protocol: s.protocol,
        quality: s.quality ?? null,
        sizeBytes: s.sizeBytes ?? null,
        verified: s.verified !== false,
        ipBound: Boolean(s.ipBound),
        requiresConversion: Boolean(s.requiresConversion),
        downloadable: s.protocol === "mp4" ? "direct" : s.verified !== false && worker.healthy ? "worker" : false,
        note: s.note || null,
        previewUrl: `/api/media?t=${encodeURIComponent(previewToken)}`,
        downloadUrl: `/api/media?t=${encodeURIComponent(downloadToken)}`,
        expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL,
      };
    });

    return json({
      ok: true,
      site: result.site,
      siteLabel: siteList().find((s) => s.id === result.site)?.label || result.site,
      sourcePage: result.sourcePage,
      title: result.title,
      thumbnail: result.thumbnail || null,
      subtitles: result.subtitles || [],
      sources,
      warnings: result.warnings || [],
      worker: { available: worker.available, healthy: Boolean(worker.healthy) },
      fetchedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL,
    });
  } catch (err) {
    if (isNetFail(err)) {
      try {
        netFailHosts.add(new URL(url).hostname);
      } catch {
        /* unparseable URL — ignore */
      }
      if (netFailHosts.size >= 2) {
        return errorResponse(
          new AppError("E_UPSTREAM", RESTRICTED_MSG, { status: err.status || 504 }),
        );
      }
    }
    return errorResponse(err);
  }
}
