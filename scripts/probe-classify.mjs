#!/usr/bin/env node
/**
 * Replays our exact server-side fetch (server/lib/safehttp.js) against a URL
 * and reports the real status/body sample as a GitHub annotation. Used to
 * compare Node/undici behaviour against curl (scripts/probe-e2e-assets.sh).
 *
 * Usage: node scripts/probe-classify.mjs <url>
 */
import { safeFetch } from "../server/lib/safehttp.js";

const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/probe-classify.mjs <url>");
  process.exit(2);
}

const say = (msg) => {
  const clean = String(msg).replace(/\r?\n/g, " ").slice(0, 450);
  console.log(`::notice title=safeFetch probe::${clean}`);
  console.log(clean);
};

async function attempt(label, opts) {
  try {
    const res = await safeFetch(url, opts);
    const sample = res.body ? res.body.subarray(0, 96).toString("latin1").replace(/[^\x20-\x7e]/g, ".") : "";
    say(
      `${label} → HTTP ${res.status} ct=${res.contentType || "-"} final=${res.url} sample="${sample}"`,
    );
  } catch (e) {
    say(`${label} → THREW ${e.code || "E_UNKNOWN"}: ${e.message} details=${JSON.stringify(e.details || {})}`);
  }
}

const base = {
  range: "bytes=0-2047",
  timeoutMs: 20000,
  maxBytes: 8 * 1024,
  truncateOk: true,
  accept: "*/*",
};

await attempt("plain (range only)", { ...base });
await attempt("with referer+origin", { ...base, referer: url, origin: new URL(url).origin });
await attempt("no range (plain GET)", {
  timeoutMs: 20000,
  maxBytes: 64 * 1024,
  truncateOk: true,
  accept: "*/*",
});
