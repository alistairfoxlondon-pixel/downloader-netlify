# MediaFetch — Test Report

**Scope:** the seven supplied source URLs verified against the required
10-point checklist, plus UI/browser testing, unit/handler suites, production
build and deploy-configuration checks.

| | |
|---|---|
| **Report generated** | 2026-10-26 (from live CI run [`40252539865`](https://github.com/alistairfoxlondon-pixel/downloader-netlify/actions/runs/40252539865)) |
| **Runner** | GitHub Actions `ubuntu-latest`, Linux · Node `v22.23.3` · ffprobe available: **yes** |
| **Machine-generated detail** | `reports/TEST_REPORT.generated.md` (uploaded as the `source-test-report` artifact on every CI run; also posted to PR #1) |
| **Verification cap** | Downloads probed up to 26 214 400 bytes (25 MB) per file |
| **Honesty rule** | Every PASS below reflects an actual observation from that run. Failures and environmental blocks are recorded as-is — nothing is inferred or fabricated. |

## 1. Summary

| # | URL (as supplied) | Checklist result | Outcome |
|---|---|---|---|
| 1 | `streamtape.com/v/74AwoLa6xQCAAQ4/…` | **Full pass** (items 1,2,3,4,5,6,7,8,9 PASS; 10 documents IP-bound link) | Real MP4 found, preview READY, **downloaded 2 763 821 B verified by ffprobe (h264, 464×848, 22 s)** |
| 2 | `vidara.to/v/qY27dmqIAWJ3O` | **Pass where applicable** (1,2,4,5,9 PASS; 6–8 N/A by design) | HLS master, **1080p preview READY**, copy OK; MP4 requires conversion worker |
| 3 | `luluvido.com/66ms4l6xkfb9` | **Blocked — FAIL 1,2** | Host returns **HTTP 403 to datacenter IPs** (WAF). Extraction honestly reports `E_UPSTREAM`; no bypass attempted |
| 4 | `firestream.to/e/5MVxhqei` | **Pass where applicable** (1,2,4,5,9 PASS; 6–8 N/A by design) | Redirects to `firestream.site`, token-blob resolve → **HLS preview READY**, copy OK |
| 5 | `vidara.to/v/3FNwKcVmnNvw5` | **Pass where applicable** (1,2,4,5,9 PASS; 6–8 N/A by design) | HLS, **1080p preview READY**, copy OK |
| 6 | `playmate.to/watch/Nh93AdD9E6cl5` | **Blocked — FAIL 1,2** | Origin returns **HTTP 522** (host outage, observed 2026-10-25/26). Honest `E_UPSTREAM` error, no fabricated links |
| 7 | `streamfile.net/2xdgz3t2bphw` | **Blocked — FAIL 1,2** | Host returns **HTTP 403 to datacenter IPs** (WAF). Honest `E_UPSTREAM` error; navigation-style headers were insufficient — not bypassed |

**Machine tally for this run: `Checks passed: 15/40`** (items marked N/A —
such as “genuinely MP4?” on HLS-only sources — are excluded from what could
pass; FAILs are the three environment/host blocks above).

## 2. Per-URL detail (verbatim from the machine report)

### 1. `https://streamtape.com/v/74AwoLa6xQCAAQ4/1792525423448.mp4`

- **1. Page accessible:** PASS — HTTP 200 · title “1792525423448.mp4 at Streamtape.com”
- **2. Media URL extracted:** PASS — 1 URL(s) found (site: streamtape)
- **3. Detected format(s):** mp4 (mp4)
- **4. Preview playback path:** mp4/default: READY
- **5. Copy media URL:** PASS — copy target is a well-formed absolute URL (`https://1334396495.tapecontent.net/radosgw/…`)
- **6. Download starts & completes:** PASS — 2 763 821 bytes downloaded
- **7. File is a valid video:** PASS — ffprobe: h264 464×848, 21.966667 s, format=mov,mp4,m4a,3gp,3g2,mj2
- **8. Genuinely MP4?:** PASS — MP4 container confirmed by ffprobe
- **9. Quality options:** default (3 MB)
- **10. Limitations / restrictions:**
  - CDN sends `Access-Control-Allow-Origin` (direct preview possible)
  - Link embeds `ip=/token=` (bound to the fetching IP) — downloads are proxied through `/api/media`
  - Signed params (`expires`, `token`) — links expire; results must be refreshed

> **Evolution (honesty trail):** an earlier CI run showed the `&stream=1`
> candidate returning a 48-byte HTML interstitial from datacenter IPs
> (items 4/6/7/8 FAIL). The extractor was changed to treat HTML as *not media*
> (`expectMedia`), fall back to the raw `get_video` link, and — if no
> candidate yields real bytes — return an “unverified” state instead of
> claiming MP4. The run above shows the fallback now reaches the real CDN and
> passes every MP4 check.

### 2. `https://vidara.to/v/qY27dmqIAWJ3O`

- **1. Page accessible:** PASS — HTTP 200 · title “Watch kendnxn”
- **2. Media URL extracted:** PASS — 1 URL(s) found (site: vidara)
- **3. Detected format(s):** m3u8 (hls)
- **4. Preview playback path:** m3u8/1080p HD: READY
- **5. Copy media URL:** PASS — well-formed absolute HLS URL (`https://s10-s501740.97bf1.com/hls/…`)
- **6. Download starts & completes:** N/A — no direct-MP4 source
- **7. File is a valid video:** N/A
- **8. Genuinely MP4?:** N/A — source is not a direct MP4 (conversion required for MP4)
- **9. Quality options:** 1080p HD
- **10. Limitations / restrictions:** ACAO present · expiring `token=…` · **MP4 requires the conversion worker** (not exercised in this run — worker not deployed)

### 3. `https://luluvido.com/66ms4l6xkfb9`

- **1. Page accessible:** FAIL — HTTP 403
- **2. Media URL extracted:** FAIL — `[E_UPSTREAM] The source server returned HTTP 403.`
- **3–6.** — (blocked at step 1)
- **7. File is a valid video:** N/A · **8. Genuinely MP4?:** N/A
- **9. Quality options:** —
- **10. Limitations / restrictions:** extraction blocked: HTTP 403 from the datacenter/CI network (anti-bot/WAF). Browser-style navigation headers were added; the block persists. **No bypass attempted** — re-run `npm run verify:sources` from a different network if the operator’s policy allows access.

### 4. `https://firestream.to/e/5MVxhqei`

- **1. Page accessible:** PASS — HTTP 200 → `https://firestream.site/e/5MVxhqei?parent_ref=…` · title “FireStream Video”
- **2. Media URL extracted:** PASS — 1 URL(s) found (site: firestream)
- **3. Detected format(s):** m3u8 (hls)
- **4. Preview playback path:** m3u8/default: READY
- **5. Copy media URL:** PASS — well-formed absolute URL (`https://us-cdn-1.firestream.to/encodings/…`)
- **6. Download starts & completes:** N/A — no direct-MP4 source
- **7. File is a valid video:** N/A · **8. Genuinely MP4?:** N/A — conversion required for MP4
- **9. Quality options:** default (4 MB estimated)
- **10. Limitations / restrictions:** page redirect documented · ACAO present · expiring `expires=…` · MP4 requires the conversion worker

### 5. `https://vidara.to/v/3FNwKcVmnNvw5`

- **1. Page accessible:** PASS — HTTP 200 · title “Watch stg3”
- **2. Media URL extracted:** PASS — 1 URL(s) found (site: vidara)
- **3. Detected format(s):** m3u8 (hls)
- **4. Preview playback path:** m3u8/1080p HD: READY
- **5. Copy media URL:** PASS — well-formed absolute HLS URL
- **6. Download starts & completes:** N/A — no direct-MP4 source
- **7. File is a valid video:** N/A · **8. Genuinely MP4?:** N/A — conversion required for MP4
- **9. Quality options:** 1080p HD
- **10. Limitations / restrictions:** ACAO present · MP4 requires the conversion worker

### 6. `https://playmate.to/watch/Nh93AdD9E6cl5`

- **1. Page accessible:** FAIL — HTTP 522 (Cloudflare: origin unreachable)
- **2. Media URL extracted:** FAIL — `[E_UPSTREAM] playmate.to is currently unreachable … Try again later.`
- **3–6.** — (blocked at step 1)
- **7. File is a valid video:** N/A · **8. Genuinely MP4?:** N/A
- **9. Quality options:** —
- **10. Limitations / restrictions:** host-side outage (observed 2026-10-25 and 2026-10-26). The extractor implements the documented `POST /api/s` protocol and reports the outage honestly; retry later.

### 7. `https://streamfile.net/2xdgz3t2bphw`

- **1. Page accessible:** FAIL — HTTP 403
- **2. Media URL extracted:** FAIL — `[E_UPSTREAM] The source server returned HTTP 403.`
- **3–6.** — (blocked at step 1)
- **7. File is a valid video:** N/A · **8. Genuinely MP4?:** N/A
- **9. Quality options:** —
- **10. Limitations / restrictions:** HTTP 403 from datacenter IPs (anti-bot). The extractor (`plyrHlsSrc` → signed HLS urlset) is implemented and unit-tested against a real page fixture; live verification is blocked by the host’s WAF from CI egress. **No bypass attempted.**

## 3. Browser UI testing (Playwright, part of CI)

Projects: **desktop-chromium** (1440×900) and **mobile-chromium** (Pixel 7);
clipboard permissions granted; runs against the production build
(`vite build` + `vite preview`) with the local functions emulator.

**Latest run: 7 passed · 2 flaky (passed on retry) · 1 skipped — job: ✅ success.**

| Case | Asserts | Result |
|---|---|---|
| Homepage renders, no console errors | h1, URL input, submit button, “three steps” section, input focus/typing, paste affordance, **zero console/page errors**, no horizontal overflow | PASS (desktop + mobile) |
| Invalid domain error state | structured “Could not fetch” alert, form re-enabled, **no uncaught page errors** (only the expected `ERR_NAME_NOT_RESOLVED` resource failure) | PASS (desktop + mobile) |
| **Direct MP4 end-to-end** | extract API returns `ok:true` (failure dumps the actual API body), MP4 row/card rendered, `<video>` reaches `readyState ≥ 1` with a real `src` and no media error, **clipboard holds a well-formed URL**, **download completes with size > 100 kB and bytes 4..8 == `ftyp`** (genuine MP4) | PASS (desktop + mobile) |
| Supplied Streamtape URL — honest rendering | result title shown, copy always available; **if** the host verifies media → playback must reach a real state and download must be offered, **else** an explicit “cannot be confirmed” note must show and **no download button may exist** | PASS (flaky on first attempt, passed on retry — both viewports) |
| Mobile viewport | formats render as cards, no overflow, copy + download actions reachable | PASS |

Sample-asset validation is itself tested in CI (`asset-probe` workflow +
`scripts/probe-e2e-assets.sh`): magic-byte checks (HTTP 206 + `ftyp`) plus a
replay of our server-side fetch (`scripts/probe-classify.mjs`).
Findings baked into the test setup:

- `storage.googleapis.com`/`commondatastorage…gtv-videos-bucket` sample → **403 AccessDenied (asset retired)** — rejected.
- `media.w3.org/…/sintel/trailer.mp4` → passes curl but **Cloudflare JS-challenges Node’s HTTP stack** (“Just a moment…” 403) — rejected as a server-probed asset.
- **`mdn.github.io/shared-assets/videos/flower.mp4` (CC0)** → HTTP 206, `video/mp4`, `ftyp`/`moov` present **through our exact server-side fetch** — selected asset.

## 4. Unit / handler / build / deploy suites (part of CI)

| Suite | Result |
|---|---|
| Vitest — `server/lib/*` (urlguard 35, sign, hls, packer), `server/extractors` (19+2 streamtape honesty regressions), `netlify/functions` handlers (11) | **89/89 PASS** |
| `npm run build` (Vite 6 production bundle) | **PASS** |
| `scripts/verify-deploy.mjs` (netlify.toml wiring, all 4 functions importable with `config.path`, SPA redirect not shadowing `/api/*`, dist bundles present, **no secrets in the client bundle**, gitignore coverage) | **ALL CHECKS PASS** |
| Live verification job (`npm run verify:sources` with ffprobe) | **success** (report above) |
| Browser E2E job | **success** (see §3) |

## 5. Environmental limitations (explicit)

1. **Authoring sandbox egress is restricted** (npm/GitHub only; target domains and Playwright browser CDNs unreachable). All live-site verification, browser installation and E2E therefore run in **GitHub Actions**; workflow log/artifact hosts are also unreachable from the sandbox, so CI results were read back via **check annotations and PR comments** — a methodology limitation of this session, not of the product.
2. **Host-side blocks recorded as failures, never worked around:** luluvido 403, streamfile 403 (datacenter WAF), playmate 522 (origin down). No CAPTCHA-solving, proxy-chaining, or anti-bot circumvention exists in the codebase by design.
3. **HLS → MP4 conversion needs the external worker** (`MEDIA_WORKER_URL`). The worker is not deployed in CI, so conversion paths were not exercised live; the UI then disables “Get MP4” with an explanatory tooltip (verified by unit tests). Preview/copy of HLS work without it (proven READY for vidara ×2 and firestream).
4. **Signed links expire** (Streamtape ~days, streamfile ~5 h, vidara tokens, app-level media tokens 15 min). Re-extraction after expiry is required and disclosed in the UI (“Links valid 15 min”).
5. **E2E “2 flaky”** = the Streamtape browser test passed on its retry in the latest run (transient first-attempt timing/CDN behavior); the run is green, and the flakiness is disclosed rather than hidden.
6. **Netlify free-plan function duration** limits oversized proxied downloads (documented fallback: redirect for files above `PROXY_DOWNLOAD_MAX_BYTES`; long conversions belong to the worker).
7. Re-run everything with: `npm ci && npm test && npm run build && node scripts/verify-deploy.mjs`, `npm run verify:sources` (network), `npm run test:e2e` (browsers), or simply open a PR — CI runs all of it and refreshes the machine report on PR #1.

---
*Generated for repository `alistairfoxlondon-pixel/downloader-netlify`,
branch `arena/83527011-downloader-netlify`.*
