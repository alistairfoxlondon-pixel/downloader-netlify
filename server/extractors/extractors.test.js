import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Deterministic DNS: every host resolves to a public test IP except localhost.
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: async (host) => {
      if (/localhost|127\.0\.0\.1|^::1$/.test(host)) return [{ address: "127.0.0.1", family: 4 }];
      return [{ address: "93.184.216.34", family: 4 }];
    },
  },
}));

import { extractFromUrl } from "./registry.js";
import { AppError } from "../lib/errors.js";

// ---------------------------------------------------------------------------
// fetch router helpers
// ---------------------------------------------------------------------------
const FTYP = (() => {
  const b = Buffer.alloc(2048);
  b.write("isom", 4, "latin1"); // wait: bytes 4..8 must be ftyp
  b.writeUInt32BE(0, 0);
  b.write("ftyp", 4, "latin1");
  b.write("isom", 8, "latin1");
  return b;
})();

function resp(body, { status = 200, headers = {}, contentType } = {}) {
  const h = new Headers(headers);
  if (contentType) h.set("content-type", contentType);
  return new Response(body, { status, headers: h });
}

function json(data, status = 200) {
  return resp(JSON.stringify(data), { status, contentType: "application/json" });
}

function rangeMp4(totalBytes) {
  return resp(FTYP, {
    status: 206,
    headers: {
      "content-range": `bytes 0-2047/${totalBytes}`,
      "accept-ranges": "bytes",
      "content-type": "video/mp4",
    },
  });
}

