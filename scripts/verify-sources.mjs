/**
 * Live verification of every supplied source URL.
 *
 * Runs from a machine with full internet access (GitHub Actions runner in CI;
 * any dev machine locally). For each URL it records, honestly and without
 * skipping steps:
 *   1. page accessibility            6. download start/finish (bounded)
 *   2. media URL extraction          7. file validity (ffprobe when present)
 *   3. detected format               8. genuine container (mp4 vs other)
 *   4. preview feasibility           9. quality options detected
 *   5. copy-link target sanity      10. limitations (CORS, expiry, gating…)
 *
 * Output: reports/TEST_REPORT.generated.md (+ .json for tooling).
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractFromUrl } from "../server/extractors/registry.js";
import { parseHttpUrl } from "../server/lib/urlguard.js";
import { sniffContainer, safeFetch } from "../server/lib/safehttp.js";

const execFileP = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const URLS_FILE = process.argv[2] || path.join(ROOT, "scripts/probe-urls.txt");
const OUT_DIR = path.join(ROOT, "reports");
const MAX_DOWNLOAD_BYTES = Number(process.env.VERIFY_MAX_DOWNLOAD_BYTES || 25 * 1024 * 1024);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ORIGIN = "https://mediafetch.example"; // CORS probe origin

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readUrls() {
  return fs
    .readFileSync(URLS_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function hasFfprobe() {
  try {
    await execFileP("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function ffprobe(file) {
  const { stdout } = await execFileP(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height", "-of", "json", file],
    { timeout: 30000 },
  );
  return JSON.parse(stdout);
}

/** Step 1 — fetch the source page the way a browser would. */
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      contentType: res.headers.get("content-type"),
      bytes: buf.length,
      title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(buf.toString("latin1"))?.[1]?.trim() || null,
      redirected: res.redirected,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Step 4 — can a player actually start this source? */
async function probePreview(source) {
  const out = { method: null, ok: false, detail: null };
  try {
    if (source.protocol === "hls") {
      const res = await safeFetch(source.url, {
        accept: "application/vnd.apple.mpegurl,*/*",
        maxBytes: 512 * 1024,
        referer: source.referrer || undefined,
        timeoutMs: 20000,
      });
      const text = res.body.toString("utf8");
      out.method = "HLS playlist fetch";
      out.ok = res.status === 200 && text.startsWith("#EXTM3U");
      out.detail = out.ok
        ? `playlist OK (${text.split(/\r?\n/).filter(Boolean).length} lines)`
        : `HTTP ${res.status}`;
      // Segment byte probe for media playlists (or first variant):
      if (out.ok && !text.includes("#EXT-X-STREAM-INF")) {
        const firstSeg = text.split(/\r?\n/).find((l) => l && !l.startsWith("#"));
        if (firstSeg) {
          const segUrl = new URL(firstSeg, source.url).href;
          const seg = await safeFetch(segUrl, { range: "bytes=0-375", maxBytes: 1024, truncateOk: true, timeoutMs: 20000 });
          const b = seg.body;
          const tsSync = seg.status === 206 || seg.status === 200 ? b[0] === 0x47 && (b.length < 188 || b[188] === 0x47) : false;
          const isFmp4 = b.length >= 8 && b.subarray(4, 8).toString("latin1") === "ftyp";
          out.ok = out.ok && (tsSync || isFmp4 || seg.status === 200);
          out.detail += `; first segment HTTP ${seg.status} (${tsSync ? "MPEG-TS sync bytes OK" : isFmp4 ? "fMP4 init segment OK" : b.length > 16 && b[0] === 0x47 ? "TS sync" : "unidentified head: " + b.subarray(0, 8).toString("hex")})`;
        }
      }
      return out;
    }
    // MP4 / other: range probe to confirm the bytes are media.
    const res = await safeFetch(source.url, { range: "bytes=0-4095", maxBytes: 8192, truncateOk: true, timeoutMs: 20000 });
    const sn = sniffContainer(res.body);
    out.method = "byte-range probe + magic sniff";
    out.ok = res.status < 400 && sn !== "unknown" && sn !== "m3u8";
    out.detail = `HTTP ${res.status}, sniffed=${sn}, content-type=${res.headers["content-type"] || "?"}`;
    return out;
  } catch (e) {
    out.detail = String(e?.message || e);
    return out;
  }
}

