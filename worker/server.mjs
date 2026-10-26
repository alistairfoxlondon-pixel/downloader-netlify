/**
 * Media conversion worker — a small, dependency-free Node service that wraps
 * ffmpeg for HLS/DASH → MP4 remuxing and large file delivery.
 *
 * Run standalone (VPS, Fly.io, Render, Railway, Docker…):
 *   docker build -t mediafetch-worker ./worker
 *   docker run -p 8080:8080 -e WORKER_SECRET=changeme mediafetch-worker
 *
 * Then set MEDIA_WORKER_URL=http://host:8080 and WORKER_SECRET=changeme on the
 * Netlify site (see README). Never expose the worker without a secret.
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const WORKER_SECRET = process.env.WORKER_SECRET || "";
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 4096);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const JOB_TTL_MS = Number(process.env.JOB_TTL_MIN || 120) * 60 * 1000;
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
/** copy = remux only (fast, lossless) | transcode = re-encode | auto = copy then fallback */
const MODE = process.env.CONVERSION_MODE || "auto";

fs.mkdirSync(DATA_DIR, { recursive: true });

const jobs = new Map(); // id -> job
const queue = [];
let active = 0;

// ---------------------------------------------------------------------------
// Security helpers (SSRF + abuse)
// ---------------------------------------------------------------------------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === "::" || v === "::1" || v.startsWith("fe80:") || v.startsWith("fc") ||
      v.startsWith("fd") || v.startsWith("::ffff:") ? (v.startsWith("::ffff:") ? isPrivateIp(v.slice(7)) : true) : v.startsWith("ff");
  }
  return true;
}

async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) URLs are allowed");
  if (u.username || u.password) throw new Error("credentials in URL are not allowed");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error("internal hosts are not allowed");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("private addresses are not allowed");
  } else {
    const records = await dns.lookup(host, { all: true }).catch(() => []);
    if (!records.length) throw new Error("DNS lookup failed");
    for (const r of records) if (isPrivateIp(r.address)) throw new Error("host resolves to a private address");
  }
  return u;
}

function checkAuth(req) {
  if (!WORKER_SECRET) return true; // operator chose to run without auth (not recommended)
  const h = req.headers.authorization || "";
  return h === `Bearer ${WORKER_SECRET}`;
}

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------
function ffVersion(bin) {
  return new Promise((resolve) => {
    execFileP(bin, ["-version"], { timeout: 8000 })
      .then((r) => resolve(String(r.stdout || "").split("\n")[0] || "ok"))
      .catch(() => resolve(null));
  });
}

function probeDuration(url, referer) {
  return new Promise((resolve) => {
    const args = [
      "-v", "error",
      ...(referer ? ["-referer", referer] : []),
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "-show_entries", "format=duration",
      "-of", "json",
      url,
    ];
    execFileP(FFPROBE, args, { timeout: 30000, maxBuffer: 1 << 20 })
      .then((r) => {
        const dur = parseFloat(JSON.parse(r.stdout || "{}")?.format?.duration);
        resolve(Number.isFinite(dur) && dur > 0 ? dur : null);
      })
      .catch(() => resolve(null));
  });
}

function runFfmpeg({ url, referer, outPath, onProgress, transcode }) {
  const args = [
    "-y", "-nostdin", "-loglevel", "info",
    ...(referer ? ["-referer", referer] : []),
    "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "-i", url,
    ...(transcode
      ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k"]
      : ["-c", "copy"]),
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-f", "mp4",
    outPath,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderrTail = "";
    child.stdout.on("data", (d) => {
      const text = String(d);
      const m = /out_time_us=(\d+)/.exec(text);
      if (m) onProgress?.(Number(m[1]) / 1e6);
    });
    child.stderr.on("data", (d) => {
      stderrTail = (stderrTail + String(d)).slice(-4000);
    });
    child.on("error", (e) => reject(new Error(`ffmpeg failed to start: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: …${stderrTail.slice(-600)}`));
    });
  });
}

