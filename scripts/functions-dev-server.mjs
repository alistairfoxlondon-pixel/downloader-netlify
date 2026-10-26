/**
 * Local emulator for the Netlify Functions (v2 handlers with `config.path`).
 * Mounts the exact handler modules used in production at their configured
 * paths, so `npm run dev` exercises the real extraction/security code paths.
 */
import http from "node:http";
import { Readable } from "node:stream";

const PORT = Number(process.env.FUNCTIONS_PORT || 8899);
const HOST = process.env.FUNCTIONS_HOST || "0.0.0.0";

const modules = [
  "../netlify/functions/extract.mjs",
  "../netlify/functions/media.mjs",
  "../netlify/functions/config.mjs",
  "../netlify/functions/jobs.mjs",
];

const routes = new Map(); // path -> handler

for (const rel of modules) {
  const mod = await import(rel);
  const handler = mod.default;
  const path = mod.config?.path;
  if (!path || typeof handler !== "function") {
    console.error(`[functions] skipping ${rel}: missing default export or config.path`);
    continue;
  }
  routes.set(path, handler);
  console.log(`[functions] mounted ${path} <- ${rel}`);
}

function incomingToRequest(req) {
  const url = `http://${req.headers.host || "localhost"}${req.url || "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else if (v !== undefined) headers.set(k, v);
  }
  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(req);
  return new Request(url, { method, headers, body, duplex: "half" });
}

async function writeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key === "transfer-encoding" || key === "connection") return;
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(response.body);
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  const handler = routes.get(pathname);
  if (!handler) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: { code: "E_NOT_FOUND", message: `No function at ${pathname}` } }));
    return;
  }
  try {
    const request = incomingToRequest(req);
    const response = await handler(request, { waitUntil() {} });
    await writeResponse(res, response);
  } catch (err) {
    console.error("[functions] handler crashed:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error: { code: "E_INTERNAL", message: "Function crashed." } }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[functions] dev server listening on http://${HOST}:${PORT}`);
});