/** Install a router: fn(url, init) -> Response | undefined (undefined => 404). */
function installRouter(fn) {
  const mock = vi.fn(async (input, init) => {
    let url;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else url = input?.url ?? String(input);
    const out = fn(url, init || {}) ?? resp("not found", { status: 404 });
    return out;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const MASTER_M3U8 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1173000,RESOLUTION=520x1080
master_x.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=536000,RESOLUTION=344x720
https://cdn.test/hls/master_h.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=257000,RESOLUTION=232x480
https://cdn.test/hls/master_n.m3u8
`;

beforeEach(() => {
  delete process.env.MEDIA_SIGNING_SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Streamtape
// ---------------------------------------------------------------------------
describe("streamtape extractor", () => {
  const PAGE_URL = "https://streamtape.com/v/74AwoLa6xQCAAQ4/1792525423448.mp4";
  const TOKEN_QUERY = "id=74AwoLa6xQCAAQ4&expires=1793040436&ip=F0yRKRINKxSHDN&token=Hn6bHeR5d88r";

  const pageHtml = `
    <html><head><title>1792525423448.mp4 at Streamtape.com</title></head>
    <body>
      <h1>1792525423448.mp4</h1>
      <div>2.64 MB</div>
      <textarea>Embed this video:
/streamtape.com/get_viddeo?${TOKEN_QUERY}
//streamtape.com/get_video?${TOKEN_QUERY}
      </textarea>
      <iframe src="//streamtape.com/get_video?${TOKEN_QUERY}"></iframe>
      <script>
        document.getElementById('video').src = '//streamtape.com/get_video?${TOKEN_QUERY}';
      </script>
    </body></html>`;

  it("extracts and verifies a direct MP4 with IP-bound token", async () => {
    installRouter((url) => {
      if (url.startsWith("https://streamtape.com/v/")) {
        return resp(pageHtml, { contentType: "text/html; charset=utf-8" });
      }
      if (url.includes("get_video") && url.includes("stream=1")) {
        return rangeMp4(2771195);
      }
      return undefined;
    });

    const out = await extractFromUrl(PAGE_URL);
    expect(out.site).toBe("streamtape");
    expect(out.title).toBe("1792525423448.mp4");
    expect(out.sources).toHaveLength(1);
    const s = out.sources[0];
    expect(s.protocol).toBe("mp4");
    expect(s.container).toBe("mp4");
    expect(s.ipBound).toBe(true);
    expect(s.verified).toBe(true);
    expect(s.sizeBytes).toBe(2771195);
    expect(s.url).toContain("https://streamtape.com/get_video?");
    expect(s.url).toContain("token=Hn6bHeR5d88r");
    expect(s.url).toContain("stream=1");
    expect(s.requiresConversion).toBe(false);
  }, 20000);

  it("reports E_NOT_FOUND for deleted videos", async () => {
    installRouter((url) => {
      if (url.startsWith("https://streamtape.com/v/")) {
        return resp("<html><body>This video has been deleted</body></html>", {
          contentType: "text/html",
        });
      }
      return undefined;
    });
    await expect(extractFromUrl(PAGE_URL)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });

  it("surfaces E_EXTRACT_FAILED when no link exists (honest failure)", async () => {
    installRouter((url) =>
      url.startsWith("https://streamtape.com/v/")
        ? resp("<html><body><h1>1792525423448.mp4</h1>captcha wall</body></html>", {
            contentType: "text/html",
          })
        : undefined,
    );
    await expect(extractFromUrl(PAGE_URL)).rejects.toMatchObject({ code: "E_EXTRACT_FAILED" });
  });
});

// ---------------------------------------------------------------------------
// Vidara
// ---------------------------------------------------------------------------
describe("vidara extractor", () => {
  it("POSTs /api/stream and enumerates HLS variants", async () => {
    const mock = installRouter((url, init) => {
      if (url === "https://vidara.to/api/stream") {
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body)).toEqual({ filecode: "qY27dmqIAWJ3O", device: "web" });
        return json({
          title: "kendnxn",
          thumbnail: "https://cdn.vidara.to/thumbs/abc.jpg",
          streaming_url: "https://vcdn.vidara.example/hls/qY27/master.m3u8",
          subtitles: [{ language: "English", file_path: "/subs/en.vtt" }],
        });
      }
      if (url.includes("master.m3u8")) return resp(MASTER_M3U8, { contentType: "application/vnd.apple.mpegurl" });
      return undefined;
    });

    const out = await extractFromUrl("https://vidara.to/v/qY27dmqIAWJ3O");
    expect(out.site).toBe("vidara");
    expect(out.title).toBe("kendnxn");
    expect(out.thumbnail).toBe("https://cdn.vidara.to/thumbs/abc.jpg");
    expect(out.subtitles).toEqual([{ label: "English", url: "https://vidara.to/subs/en.vtt" }]);
    expect(out.sources).toHaveLength(3);
    expect(out.sources.map((s) => s.quality.label)).toEqual(["1080p HD", "720p HD", "480p"]);
    expect(out.sources.every((s) => s.protocol === "hls" && s.requiresConversion && s.verified)).toBe(true);
    expect(mock).toHaveBeenCalled();
  }, 20000);

  it("reports E_EXTRACT_FAILED when the API returns no URL", async () => {
    installRouter((url) => (url.endsWith("/api/stream") ? json({ msg: "not found" }) : undefined));
    await expect(extractFromUrl("https://vidara.to/v/deleted123")).rejects.toMatchObject({
      code: "E_EXTRACT_FAILED",
    });
  });
});

// ---------------------------------------------------------------------------
// Firestream
// ---------------------------------------------------------------------------
describe("firestream extractor", () => {
  it("reads token-blob, resolves via API, sniffs extensionless MP4", async () => {
    installRouter((url, init) => {
      if (url.startsWith("https://firestream.to/e/")) {
        return resp(
          `<html><head><meta property="og:title" content="FireStream Video"/></head>
           <body><script id="token-blob" type="application/json">{"k":"blob123"}</script></body></html>`,
          { contentType: "text/html" },
        );
      }
      if (url === "https://firestream.to/api/videos/5MVxhqei/resolve") {
        expect(init.method).toBe("POST");
        expect(String(init.headers["content-type"])).toContain("x-www-form-urlencoded");
        expect(decodeURIComponent(String(init.body))).toContain("blob123");
        return json({ signedVideoUrl: "https://cdn.firestream.example/dl/5MVxhqei?st=abc&e=99" });
      }
      if (url.includes("cdn.firestream.example")) return rangeMp4(10485760);
      return undefined;
    });

    const out = await extractFromUrl("https://firestream.to/e/5MVxhqei");
    expect(out.site).toBe("firestream");
    expect(out.title).toBe("FireStream Video");
    expect(out.sources).toHaveLength(1);
    const s = out.sources[0];
    expect(s.protocol).toBe("mp4");
    expect(s.container).toBe("mp4");
    expect(s.sizeBytes).toBe(10485760);
    expect(s.url).toContain("signedVideoUrl" in s ? "x" : "cdn.firestream.example");
    expect(s.verified).toBe(true);
  }, 20000);

  it("fails honestly when no token is present", async () => {
    installRouter((url) =>
      url.startsWith("https://firestream.to/e/")
        ? resp("<html><body>adblock wall</body></html>", { contentType: "text/html" })
        : undefined,
    );
    await expect(extractFromUrl("https://firestream.to/e/5MVxhqei")).rejects.toMatchObject({
      code: "E_EXTRACT_FAILED",
    });
  });
});

// ---------------------------------------------------------------------------
// Playmate
// ---------------------------------------------------------------------------
describe("playmate extractor", () => {
  it("POSTs /api/s (JSON) and lists HLS variants + subtitles + title", async () => {
    installRouter((url, init) => {
      if (url === "https://playmate.to/api/s") {
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body)).toEqual({ c: "Nh93AdD9E6cl5", d: "web" });
        return json({
          sx: "https://pm.cdn.example/hls/Nh93/master.m3u8",
          kx: [{ sl: "English", sf: "https://pm.cdn.example/subs/en.vtt" }],
        });
      }
      if (url.includes("video-meta")) return json({ success: true, title: "My Clip" });
      if (url.includes("master.m3u8")) return resp(MASTER_M3U8, { contentType: "application/vnd.apple.mpegurl" });
      return undefined;
    });

    const out = await extractFromUrl("https://playmate.to/watch/Nh93AdD9E6cl5");
    expect(out.site).toBe("playmate");
    expect(out.title).toBe("My Clip");
    expect(out.subtitles).toEqual([{ label: "English", url: "https://pm.cdn.example/subs/en.vtt" }]);
    expect(out.sources).toHaveLength(3);
    expect(out.sources[0].quality.label).toBe("1080p HD");
  }, 20000);

  it("maps upstream outage to E_UPSTREAM (site currently 522 in the wild)", async () => {
    installRouter((url) => (url === "https://playmate.to/api/s" ? resp("bad gateway", { status: 502 }) : undefined));
    await expect(extractFromUrl("https://playmate.to/watch/Nh93AdD9E6cl5")).rejects.toMatchObject({
      code: "E_UPSTREAM",
    });
  });
});

// ---------------------------------------------------------------------------
// LuluStream / LuluVdo
// ---------------------------------------------------------------------------
describe("lulustream extractor", () => {
  it("finds the sources[] entry, filters captions and probes the MP4", async () => {
    installRouter((url) => {
      if (url.startsWith("https://luluvido.com/66ms4l6xkfb9")) {
        return resp(
          `<html><head><title>01 - Lulustream.mp4</title>
           <meta property="og:image" content="/thumbs/01.jpg"/></head>
           <body><script>
             var player = videojs('v');
             player.src({ sources: [{file: "https://lulu.cdn.example/vod/01.mp4", type: "video/mp4"}],
               tracks: [{file: "https://lulu.cdn.example/vod/01.en.vtt", label: "English"},
                        {file: "https://lulu.cdn.example/vod/up.vtt", label: "Upload captions"}]
             });
           </script></body></html>`,
          { contentType: "text/html" },
        );
      }
      if (url.includes("lulu.cdn.example/vod/01.mp4")) return rangeMp4(28940697);
      return undefined;
    });

    const out = await extractFromUrl("https://luluvido.com/66ms4l6xkfb9");
    expect(out.site).toBe("lulustream");
    expect(out.title).toBe("01 - Lulustream.mp4");
    expect(out.thumbnail).toBe("https://luluvido.com/thumbs/01.jpg");
    expect(out.subtitles).toHaveLength(1);
    expect(out.subtitles[0].label).toBe("English");
    const s = out.sources[0];
    expect(s.protocol).toBe("mp4");
    expect(s.sizeBytes).toBe(28940697);
    expect(s.verified).toBe(true);
  }, 20000);

  it("unpacks packed player scripts (Dean Edwards) without eval", async () => {
    // packed payload: sources: [{file: "https://lulu.cdn.example/a.mp4"}]
    const dict = ["sources", "file", "https://lulu.cdn.example/a.mp4"];
    const body = encodeURIComponent('0:[{1:"2"}]').replace(/'/g, "%27");
    const packed = `eval(function(p,a,c,k,e,r){return p}('${body}',62,3,'${dict.join("|")}'.split('|'),0,{}))`;
    installRouter((url) => {
      if (url.startsWith("https://luluvdo.com/abc123")) {
        return resp(`<html><head><title>x</title></head><body><script>${packed}</script></body></html>`, {
          contentType: "text/html",
        });
      }
      if (url.includes("lulu.cdn.example/a.mp4")) return rangeMp4(5000);
      return undefined;
    });
    const out = await extractFromUrl("https://luluvdo.com/abc123");
    expect(out.sources[0].url).toBe("https://lulu.cdn.example/a.mp4");
  }, 20000);
});

// ---------------------------------------------------------------------------
// StreamFile
// ---------------------------------------------------------------------------
describe("streamfile extractor", () => {
  it("reads plyrHlsSrc, parses variants and maps host-reported sizes", async () => {
    const masterUrl =
      "https://fs1.streamfiles.site/hls2/01/00002/,2xdgz3t2bphw_l,2xdgz3t2bphw_n,.urlset/master.m3u8?t=abc&s=1792970647";
    const page = `<html><head><title>Watch </title>
      <meta property="og:image" content="https://streamfile.net/thumbs/03.jpg"/></head>
      <body>
        <h1>03</h1>
        <script>var plyrHlsSrc='${masterUrl}';</script>
        <div id="premium"><strong>1080p quality</strong>520x1080, 8.7 MB
        <strong>720p quality</strong>344x720, 4.0 MB
        <strong>480p quality</strong>232x480, 2.0 MB
        <strong>360p quality</strong>172x360, 1.3 MB</div>
      </body></html>`;
    installRouter((url) => {
      if (url.startsWith("https://streamfile.net/2xdgz3t2bphw")) return resp(page, { contentType: "text/html" });
      if (url.includes("streamfiles.site")) return resp(MASTER_M3U8, { contentType: "application/vnd.apple.mpegurl" });
      return undefined;
    });

    const out = await extractFromUrl("https://streamfile.net/2xdgz3t2bphw");
    expect(out.site).toBe("streamfile");
    expect(out.title).toBe("03");
    expect(out.thumbnail).toContain("streamfile.net/thumbs/03.jpg");
    expect(out.sources).toHaveLength(3);
    expect(out.sources[0].quality.label).toBe("1080p HD");
    // Sizes harvested from the page's quality ladder:
    expect(out.sources[0].sizeBytes).toBe(Math.round(8.7 * 1024 * 1024));
    expect(out.sources[1].sizeBytes).toBe(Math.round(4.0 * 1024 * 1024));
    expect(out.warnings.some((w) => w.code === "W_PREMIUM_HOST")).toBe(true);
  }, 20000);
});

// ---------------------------------------------------------------------------
// Generic direct URLs
// ---------------------------------------------------------------------------
describe("direct URL extractor", () => {
  it("verifies a plain .mp4 URL via range probe", async () => {
    installRouter((url) => (url === "https://cdn.example.org/files/movie.mp4" ? rangeMp4(12345678) : undefined));
    const out = await extractFromUrl("https://cdn.example.org/files/movie.mp4");
    expect(out.site).toBe("direct");
    expect(out.sources[0].protocol).toBe("mp4");
    expect(out.sources[0].sizeBytes).toBe(12345678);
    expect(out.sources[0].downloadable ?? true).toBeTruthy();
  }, 20000);

  it("parses a master .m3u8 URL into quality options", async () => {
    installRouter((url) =>
      url === "https://cdn.example.org/live/master.m3u8"
        ? resp(MASTER_M3U8, { contentType: "application/vnd.apple.mpegurl" })
        : undefined,
    );
    const out = await extractFromUrl("https://cdn.example.org/live/master.m3u8");
    expect(out.sources).toHaveLength(3);
    expect(out.sources.every((s) => s.container === "m3u8" && s.requiresConversion)).toBe(true);
  }, 20000);

  it("refuses DRM-protected HLS with E_DRM", async () => {
    const drmPlaylist = `#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"\n#EXTINF:4,\nseg.ts\n`;
    installRouter((url) =>
      url === "https://cdn.example.org/drm.m3u8" ? resp(drmPlaylist, { contentType: "application/x-mpegURL" }) : undefined,
    );
    await expect(extractFromUrl("https://cdn.example.org/drm.m3u8")).rejects.toMatchObject({ code: "E_DRM" });
  }, 20000);

  it("discovers og:video on HTML pages", async () => {
    installRouter((url) => {
      if (url === "https://blog.example.com/post/1") {
        return resp(
          `<html><head><title>Post</title>
            <meta property="og:video" content="https://cdn.example.org/clip.mp4"/></head>
            <body>hello</body></html>`,
          { contentType: "text/html" },
        );
      }
      if (url.includes("clip.mp4")) return rangeMp4(999);
      return undefined;
    });
    const out = await extractFromUrl("https://blog.example.com/post/1");
    expect(out.sources[0].url).toContain("clip.mp4");
  }, 20000);

  it("returns E_NO_MEDIA for pages without any media (no fake links)", async () => {
    installRouter((url) =>
      url === "https://blog.example.com/text-only"
        ? resp("<html><head><title>No video</title></head><body>text</body></html>", {
            contentType: "text/html",
          })
        : undefined,
    );
    await expect(extractFromUrl("https://blog.example.com/text-only")).rejects.toMatchObject({
      code: "E_NO_MEDIA",
    });
  }, 20000);
});

// ---------------------------------------------------------------------------
// Registry routing
// ---------------------------------------------------------------------------
describe("registry routing", () => {
  it("routes by domain and falls back to direct", async () => {
    const { matchExtractor } = await import("./registry.js");
    expect(matchExtractor(new URL("https://streamtape.com/v/x")).id).toBe("streamtape");
    expect(matchExtractor(new URL("https://www.vidara.to/v/x")).id).toBe("vidara");
    expect(matchExtractor(new URL("https://firestream.site/e/x")).id).toBe("firestream");
    expect(matchExtractor(new URL("https://playmate.to/watch/x")).id).toBe("playmate");
    expect(matchExtractor(new URL("https://luluvido.com/x")).id).toBe("lulustream");
    expect(matchExtractor(new URL("https://streamfile.net/x")).id).toBe("streamfile");
    expect(matchExtractor(new URL("https://random.example.com/v.mp4")).id).toBe("direct");
  });

  it("rejects non-http input before any fetch", async () => {
    await expect(extractFromUrl("ftp://x/y")).rejects.toThrow(AppError);
    await expect(extractFromUrl("")).rejects.toThrow(AppError);
  });
});
