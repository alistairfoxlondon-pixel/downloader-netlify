import { describe, it, expect } from "vitest";
import { parseM3u8, isDrmProtected, rewritePlaylist } from "./hls.js";

const MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=1173000,RESOLUTION=520x1080,CODECS="avc1.640028,mp4a.40.2"
l,2xdgz3t2bphw_x,.urlset/variant_x.m3u8?t=abc
#EXT-X-STREAM-INF:BANDWIDTH=536000,RESOLUTION=344x720
https://fs1.example.site/hls/variant_h.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=257000,RESOLUTION=232x480
variant_n.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=167000,RESOLUTION=172x360
variant_l.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:6.000,
seg0.ts
#EXTINF:6.000,
seg1.ts
#EXTINF:4.200,
seg2.ts
#EXT-X-ENDLIST
`;

describe("parseM3u8 – master playlists", () => {
  const p = parseM3u8(MASTER, "https://cdn.example.site/hls/01/master.m3u8");

  it("detects master playlists with 4 variants", () => {
    expect(p.isMaster).toBe(true);
    expect(p.variants).toHaveLength(4);
  });

  it("parses resolutions, bandwidth and labels", () => {
    const v = p.variants[0];
    expect(v.resolution).toEqual({ width: 520, height: 1080 });
    expect(v.bandwidth).toBe(1173000);
    expect(v.label).toBe("1080p HD");
    expect(p.variants.map((x) => x.label)).toEqual(["1080p HD", "720p HD", "480p", "360p"]);
  });

  it("resolves relative variant URIs against the playlist URL", () => {
    expect(p.variants[1].url).toBe("https://fs1.example.site/hls/variant_h.m3u8");
    expect(p.variants[2].url).toBe("https://cdn.example.site/hls/01/variant_n.m3u8");
    expect(p.variants[0].url).toContain("https://cdn.example.site/hls/01/l,");
  });

  it("reports no encryption", () => {
    expect(p.encryption).toBe("none");
    expect(isDrmProtected(p)).toBe(false);
  });
});

describe("parseM3u8 – media playlists", () => {
  const p = parseM3u8(MEDIA, "https://cdn.example.site/hls/01/variant_l.m3u8");
  it("is a media playlist with segments and duration", () => {
    expect(p.isMaster).toBe(false);
    expect(p.isMediaPlaylist).toBe(true);
    expect(p.segments).toBe(3);
    expect(p.durationSec).toBe(16);
  });
  it("rejects non-playlists", () => {
    expect(() => parseM3u8("<html></html>", "https://x/")).toThrow(/Not an M3U8/);
  });
});

describe("DRM detection", () => {
  it("flags SAMPLE-AES (DRM) and allows AES-128 (common VOD encryption)", () => {
    const drm = parseM3u8(
      `#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"\n#EXTINF:4,\nseg.ts\n`,
      "https://x/y.m3u8",
    );
    expect(isDrmProtected(drm)).toBe(true);
    const aes = parseM3u8(
      `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://x/key"\n#EXTINF:4,\nseg.ts\n`,
      "https://x/y.m3u8",
    );
    expect(isDrmProtected(aes)).toBe(false);
    expect(aes.encryption).toBe("aes-128");
  });
});

describe("rewritePlaylist", () => {
  it("rewrites bare URIs, EXT-X-KEY and EXT-X-MAP URIs to the proxy", () => {
    const text = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x9c7db8778570d05c3f9ae7afbafa6123
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4,
seg0.ts
#EXTINF:4,
https://other.example.com/seg1.ts
`;
    const out = rewritePlaylist(text, "https://cdn.example.com/hls/pl.m3u8", (abs) => `/api/media?t=tok(${abs})`);
    expect(out).toContain('URI="/api/media?t=tok(https://cdn.example.com/hls/key.bin)"');
    expect(out).toContain('URI="/api/media?t=tok(https://cdn.example.com/hls/init.mp4)"');
    expect(out).toContain("/api/media?t=tok(https://cdn.example.com/hls/seg0.ts)");
    expect(out).toContain("/api/media?t=tok(https://other.example.com/seg1.ts)");
    expect(out).toContain("#EXTINF:4,");
  });

  it("leaves non-http URIs untouched", () => {
    const text = `#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc"\n#EXTINF:4,\nseg.ts\n`;
    const out = rewritePlaylist(text, "https://cdn.example.com/p.m3u8", (abs) => `PROXY(${abs})`);
    expect(out).toContain('URI="skd://abc"');
  });
});
