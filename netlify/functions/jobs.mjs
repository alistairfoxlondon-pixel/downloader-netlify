import { createConversionJob, getConversionJob, workerFileUrl, workerHealth } from "../../server/lib/worker.js";
import { assertSafeUrlWithDns, parseHttpUrl } from "../../server/lib/urlguard.js";
import { rateLimit, clientIp } from "../../server/lib/ratelimit.js";
import { AppError } from "../../server/lib/errors.js";
import { errorResponse, json, noContent, readJsonBody } from "../../server/http.js";

export const config = { path: "/api/jobs" };

export default async function handler(request) {
  if (request.method === "OPTIONS") return noContent();

  try {
    const ip = clientIp(request);

    if (request.method === "POST") {
      // Conversions are expensive — tight per-client bucket.
      const rl = rateLimit(`jobs:${ip}`, {
        capacity: Number(process.env.JOBS_BURST || 3),
        refillPerSec: Number(process.env.JOBS_PER_MIN || 4) / 60,
        cost: 1,
      });
      if (!rl.ok) {
        return json(
          { ok: false, error: { code: "E_RATE_LIMITED", message: "Too many conversion requests — wait a moment." } },
          429,
          { "retry-after": String(rl.retryAfterSec) },
        );
      }

      const body = await readJsonBody(request, 4096);
      const url = parseHttpUrl(body?.url || "");
      await assertSafeUrlWithDns(url);

      const job = await createConversionJob({
        url: url.href,
        name: typeof body?.name === "string" ? body.name.slice(0, 200) : "",
        referer: typeof body?.referer === "string" ? body.referer.slice(0, 512) : "",
      });
      return json({ ok: true, id: job.id, status: job.status || "queued" }, 202);
    }

    if (request.method === "GET") {
      const id = new URL(request.url).searchParams.get("id") || "";
      if (!id || !/^[\w-]{1,64}$/.test(id)) {
        throw new AppError("E_BAD_REQUEST", "Missing or malformed job id.", { status: 400 });
      }
      const status = await getConversionJob(id);
      return json({
        ok: true,
        id,
        status: status.status,
        progress: typeof status.progress === "number" ? status.progress : null,
        error: status.error || null,
        downloadUrl: status.status === "done" ? workerFileUrl(id) : null,
        contentType: status.contentType || "video/mp4",
      });
    }

    return json({ ok: false, error: { code: "E_METHOD", message: "Use GET or POST." } }, 405);
  } catch (err) {
    return errorResponse(err);
  }
}