/** Steps 6–8 — download a bounded sample (or full file) and validate it. */
async function verifyDownload(source) {
  const out = { attempted: false, started: false, completed: false, bytes: 0, container: null, ffprobe: null, error: null };
  if (source.protocol !== "mp4") {
    out.error = "not applicable — HLS/DASH sources cannot be downloaded as MP4 without conversion (by design)";
    return out;
  }
  out.attempted = true;
  const tmp = path.join(OUT_DIR, `.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(source.url, {
      headers: { "user-agent": UA, referer: source.referrer || undefined },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    out.started = true;
    out.contentType = res.headers.get("content-type");
    const ws = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let total = 0;
    let head = Buffer.alloc(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (head.length < 64) head = Buffer.concat([head, Buffer.from(value).subarray(0, 64)]);
      ws.write(Buffer.from(value));
      if (total > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        break;
      }
    }
    ws.end();
    await new Promise((r) => ws.on("finish", r));
    out.bytes = total;
    out.completed = total > 0 && total <= MAX_DOWNLOAD_BYTES;
    out.container = sniffContainer(head) === "unknown" && head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp" ? "mp4" : sniffContainer(head);
    if (!out.completed && total > MAX_DOWNLOAD_BYTES) {
      out.error = `file larger than the ${MAX_DOWNLOAD_BYTES} byte verification cap — downloaded first ${total} bytes only`;
    }
    // structural checks: ftyp + moov + mdat present somewhere in the file
    const data = fs.readFileSync(tmp);
    const hasFtyp = data.length >= 12 && data.subarray(4, 8).toString("latin1") === "ftyp";
    const hasMoov = data.includes(Buffer.from("moov"));
    const hasMdat = data.includes(Buffer.from("mdat"));
    out.structure = { ftyp: hasFtyp, moov: hasMoov, mdat: hasMdat };
    if (out.container === "unknown" && data.length) {
      // Keep a short sanitized sample of what the server actually sent so the
      // report can show, e.g., an HTML CAPTCHA wall instead of guessing.
      out.responseHead = data.subarray(0, 240).toString("latin1").replace(/\s+/g, " ").trim();
    }
    if (out.completed && (!hasFtyp || !hasMoov)) {
      out.error = `structure check failed (ftyp=${hasFtyp}, moov=${hasMoov}) — not a valid MP4`;
    }
    if (FFPROBE && out.completed) {
      try {
        const info = await ffprobe(tmp);
        const v = (info.streams || []).find((s) => s.codec_type === "video");
        out.ffprobe = {
          format: info.format?.format_name,
          durationSec: info.format?.duration ? Number(info.format.duration) : null,
          videoCodec: v?.codec_name || null,
          width: v?.width || null,
          height: v?.height || null,
        };
        out.genuinelyMp4 = Boolean(v) && String(info.format?.format_name || "").includes("mp4");
      } catch (e) {
        out.ffprobe = { error: String(e?.message || e).slice(0, 300) };
      }
    }
  } catch (e) {
    out.error = String(e?.message || e);
  } finally {
    clearTimeout(timer);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Step 10 — CORS + expiry observations for the media URL. */
async function probeRestrictions(source) {
  const out = { cors: null, expiryHints: [], notes: [] };
  try {
    const res = await fetch(source.url, {
      method: "HEAD",
      headers: { "user-agent": UA, origin: ORIGIN, referer: source.referrer || undefined },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    }).catch(() => null);
    if (res) {
      out.cors = {
        status: res.status,
        accessControlAllowOrigin: res.headers.get("access-control-allow-origin"),
        acceptRanges: res.headers.get("accept-ranges"),
        contentDisposition: res.headers.get("content-disposition"),
      };
      out.notes.push(
        res.headers.get("access-control-allow-origin")
          ? "CDN sends Access-Control-Allow-Origin (direct hls.js preview possible)"
          : "CDN does NOT send Access-Control-Allow-Origin for the probing origin — preview must fall back to the media proxy",
      );
    }
    const u = new URL(source.url);
    for (const key of ["expires", "e", "ttl", "token", "sig", "signature", "t"]) {
      if (u.searchParams.has(key)) out.expiryHints.push(`${key}=${u.searchParams.get(key).slice(0, 24)}`);
    }
    if (source.ipBound) out.notes.push("Link embeds ip=/token= (bound to the fetching IP) — downloads are proxied");
  } catch (e) {
    out.notes.push(`restriction probe failed: ${String(e?.message || e)}`);
  }
  return out;
}

const FFPROBE = await hasFfprobe();

async function verifyOne(url, index) {
  const row = { url, index };
  console.log(`\n=== [${index}] ${url}`);
  row.page = await fetchPage(url);
  console.log(`  page: ${row.page.ok ? `HTTP ${row.page.status} → ${row.page.finalUrl}` : `FAILED ${row.page.error}`}`);
  await sleep(800);
  try {
    const result = await extractFromUrl(url);
    row.extract = {
      ok: true,
      site: result.site,
      title: result.title,
      thumbnail: result.thumbnail,
      sourceCount: result.sources.length,
      warnings: result.warnings,
      subtitles: result.subtitles.length,
    };
    console.log(`  extract: OK — ${result.sources.length} source(s), site=${result.site}`);
    row.sources = [];
    for (const s of result.sources) {
      const src = { ...s, referrer: result.sourcePage };
      src.preview = await probePreview(src);
      console.log(`  preview [${s.container}/${s.quality?.label || "default"}]: ${src.preview.ok ? "OK" : "FAIL"} (${src.preview.detail})`);
      await sleep(500);
      if (row.sources.length === 0 || s.protocol === "mp4") {
        src.download = await verifyDownload(src);
        console.log(
          `  download: ${src.download.completed ? `COMPLETED ${src.download.bytes} bytes` : src.download.started ? `PARTIAL ${src.download.bytes} bytes` : "N/A"}${src.download.error ? ` (${src.download.error})` : ""}`,
        );
        if (src.download.ffprobe) console.log(`  ffprobe: ${JSON.stringify(src.download.ffprobe)}`);
        await sleep(500);
      }
      src.restrictions = await probeRestrictions(src);
      if (src.restrictions.cors) console.log(`  CORS ACAO: ${src.restrictions.cors.accessControlAllowOrigin || "(none)"}`);
      row.sources.push(src);
    }
    row.copyTarget = row.sources[0]?.url || null;
    row.copyOk = Boolean(row.copyTarget && /^https?:\/\//.test(row.copyTarget));
  } catch (e) {
    row.extract = { ok: false, code: e?.code || "E_UNKNOWN", message: String(e?.message || e) };
    console.log(`  extract: FAILED [${row.extract.code}] ${row.extract.message}`);
  }
  await sleep(1200);
  return row;
}

function renderMarkdown(rows) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push("# Source Verification Test Report");
  lines.push("");
  lines.push(`- Generated: \`${now}\``);
  lines.push(`- Runner: \`${process.env.RUNNER_OS || process.platform}\` · Node \`${process.version}\``);
  lines.push(`- ffprobe available: **${FFPROBE ? "yes" : "no"}**`);
  lines.push(`- Verification download cap: **${MAX_DOWNLOAD_BYTES} bytes**`);
  lines.push("");
  lines.push("Per-URL results are machine-generated from live network requests performed by `scripts/verify-sources.mjs`.");
  lines.push("Every item below reflects an actual observation — failures and limitations are recorded as-is.");
  lines.push("");

  let allPass = 0;
  let allTotal = 0;
  for (const r of rows) {
    lines.push(`## ${r.index}. ${r.url}`);
    lines.push("");
    const e = r.extract;
    const checks = [
      ["1. Page accessible", r.page.ok ? `PASS — HTTP ${r.page.status}${r.page.finalUrl !== r.url ? ` → ${r.page.finalUrl}` : ""}${r.page.title ? ` · title “${r.page.title}”` : ""}` : `FAIL — ${r.page.error || `HTTP ${r.page.status}`}`],
      ["2. Media URL extracted", e.ok ? `PASS — ${e.sourceCount} URL(s) found (site: ${e.site})` : `FAIL — [${e.code}] ${e.message}`],
      e.ok
        ? ["3. Detected format(s)", [...new Set(r.sources.map((s) => `${s.container} (${s.protocol})`))].join(", ")]
        : ["3. Detected format(s)", "—"],
      e.ok
        ? [
            "4. Preview playback path",
            r.sources.map((s) => `${s.container}/${s.quality?.label || "default"}: ${s.preview.ok ? "READY" : `NOT VERIFIED (${s.preview.detail})`}`).join(" · "),
          ]
        : ["4. Preview playback path", "—"],
      e.ok ? ["5. Copy media URL", r.copyOk ? `PASS — copy target is a well-formed absolute URL (${r.copyTarget.slice(0, 80)}…)` : "FAIL"] : ["5. Copy media URL", "—"],
    ];
    const mp4 = r.sources?.find((s) => s.protocol === "mp4");
    const dl = mp4?.download;
    checks.push(
      e.ok
        ? ["6. Download starts & completes", dl ? (dl.completed ? `PASS — ${dl.bytes} bytes downloaded` : dl.started ? `PARTIAL — ${dl.bytes} bytes (${dl.error})` : `FAIL — ${dl.error}`) : "N/A — no direct-MP4 source"]
        : ["6. Download starts & completes", "—"],
    );
    checks.push(
      dl?.ffprobe
        ? ["7. File is a valid video",
            dl.ffprobe.error
              ? `FAIL — ffprobe: ${dl.ffprobe.error}${dl.contentType ? ` · content-type=${dl.contentType}` : ""}${dl.responseHead ? ` · server sent: “${dl.responseHead.slice(0, 160)}”` : ""}`
              : `PASS — ffprobe: ${dl.ffprobe.videoCodec} ${dl.ffprobe.width || "?"}×${dl.ffprobe.height || "?"}, ${dl.ffprobe.durationSec || "?"}s, format=${dl.ffprobe.format}`]
        : ["7. File is a valid video", dl?.attempted ? "NOT VERIFIED (ffprobe unavailable or download incomplete)" : "N/A"],
    );
    checks.push(
      dl
        ? ["8. Genuinely MP4?", dl.ffprobe && !dl.ffprobe.error ? (dl.genuinelyMp4 ? "PASS — MP4 container confirmed by ffprobe" : `ATTENTION — ffprobe reports “${dl.ffprobe.format}”`) : `Structure: ftyp=${dl.structure?.ftyp}, moov=${dl.structure?.moov}, mdat=${dl.structure?.mdat} (sniff: ${dl.container})`]
        : ["8. Genuinely MP4?", "N/A — source is not a direct MP4 (conversion required for MP4)"],
    );
    checks.push(
      e.ok
        ? [
            "9. Quality options",
            r.sources.length
              ? r.sources.map((s) => `${s.quality?.label || "default"}${s.sizeBytes ? ` (${Math.round(s.sizeBytes / 1048576)} MB)` : ""}`).join(", ")
              : "none detected",
          ]
        : ["9. Quality options", "—"],
    );
    const lims = [];
    if (r.page.ok && r.page.redirected) lims.push(`page redirects → ${r.page.finalUrl}`);
    if (e.ok) {
      for (const s of r.sources) for (const n of s.restrictions?.notes || []) lims.push(`${s.container}: ${n}`);
      for (const w of e.warnings || []) lims.push(`extractor warning: ${w.message}`);
      for (const s of r.sources) for (const hint of s.restrictions?.expiryHints || []) lims.push(`expiring/signed param: ${hint}`);
      if (r.sources.some((s) => s.requiresConversion)) lims.push("HLS/DASH: MP4 requires the conversion worker (not exercised in this run unless deployed)");
    } else {
      lims.push(`extraction blocked: [${e.code}] ${e.message}`);
    }
    checks.push(["10. Limitations / restrictions", lims.length ? lims.map((l) => `• ${l}`).join("\n  ") : "none observed"]);

    for (const [label, val] of checks) {
      allTotal++;
      if (typeof val === "string" && val.startsWith("PASS")) allPass++;
      lines.push(`- **${label}:** ${val}`);
      if (typeof val === "string" && val.startsWith("N/A")) allTotal--;
      if (typeof val === "string" && val.startsWith("—")) allTotal--;
    }
    lines.push("");
  }
  lines.push(`---`);
  lines.push(`Checks passed: **${allPass}/${allTotal}** (items marked N/A are excluded).`);
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const urls = readUrls();
console.log(`Verifying ${urls.length} URL(s)… ffprobe=${FFPROBE}`);
const rows = [];
let i = 0;
for (const url of urls) {
  i++;
  rows.push(await verifyOne(url, i));
}

const md = renderMarkdown(rows);
fs.writeFileSync(path.join(OUT_DIR, "TEST_REPORT.generated.md"), md);
fs.writeFileSync(path.join(OUT_DIR, "TEST_REPORT.generated.json"), JSON.stringify(rows, null, 2));
console.log(`\nWrote ${path.join("reports", "TEST_REPORT.generated.md")}`);
console.log(md.split("\n").filter((l) => l.startsWith("## ") || l.startsWith("- **1.")).join("\n"));
