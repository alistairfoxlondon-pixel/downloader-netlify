/**
 * Small in-memory token-bucket rate limiter.
 *
 * NOTE: Netlify Functions are stateless per instance, so this limits abuse
 * per warm instance only. For strict global limits plug in an edge KV store
 * (see README "Scaling & abuse protection"); this still stops bursts from
 * the same client hitting the same instance repeatedly.
 */

const buckets = new Map(); // key -> { tokens, updatedAt }

// Periodically drop idle buckets so memory cannot grow unbounded.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now - b.updatedAt > 60 * 60 * 1000) buckets.delete(key);
  }
}, 10 * 60 * 1000);
sweeper.unref?.();

export function configureRateLimit(opts = {}) {
  return opts;
}

/**
 * Consume one token from `key`'s bucket.
 * @param {string} key
 * @param {{capacity?: number, refillPerSec?: number, cost?: number}} [cfg]
 * @returns {{ok: boolean, retryAfterSec: number, remaining: number}}
 */
export function rateLimit(key, cfg = {}) {
  const capacity = cfg.capacity ?? Number(process.env.RATE_LIMIT_BURST || 12);
  const refillPerSec = cfg.refillPerSec ?? Number(process.env.RATE_LIMIT_PER_MIN || 20) / 60;
  const cost = cfg.cost ?? 1;
  const now = Date.now();

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, updatedAt: now };
    buckets.set(key, b);
  }
  const elapsedSec = (now - b.updatedAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
  b.updatedAt = now;

  if (b.tokens < cost) {
    const deficit = cost - b.tokens;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(deficit / refillPerSec)), remaining: 0 };
  }
  b.tokens -= cost;
  return { ok: true, retryAfterSec: 0, remaining: Math.floor(b.tokens) };
}

/** Extract a plausible client IP from platform headers (best effort). */
export function clientIp(request) {
  const h = request.headers;
  const nf = h.get("x-nf-client-connection-ip");
  if (nf) return nf;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = h.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
