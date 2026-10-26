import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: async (host) => {
      if (/localhost|127\.0\.0\.1/.test(host)) return [{ address: "127.0.0.1", family: 4 }];
      return [{ address: "93.184.216.34", family: 4 }];
    },
  },
}));

import mediaHandler from "./media.mjs";
import extractHandler from "./extract.mjs";
import configHandler from "./config.mjs";
import { signMediaToken } from "../../server/lib/sign.js";

const FTYP = (() => {
  const b = Buffer.alloc(2048);
  b.writeUInt32BE(0, 0);
  b.write("ftyp", 4, "latin1");
  b.write("isom", 8, "latin1");
  return b;
})();

function installRouter(fn) {
  const mock = vi.fn(async (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input?.url;
    return fn(url, init || {}) ?? new Response("nope", { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function req(path, { method = "GET", body, headers = {} } = {}) {
  return new Request(`https://app.local${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  delete process.env.MEDIA_SIGNING_SECRET;
  // Generous buckets so tests never trip the (production) rate limiter.
  process.env.EXTRACT_BURST = "100";
  process.env.EXTRACT_PER_MIN = "600";
});
afterEach(() => {
  delete process.env.EXTRACT_BURST;
  delete process.env.EXTRACT_PER_MIN;
  vi.unstubAllGlobals();
});

describe("GET /api/config", () => {
  it("returns sites, formats and worker status", async () => {
    const res = await configHandler(req("/api/config"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sites.map((s) => s.id)).toContain("streamtape");
    expect(data.formats.some((f) => f.id === "hls")).toBe(true);
    expect(data.worker.available).toBe(false); // no MEDIA_WORKER_URL in tests
  });
});

describe("POST /api/extract", () => {
  it("extracts a direct MP4 and returns signed preview/download links", async () => {
    installRouter((url) => {
      if (url === "https://cdn.example.org/movie.mp4") {
        return new Response(FTYP, {
          status: 206,
          headers: {
            "content-range": "bytes 0-2047/5000000",
            "content-type": "video/mp4",
            "accept-ranges": "bytes",
          },
        });
      }
      return undefined;
    });

    const res = await extractHandler(req("/api/extract", { method: "POST", body: { url: "https://cdn.example.org/movie.mp4" } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0].previewUrl).toMatch(/^\/api\/media\?t=/);
    expect(data.sources[0].downloadUrl).toMatch(/^\/api\/media\?t=/);
    expect(data.sources[0].container).toBe("mp4");
    expect(data.sources[0].sizeBytes).toBe(5000000);
    expect(data.worker.healthy).toBe(false);
    expect(data.sources[0].downloadable).toBe("direct");
  }, 20000);

  it("explains restricted egress after network failures from two distinct hosts", async () => {
    installRouter(() => {
      throw new TypeError("fetch failed"); // connect-level failure
    });

    const first = await extractHandler(
      req("/api/extract", { method: "POST", body: { url: "https://alpha.example/video.mp4" } }),
    );
    expect(first.status).toBe(504);
    const firstBody = await first.json();
    expect(firstBody.error.code).toBe("E_UPSTREAM");
    expect(firstBody.error.message).toMatch(/network error/i);

    const second = await extractHandler(
      req("/api/extract", { method: "POST", body: { url: "https://beta.example/video.mp4" } }),
    );
    expect(second.status).toBe(504);
    const secondBody = await second.json();
    expect(secondBody.error.code).toBe("E_UPSTREAM");
    expect(secondBody.error.message).toMatch(/restricted network/i);
    expect(secondBody.error.message).toMatch(/deploy it to Netlify/i);
  });

  it("rejects invalid URLs with 400 and a clear code", async () => {
    const res = await extractHandler(req("/api/extract", { method: "POST", body: { url: "not-a-url" } }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("E_BAD_URL");
  });

  it("rejects non-POST methods", async () => {
    const res = await extractHandler(req("/api/extract"));
    expect(res.status).toBe(405);
  });
});

describe("GET /api/media", () => {
  it("rejects missing/invalid tokens", async () => {
    const res = await mediaHandler(req("/api/media"));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe("E_BAD_TOKEN");
  });

  it("redirects in redirect mode", async () => {
    const token = signMediaToken({ url: "https://cdn.example.org/movie.mp4", mode: "redirect" });
    const res = await mediaHandler(req(`/api/media?t=${encodeURIComponent(token)}`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.example.org/movie.mp4");
  });

  it("proxies with Range passthrough and CORS headers", async () => {
    const token = signMediaToken({ url: "https://cdn.example.org/movie.mp4", mode: "proxy", name: "Movie.mp4" });
    const mock = installRouter((url, init) => {
      expect(url).toBe("https://cdn.example.org/movie.mp4");
      expect(init.headers.range).toBe("bytes=100-199");
      return new Response(FTYP.subarray(100, 200), {
        status: 206,
        headers: {
          "content-range": "bytes 100-199/5000000",
          "content-type": "video/mp4",
        },
      });
    });

    const res = await mediaHandler(
      new Request(`https://app.local/api/media?t=${encodeURIComponent(token)}`, {
        headers: { range: "bytes=100-199" },
      }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/5000000");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-disposition")).toContain("Movie.mp4");
    expect(mock).toHaveBeenCalled();
    await res.arrayBuffer();
  });

  it("forces proxy mode for IP-bound Streamtape hosts even when redirect is requested", async () => {
    const token = signMediaToken({ url: "https://streamtape.com/get_video?id=x", mode: "auto" });
    installRouter((url, init) => {
      expect(url).toContain("streamtape.com");
      return new Response(FTYP, { status: 200, headers: { "content-type": "video/mp4" } });
    });
    const res = await mediaHandler(
      new Request(`https://app.local/api/media?t=${encodeURIComponent(token)}&mode=redirect`),
    );
    expect(res.status).toBe(200); // proxied, not 302
    await res.arrayBuffer();
  });

  it("rewrites proxied HLS playlists to child proxy tokens", async () => {
    const playlist = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
variant_low.m3u8
#EXTINF:4,
seg0.ts
`;
    const token = signMediaToken({ url: "https://cdn.example.org/hls/master.m3u8", mode: "proxy" });
    installRouter((url) => {
      expect(url).toContain("master.m3u8");
      return new Response(playlist, { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" } });
    });

    const res = await mediaHandler(
      new Request(`https://app.local/api/media?t=${encodeURIComponent(token)}`),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360");
    // every rewritten URI points back at our tokenised proxy; decode the
    // signed payloads to prove they pin the expected upstream URLs:
    const uris = [...text.matchAll(/\/api\/media\?t=([\w-]+)\.[\w-]+/g)];
    expect(uris.length).toBe(3);
    const pinned = uris.map((m) => JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")).u);
    expect(pinned).toEqual([
      "https://cdn.example.org/hls/key.bin",
      "https://cdn.example.org/hls/variant_low.m3u8",
      "https://cdn.example.org/hls/seg0.ts",
    ]);
  });

  it("answers OPTIONS preflight with CORS headers", async () => {
    const res = await mediaHandler(new Request("https://app.local/api/media", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("range");
  });

  it("retries once when upstream answers with an HTML interstitial, then streams the real file", async () => {
    let calls = 0;
    installRouter(() => {
      calls += 1;
      if (calls === 1) {
        return new Response("<html><body>Checking your browser…</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response(FTYP, {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": String(FTYP.length), "accept-ranges": "bytes" },
      });
    });
    const token = signMediaToken({ url: "https://cdn.example.org/movie.mp4", mode: "proxy", name: "Movie.mp4" });
    const res = await mediaHandler(new Request(`https://app.local/api/media?t=${encodeURIComponent(token)}`));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(calls).toBe(2);
  });

  it("refuses honestly when upstream keeps serving HTML — never streams a page as a file", async () => {
    installRouter(
      () =>
        new Response("<html><body>captcha</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const token = signMediaToken({ url: "https://cdn.example.org/movie.mp4", mode: "proxy", name: "Movie.mp4" });
    const res = await mediaHandler(new Request(`https://app.local/api/media?t=${encodeURIComponent(token)}`));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe("E_ACCESS_DENIED");
    expect(data.error.message).toMatch(/web page instead of the video/i);
  });

  it("maps upstream 403 to a friendly proxy error (no raw leak)", async () => {
    const token = signMediaToken({ url: "https://cdn.example.org/gone.mp4", mode: "proxy" });
    installRouter(() => new Response("forbidden", { status: 403 }));
    const res = await mediaHandler(
      new Request(`https://app.local/api/media?t=${encodeURIComponent(token)}`),
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.code).toBe("E_ACCESS_DENIED");
    expect(data.error.message).toMatch(/IP-bound|expired|captcha/i);
  });
});
