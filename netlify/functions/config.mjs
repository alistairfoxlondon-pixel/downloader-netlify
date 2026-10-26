import { siteList } from "../../server/extractors/registry.js";
import { workerHealth } from "../../server/lib/worker.js";
import { errorResponse, json, noContent } from "../../server/http.js";

export const config = { path: "/api/config" };

export default async function handler(request) {
  if (request.method === "OPTIONS") return noContent();
  if (request.method !== "GET") return json({ ok: false, error: { code: "E_METHOD", message: "GET only." } }, 405);
  try {
    const worker = await workerHealth();
    return json({
      ok: true,
      sites: siteList(),
      formats: [
        { id: "mp4", label: "MP4", downloadable: true, previewable: true, note: "Direct download & preview" },
        { id: "hls", label: "HLS (M3U8)", downloadable: "worker", previewable: true, note: "Preview in browser; MP4 via conversion service" },
        { id: "dash", label: "MPEG-DASH (MPD)", downloadable: "worker", previewable: false, note: "Detected; conversion service required" },
        { id: "other", label: "Other containers", downloadable: "worker", previewable: false, note: "Detected when present (WebM, MKV…)" },
      ],
      worker,
      version: "1.0.0",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
