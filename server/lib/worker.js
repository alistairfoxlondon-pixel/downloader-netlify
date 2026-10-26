import { AppError } from "./errors.js";

/**
 * Client for the optional external media-processing worker (see /worker).
 * The worker is a small ffmpeg service (Docker) that remuxes HLS/DASH to MP4
 * and can serve full downloads that would exceed Netlify's function limits.
 * When MEDIA_WORKER_URL is not configured every helper reports disabled —
 * the UI then never offers a conversion it cannot perform.
 */

const TIMEOUT_MS = 6000;
let healthCache = { at: 0, ok: false, info: null };
const HEALTH_TTL_MS = 45_000;

export function workerConfigured() {
  return Boolean(process.env.MEDIA_WORKER_URL);
}

function base() {
  return String(process.env.MEDIA_WORKER_URL || "").replace(/\/+$/, "");
}

function workerSecretHeaders() {
  const secret = process.env.WORKER_SECRET || "";
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

/** @returns {Promise<{available: boolean, healthy: boolean, info?: object}>} */
export async function workerHealth(force = false) {
  if (!workerConfigured()) return { available: false, healthy: false };
  const now = Date.now();
  if (!force && now - healthCache.at < HEALTH_TTL_MS) {
    return { available: true, healthy: healthCache.ok, info: healthCache.info };
  }
  try {
    const res = await fetch(`${base()}/health`, {
      headers: workerSecretHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const info = res.ok ? await res.json().catch(() => ({})) : {};
    healthCache = { at: now, ok: res.ok, info };
    return { available: true, healthy: res.ok, info };
  } catch {
    healthCache = { at: now, ok: false, info: null };
    return { available: true, healthy: false };
  }
}

/**
 * Ask the worker to convert a media URL to MP4.
 * @param {{url: string, name?: string, referer?: string}} job
 */
export async function createConversionJob(job) {
  const health = await workerHealth();
  if (!health.available) {
    throw new AppError(
      "E_NO_WORKER",
      "Conversion service is not configured on this deployment — set MEDIA_WORKER_URL to enable HLS→MP4 conversion.",
      { status: 503 },
    );
  }
  if (!health.healthy) {
    throw new AppError("E_WORKER_DOWN", "The conversion service is configured but not responding right now.", {
      status: 503,
    });
  }
  const res = await fetch(`${base()}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...workerSecretHeaders() },
    body: JSON.stringify(job),
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    throw new AppError("E_WORKER_ERROR", data?.error || `Conversion service error (HTTP ${res.status}).`, {
      status: 502,
    });
  }
  return data; // {id}
}

/** @returns {Promise<object>} job status */
export async function getConversionJob(id) {
  if (!workerConfigured()) {
    throw new AppError("E_NO_WORKER", "Conversion service is not configured.", { status: 503 });
  }
  const res = await fetch(`${base()}/jobs/${encodeURIComponent(id)}`, {
    headers: workerSecretHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new AppError("E_WORKER_ERROR", data?.error || `Conversion service error (HTTP ${res.status}).`, {
      status: 502,
    });
  }
  return data;
}

/** Absolute URL (server-side only, never handed to browsers as localhost). */
export function workerFileUrl(id) {
  return `${base()}/files/${encodeURIComponent(id)}`;
}
