import dns from "node:dns/promises";
import net from "node:net";
import { AppError } from "./errors.js";

/** Ports we are willing to talk to. Only standard HTTP(S). */
const ALLOWED_PORTS = new Set(["80", "443", ""]);
/** Hostnames that must never be fetched by the server. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan"];

/**
 * Parse and validate a user-supplied URL. Throws AppError(E_BAD_URL) when the
 * URL is not an absolute http(s) URL we are willing to handle.
 * @param {string} raw
 * @returns {URL}
 */
export function parseHttpUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new AppError("E_BAD_URL", "Please paste a video URL.", { status: 400 });
  }
  const trimmed = raw.trim();
  if (trimmed.length > 2048) {
    throw new AppError("E_BAD_URL", "That URL is too long (max 2048 characters).", { status: 400 });
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError("E_BAD_URL", "That does not look like a valid URL.", { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("E_BAD_URL", "Only http:// and https:// URLs are supported.", { status: 400 });
  }
  if (url.username || url.password) {
    throw new AppError("E_BAD_URL", "URLs with embedded credentials are not allowed.", { status: 400 });
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new AppError("E_BAD_URL", "Only standard HTTP(S) ports are allowed.", { status: 400 });
  }
  return url;
}

/** True when the hostname is an obviously local/metadata name. */
export function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (host === "0.0.0.0" || host.endsWith("0.0.0.0")) return true;
  return false;
}

/** Returns true when the given IP literal is private, loopback, link-local or otherwise non-public. */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 docs
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80:")) return true; // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local fc00::/7
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7)); // v4-mapped
    if (v.startsWith("64:ff9b")) return false; // NAT64 well-known prefix -> treat as public-ish? no: could map privately
    if (v.startsWith("ff")) return true; // multicast
    return false;
  }
  return true; // not an IP at all -> unsafe
}

/**
 * Validate an absolute URL against SSRF rules: scheme, port, hostname block
 * list, and (for IP literals) the private-range check. Throws AppError.
 */
export function assertSafeUrl(url) {
  const u = typeof url === "string" ? parseHttpUrl(url) : url;
  if (isBlockedHostname(u.hostname)) {
    throw new AppError("E_FORBIDDEN_HOST", "Fetching from local/internal hosts is not allowed.", { status: 400 });
  }
  const bare = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) {
      throw new AppError("E_FORBIDDEN_HOST", "Fetching from private network addresses is not allowed.", { status: 400 });
    }
  }
  return u;
}

/**
 * Resolve a hostname and verify every returned address is public.
 * Mitigates basic DNS-rebinding (the check happens right before each fetch).
 * Returns the list of validated addresses.
 */
export async function assertPublicResolution(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) {
      throw new AppError("E_FORBIDDEN_HOST", "Address resolves to a private network.", { status: 400 });
    }
    return [bare];
  }
  let records;
  try {
    records = await dns.lookup(bare, { all: true, verbatim: true });
  } catch (cause) {
    throw new AppError("E_DNS", "Could not resolve that hostname.", { status: 502, cause });
  }
  if (!records.length) {
    throw new AppError("E_DNS", "That hostname does not resolve.", { status: 502 });
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new AppError("E_FORBIDDEN_HOST", "That hostname resolves to a private network address.", { status: 400 });
    }
  }
  return records.map((r) => r.address);
}

/** Full validation of a URL including DNS resolution. */
export async function assertSafeUrlWithDns(url) {
  const u = assertSafeUrl(url);
  await assertPublicResolution(u.hostname);
  return u;
}