async function convert(job) {
  job.status = "processing";
  const outPath = path.join(DATA_DIR, `${job.id}.mp4`);
  const duration = await probeDuration(job.url, job.referer);
  const track = (sec) => {
    if (duration) job.progress = Math.max(0, Math.min(99, Math.round((sec / duration) * 100)));
    else job.progress = null;
  };

  const tryCopy = MODE === "transcode" ? false : true;
  try {
    if (tryCopy) {
      await runFfmpeg({ url: job.url, referer: job.referer, outPath, onProgress: track, transcode: false });
    } else {
      await runFfmpeg({ url: job.url, referer: job.referer, outPath, onProgress: track, transcode: true });
    }
  } catch (e1) {
    if (MODE === "copy") {
      job.status = "error";
      job.error = `Remux failed (copy mode): ${e1.message}`;
      return;
    }
    // Fallback: full transcode (needs libx264 in the ffmpeg build).
    try {
      await runFfmpeg({ url: job.url, referer: job.referer, outPath, onProgress: track, transcode: true });
    } catch (e2) {
      job.status = "error";
      job.error = `Conversion failed: ${String(e2.message).slice(0, 800)}`;
      try {
        await fsp.unlink(outPath);
      } catch { /* ignore */ }
      return;
    }
  }

  const stat = await fsp.stat(outPath).catch(() => null);
  if (!stat || stat.size === 0) {
    job.status = "error";
    job.error = "Conversion produced an empty file.";
    return;
  }
  if (stat.size > MAX_FILE_MB * 1024 * 1024) {
    job.status = "error";
    job.error = `Converted file exceeds the configured limit of ${MAX_FILE_MB} MB.`;
    await fsp.unlink(outPath).catch(() => {});
    return;
  }
  job.status = "done";
  job.progress = 100;
  job.file = outPath;
  job.bytes = stat.size;
  job.finishedAt = Date.now();
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (!job || job.status !== "queued") continue;
    active++;
    convert(job)
      .catch((e) => {
        job.status = "error";
        job.error = String(e?.message || e).slice(0, 800);
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, range",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function readBody(req, cap = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > cap) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendFile(req, res, filePath, filename) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      json(res, 404, { ok: false, error: "file not found" });
      return;
    }
    const ascii = (filename || "video.mp4").replace(/[^\x20-\x7e]/g, "_");
    const headers = {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename || "video.mp4")}`,
      "access-control-allow-origin": "*",
    };
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
        end = stat.size - 1;
      }
      headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
      headers["content-length"] = String(end - start + 1);
      res.writeHead(206, headers);
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      headers["content-length"] = String(stat.size);
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const route = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization, range",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    res.end();
    return;
  }

  try {
    if (route === "/health" && req.method === "GET") {
      const [ffmpeg, ffprobe] = await Promise.all([ffVersion(FFMPEG), ffVersion(FFPROBE)]);
      json(res, ffmpeg ? 200 : 503, {
        ok: Boolean(ffmpeg),
        ffmpeg,
        ffprobe,
        mode: MODE,
        active,
        queued: queue.length,
        jobs: jobs.size,
      });
      return;
    }

    if (route === "/jobs" && req.method === "POST") {
      if (!checkAuth(req)) return json(res, 401, { ok: false, error: "unauthorized" });
      const body = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        return json(res, 400, { ok: false, error: "invalid JSON" });
      }
      try {
        await assertPublicUrl(payload.url);
      } catch (e) {
        return json(res, 400, { ok: false, error: e.message });
      }
      const id = crypto.randomBytes(12).toString("hex");
      const job = {
        id,
        status: "queued",
        progress: 0,
        url: payload.url,
        name: String(payload.name || "").slice(0, 200),
        referer: String(payload.referer || "").slice(0, 512),
        error: null,
        file: null,
        createdAt: Date.now(),
      };
      jobs.set(id, job);
      queue.push(job);
      pump();
      return json(res, 202, { id, status: job.status });
    }

    const jobMatch = /^\/jobs\/([\w-]{1,64})$/.exec(route);
    if (jobMatch && req.method === "GET") {
      if (!checkAuth(req)) return json(res, 401, { ok: false, error: "unauthorized" });
      const job = jobs.get(jobMatch[1]);
      if (!job) return json(res, 404, { ok: false, error: "job not found" });
      return json(res, 200, {
        id: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        bytes: job.file ? job.bytes || null : null,
        contentType: "video/mp4",
      });
    }

    const fileMatch = /^\/files\/([\w-]{1,64})$/.exec(route);
    if (fileMatch && req.method === "GET") {
      const job = jobs.get(fileMatch[1]);
      if (!job?.file || job.status !== "done") return json(res, 404, { ok: false, error: "file not ready" });
      const filename = job.name ? job.name.replace(/\.m3u8$/i, "") + ".mp4" : `${job.id}.mp4`;
      return sendFile(req, res, job.file, filename);
    }

    json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    json(res, 500, { ok: false, error: String(e?.message || e).slice(0, 500) });
  }
});

// TTL cleanup for finished jobs + their files.
setInterval(async () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const stamp = job.finishedAt || job.createdAt;
    if (now - stamp > JOB_TTL_MS && job.status !== "processing") {
      if (job.file) await fsp.unlink(job.file).catch(() => {});
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref?.();

server.listen(PORT, HOST, async () => {
  const ffmpeg = await ffVersion(FFMPEG);
  console.log(`[worker] listening on ${HOST}:${PORT}`);
  console.log(`[worker] ffmpeg: ${ffmpeg || "NOT FOUND — conversion will fail until ffmpeg is installed"}`);
  console.log(`[worker] auth: ${WORKER_SECRET ? "bearer secret enabled" : "DISABLED (set WORKER_SECRET)"}`);
});
