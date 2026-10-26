# MediaFetch — production-ready video downloader

Paste a video URL, get the real media sources: direct **MP4** files, **HLS
(M3U8)** ladders with every quality the source provides, in-browser preview,
copyable direct links, and downloads — with an optional ffmpeg conversion
service for HLS/DASH → MP4.

Built with **React + Material UI** (interface informed by
[react-saas-template](https://github.com/dunky11/react-saas-template)) and
deployed as a **static site + Netlify Functions**. No Laravel/PHP anywhere.

---

## Table of contents

1. [Architecture](#architecture)
2. [Supported domains & formats](#supported-domains--formats)
3. [Installation & local development](#installation--local-development)
4. [Deployment to Netlify (custom domain)](#deployment-to-netlify-custom-domain)
5. [Environment variables](#environment-variables)
6. [Media conversion worker (HLS → MP4)](#media-conversion-worker-hls--mp4)
7. [Testing](#testing)
8. [Security model](#security-model)
9. [Limitations & external services](#limitations--external-services)

---

## Architecture

```
Browser (React + MUI + hls.js)
   │  POST /api/extract {url}
   │  GET  /api/media?t=<signed token>   (preview + download proxy/redirect)
   │  GET  /api/config                    (sites, formats, worker status)
   │  POST/GET /api/jobs                  (optional conversion jobs)
   ▼
Netlify Functions (Node, v2 handlers, esbuild-bundled)
   ├── server/extractors/*   domain-specific extraction (per-host logic)
   ├── server/lib/*          SSRF-safe fetching, HLS parsing, static JS
   │                         unpacking (no eval), HMAC tokens, rate limits
   └── server/lib/worker.js  client for the optional external worker
   ▼                            ▼
source sites / CDNs        worker/ (Docker + ffmpeg)  ← optional, external
```

Key decisions:

- **Extraction runs server-side** (Netlify Functions) so sites see a normal
  server fetch, secrets never reach the browser, and every fetch passes SSRF
  validation (scheme/port allow-lists, private-IP & DNS-rebinding checks,
  redirect re-validation, size/time caps).
- **Every media URL handed to the client is an HMAC-signed capability token**
  bound to one destination (`/api/media?t=…`). The proxy can never be pointed
  at arbitrary targets, tokens expire (15 min), and IP-bound links (Streamtape)
  are always proxied so they work from the visitor's browser.
- **HLS playlists proxied through `/api/media` are rewritten** so variant
  URIs, segments, encryption keys and init maps resolve back to signed child
  tokens — previews work even when CDNs send no CORS headers.
- **MP4 is only offered when it really exists**: direct MP4 → real download;
  HLS/DASH → preview + (if the conversion worker is configured) a genuine
  remux to MP4. No fake links, ever. DRM (SAMPLE-AES / FairPlay / Widevine)
  is detected and refused with an explicit error.

## Supported domains & formats

| Source | Path pattern(s) | Delivery | Extract method (independent per host) | Preview | MP4 download |
|---|---|---|---|---|---|
| **streamtape.com** (+ mirror list) | `/v/{id}`, `/e/{id}` | direct MP4, IP-bound signed `get_video` link | page scan (plain + obfuscated/concat robot-link decoding, eval-free) + `&stream=1` probe | ✅ (proxied) | ✅ direct (proxied) |
| **vidara.to** (+ tracked mirrors) | `/v/{id}`, `/e/{id}` | HLS master | `POST /api/stream {filecode, device:"web"}` → `streaming_url` | ✅ | ⚠️ via worker |
| **firestream.to / firestream.site** | `/e/{id}` | signed file URL (usually MP4) | `<script id="token-blob">` → `POST /api/videos/{id}/resolve` → `signedVideoUrl` | ✅ | ✅ if MP4, else worker |
| **playmate.to** | `/watch/{id}` | HLS master | `POST /api/s {c,d}` → `sx` (+ `video-meta` title, `kx` subtitles) | ✅ | ⚠️ via worker |
| **luluvido.com** (+ LuluStream/LuluVdo family) | `/{id}`, `/e/{id}` | direct file (MP4) | page scan for `sources:[{file:"…"}]` incl. packed-JS unpacking | ✅ | ✅ direct |
| **streamfile.net** | `/{id}`, `/{id}.html` | HLS multi-variant (`.urlset/master.m3u8`) | `plyrHlsSrc` (+ unpacker) → master parse; sizes harvested from quality ladder | ✅ | ⚠️ via worker (their own direct link is premium-only) |
| **any direct URL** | `.mp4` / `.m3u8` (+ `.mpd` detection) | as served | range-probe + magic-byte sniffing; HTML pages scanned for `og:video`/`<video>`/embedded links | ✅ (MP4/HLS) | ✅ MP4; ⚠️ others via worker |
| playmate.to origin | — | — | *currently unreachable (HTTP 522) — extractor reports the outage honestly instead of failing silently* | — | — |

Formats: **MP4** (direct), **HLS/M3U8** (preview + conversion), **MPEG-DASH/MPD**
(detection only unless worker enabled), WebM/MKV/other containers (detected,
conversion required for MP4).

Hostnames lists, extraction logic and response shapes are implemented
**per domain** — nothing assumes a shared player or protocol.

## Installation & local development

Requirements: **Node ≥ 20** (CI uses 22), npm.

```bash
npm ci                 # or: npm install
cp .env.example .env   # optional locally; defaults are dev-safe
npm run dev            # Vite dev server (5173) + functions emulator (8899)
```

Open http://localhost:5173 — the dev server proxies `/api/*` to the local
functions emulator, which mounts the exact production handler files.

Other scripts:

| Command | Purpose |
|---|---|
| `npm run build` | production bundle → `dist/` |
| `npm run preview` | serve `dist/` with `/api` proxy (4173) |
| `npm test` | 89 unit + handler tests (vitest) |
| `npm run test:e2e` | Playwright desktop+mobile flows (needs `npx playwright install chromium`) |
| `npm run verify:sources` | live verification of the 7 supplied URLs (needs internet) |
| `node scripts/verify-deploy.mjs` | Netlify config / bundle / secret-leak checks |
| `npm run worker` | run the conversion worker locally (needs ffmpeg) |

## Deployment to Netlify (custom domain)

1. Push this repository to GitHub/GitLab and import it at
   [app.netlify.com](https://app.netlify.com) → *Add new site* → *Import an
   existing project*. `netlify.toml` already sets build command
   `npm run build`, publish directory `dist`, Node 22, and the functions
   directory — no UI configuration needed.
2. **Site settings → Environment variables** → add
   `MEDIA_SIGNING_SECRET` (see below). Add `MEDIA_WORKER_URL` +
   `WORKER_SECRET` only after deploying the worker.
3. **Custom domain**: *Domain management → Add domain*, point your registrar's
   A/CNAME records at Netlify (or use Netlify DNS), then *Force HTTPS*.
4. Deploy. All API routes are served at clean paths (`/api/extract`,
   `/api/media`, `/api/config`, `/api/jobs`) via each function's
   `export const config = { path }` — the SPA fallback redirect in
   `netlify.toml` never shadows them.
5. Verify: `npm run build` + `node scripts/verify-deploy.mjs` run in CI on
   every PR (this is our “it deploys” gate — see
   [docs/TEST_REPORT.md](docs/TEST_REPORT.md)).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MEDIA_SIGNING_SECRET` | **yes (prod)** | insecure dev fallback | HMAC key for `/api/media` tokens |
| `MEDIA_WORKER_URL` | no | — | base URL of the conversion worker; enables “Get MP4” for HLS/DASH |
| `WORKER_SECRET` | with worker | — | bearer secret shared with the worker |
| `FETCH_TIMEOUT_MS` | no | 15000 | upstream page/API timeout |
| `MEDIA_FETCH_TIMEOUT_MS` | no | 20000 | media proxy upstream timeout |
| `MAX_PAGE_BYTES` | no | 3145728 | cap for pages/playlists |
| `PROXY_DOWNLOAD_MAX_BYTES` | no | 367003200 | above this, `dl=1` switches from proxy to redirect |
| `EXTRACT_BURST` / `EXTRACT_PER_MIN` | no | 8 / 12 | extract rate limits (per warm instance) |
| `MEDIA_BURST` / `MEDIA_PER_MIN` | no | 120 / 120 | media proxy rate limits |
| `JOBS_BURST` / `JOBS_PER_MIN` | no | 3 / 4 | conversion job rate limits |
| Worker: `PORT`, `WORKER_SECRET`, `MAX_FILE_MB`, `MAX_CONCURRENT`, `CONVERSION_MODE`, `JOB_TTL_MIN`, `DATA_DIR` | see `.env.example` | 8080 / — / 4096 / 2 / auto / 120 / ./data | worker runtime |

**No secrets exist in frontend code** — CI enforces this
(`scripts/verify-deploy.mjs` scans the bundle).

## Media conversion worker (HLS → MP4)

Netlify Functions are short-lived; remuxing arbitrary video is not their job.
`worker/` is a dependency-free Node service wrapping ffmpeg:

```bash
cd worker
docker build -t mediafetch-worker .
docker run -d --name mediafetch -p 8080:8080 \
  -e WORKER_SECRET="$(openssl rand -hex 32)" \
  -e MEDIA... mediafetch-worker
# then set on Netlify:
#   MEDIA_WORKER_URL=https://your-worker-host:8080
#   WORKER_SECRET=<same secret>
```

API: `GET /health`, `POST /jobs {url,name,referer}`, `GET /jobs/:id`
(status/progress), `GET /files/:id` (Range-capable MP4 download, auto-cleanup).

Conversion strategy: `CONVERSION_MODE=auto` tries a lossless remux
(`-c copy -movflags +faststart`) and falls back to `libx264/aac` when the
source codec cannot go into MP4. Run the worker on any host with outbound
internet (Fly.io, Render, Railway, a VPS…). **Deploy the worker behind TLS
and never without `WORKER_SECRET`.**

## Testing

| Layer | Where | What it proves |
|---|---|---|
| Unit (vitest) | `server/**/*.test.js` | SSRF guards, tokens, HLS parsing/rewriting, static packer unpacking, all 7 extractors against protocol fixtures, function handlers |
| Deploy gate | `scripts/verify-deploy.mjs` (CI) | `netlify.toml` wiring, functions importable, bundle exists, **no secrets in the client bundle** |
| Live source verification | `npm run verify:sources` (CI, real internet) | per supplied URL: page access, extraction, format, preview probe, download+ffprobe validation, quality list, CORS/expiry/gating notes → `reports/TEST_REPORT.generated.md` |
| Browser E2E (Playwright) | `tests/e2e` (CI, desktop + mobile viewports) | clean console, keyboard focus, error state, full streamtape flow: extract → preview element with source → clipboard copy → **real download whose bytes are a genuine MP4**, mobile layout without overflow |

The consolidated human-readable report (all seven URLs, all ten required
checks): **[docs/TEST_REPORT.md](docs/TEST_REPORT.md)**.

## Security model

- **SSRF**: allow-listed schemes/ports, blocked local/internal hostnames,
  private & link-local & CGNAT IP rejection (literal + post-DNS), every
  redirect hop re-validated, cloud-metadata addresses explicitly denied.
- **Open-proxy prevention**: `/api/media` only fetches URLs inside a signed
  token minted by `/api/extract` after validation; tokens expire; rate
  limited per client.
- **No code execution of source pages**: player-obfuscated JS is decoded with
  static parsers (regex + deterministic substitution) — no `eval`, no `vm`.
- **DRM**: SAMPLE-AES/FairPlay/Widevine playlists → `E_DRM`, refused.
- **Headers**: security headers via `netlify.toml`, CORS `*` only on
  cookie-less JSON APIs and media responses, `nosniff` everywhere.
- **Abuse**: token-bucket rate limits on extract/media/jobs (documented
  per-instance caveat below).

## Limitations & external services

1. **Conversion (HLS/DASH → MP4) requires the external worker** — without
   `MEDIA_WORKER_URL`, HLS rows show “Get MP4” disabled with an explanatory
   tooltip; preview and copy still work. The worker is the only external
   service this stack needs.
2. **Netlify function time/size budget**: proxied downloads are streaming but
   bounded by Netlify's function duration (~26 s) — files above
   `PROXY_DOWNLOAD_MAX_BYTES` fall back to a redirect to the CDN (browsers
   may open very large files in a tab; the UI explains Save-As). Large/long
   conversions belong to the worker.
3. **Rate limits are per warm instance** on Netlify (stateless). For strict
   global limits, back `server/lib/ratelimit.js` with an edge KV (Upstash /
   Netlify Blobs) — the seam is one function call.
4. **playmate.to origin currently returns HTTP 522** (host-side outage,
   observed 2026-10-25). The extractor reports this as `E_UPSTREAM` — no
   fabricated links. Re-run `npm run verify:sources` when it recovers.
5. **StreamFile restricts *its own* direct-download links to premium
   accounts**; we surface the same HLS streams their player uses and say so
   in the UI (terms note). Their ToS may still restrict bulk downloading —
   users remain responsible for lawful use.
6. **Signed URLs expire** (Streamtape links, streamfile/HLS signatures,
   media tokens: 15 min). Results must be refreshed after expiry — the UI
   states this.
7. **Some CDNs omit CORS headers** — handled by the playlist-rewriting proxy
   fallback; if a host blocks datacenter IPs entirely, extraction fails with
   an explicit error (no fake links).
8. **Playwright browsers and live verification run in GitHub Actions** —
   this sandbox has restricted egress (npm/GitHub only), so browser binaries
   and live site probes are executed in CI; both are part of the PR checks.

## Repository map

```
src/                    React app (MUI theme, components, api client)
netlify/functions/      extract · media · config · jobs (v2 handlers)
server/extractors/      per-domain extraction logic + fixtures tests
server/lib/             urlguard · safehttp · sign · ratelimit · hls · packer · worker client
worker/                 standalone ffmpeg conversion service (Dockerfile)
tests/e2e/              Playwright suites (desktop + mobile)
scripts/                dev runner, functions emulator, verify-sources, verify-deploy
reports/                generated test reports (CI artifacts)
docs/TEST_REPORT.md     consolidated7-URL verification report
```

## Legal

For lawful, authorised use only. The service refuses DRM-protected streams,
does not bypass authentication/CAPTCHAs, and does not defeat technical
protection measures. You are responsible for complying with copyright law
and the terms of service of the sites you fetch.
