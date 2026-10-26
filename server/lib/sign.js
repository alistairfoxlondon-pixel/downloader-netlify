import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 15 * 60;

function secret() {
  return process.env.MEDIA_SIGNING_SECRET || "dev-only-insecure-secret-change-me";
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function hmac(payloadB64) {
  return crypto.createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

/**
 * Mint a signed, expiring capability token for the /api/media endpoint.
 * The signed payload pins the exact media URL so the proxy can never be used
 * as an open relay for arbitrary destinations (SSRF / abuse protection).
 *
 * @param {{url: string, mode?: "auto"|"redirect"|"proxy", name?: string, ttl?: number}} opts
 * @returns {string} token
 */
export function signMediaToken({ url, mode = "auto", name = "", ref = "", ttl = DEFAULT_TTL_SECONDS }) {
  const exp = Math.floor(Date.now() / 1000) + (ttl || DEFAULT_TTL_SECONDS);
  const payload = b64url(JSON.stringify({ u: url, m: mode, n: name.slice(0, 200), r: ref.slice(0, 512), e: exp }));
  return `${payload}.${hmac(payload)}`;
}

/**
 * Verify a token minted by {@link signMediaToken}.
 * @returns {{url: string, mode: string, name: string, exp: number}}
 * @throws {AppError} when invalid or expired
 */
export async function verifyMediaToken(token) {
  const { AppError } = await import("./errors.js");
  if (typeof token !== "string" || !token.includes(".")) {
    throw new AppError("E_BAD_TOKEN", "Missing or malformed media token.", { status: 401 });
  }
  const idx = token.lastIndexOf(".");
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError("E_BAD_TOKEN", "Media token signature is invalid.", { status: 401 });
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new AppError("E_BAD_TOKEN", "Media token payload is corrupt.", { status: 401 });
  }
  if (!data || typeof data.u !== "string" || typeof data.e !== "number") {
    throw new AppError("E_BAD_TOKEN", "Media token payload is incomplete.", { status: 401 });
  }
  if (data.e < Math.floor(Date.now() / 1000)) {
    throw new AppError("E_TOKEN_EXPIRED", "This media link has expired — fetch the video again.", { status: 401 });
  }
  return { url: data.u, mode: data.m || "auto", name: data.n || "", ref: typeof data.r === "string" ? data.r : "", exp: data.e };
}
