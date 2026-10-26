import { test, expect } from "@playwright/test";

/**
 * Browser-level E2E suite.
 *
 * Sources:
 * - The full interaction flow (extract → preview → copy → download with real
 *   bytes) runs against a stable, public CC0 sample MP4 served by GitHub
 *   Pages (mdn.github.io/shared-assets — no bot-challenge, so server-side
 *   classification works; hosts like media.w3.org sit behind Cloudflare JS
 *   challenges that Node's HTTP stack cannot pass — see asset-probe results).
 *   Reachability/FTYP validity is asserted in CI by scripts/probe-e2e-assets.sh.
 * - The Streamtape page from the supplied URL list is exercised for honest
 *   extraction/result rendering. Preview/download for third-party hosts are
 *   verified by `npm run verify:sources` (live report), because some hosts
 *   serve CAPTCHA/interstitials to datacenter IPs — the UI must cope with
 *   that honestly rather than pretend.
 */

const STREAMTAPE_URL = "https://streamtape.com/v/74AwoLa6xQCAAQ4/1792525423448.mp4";
const DIRECT_URL = "https://mdn.github.io/shared-assets/videos/flower.mp4";

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

/**
 * The formats list renders as table rows on desktop and as stacked cards on
 * mobile — the union locator matches whichever is in play.
 * Scoped to the formats container so page copy mentioning "MP4" can't match.
 */
function mp4FormatTarget(page) {
  const rows = page.getByRole("row").filter({ hasText: "MP4" }).first();
  const cards = page
    .locator('[aria-label="Available formats"] .MuiCard-root')
    .filter({ hasText: "MP4" })
    .first();
  return rows.or(cards);
}

test.describe("UI", () => {
  test("homepage renders without console errors and the URL form works", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Video URL", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fetch video" })).toBeVisible();

    // The input accepts text and holds focus (form is actually interactive).
    const input = page.getByLabel("Video URL", { exact: true });
    await input.click();
    await input.fill("https://example.com/a.mp4");
    await expect(input).toHaveValue("https://example.com/a.mp4");
    await expect(input).toBeFocused();
    // The paste affordance exists and responds without crashing.
    await page.getByRole("button", { name: "Paste URL from clipboard" }).click();

    // No horizontal overflow on any viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    expect(errors, `console/page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("invalid URL domain shows a structured error, not a crash", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await page.getByLabel("Video URL", { exact: true }).fill("https://definitely-not-a-real-host-for-tests.invalid/v.mp4");
    await page.getByRole("button", { name: "Fetch video" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Could not fetch" }).first();
    await expect(alert).toBeVisible();
    await expect(page.getByRole("button", { name: "Fetch video" })).toBeEnabled();
    // An unreachable host must not produce uncaught page errors.
    const fatal = errors.filter((e) => !/net::ERR_NAME_NOT_RESOLVED|Failed to load resource/i.test(e));
    expect(fatal, fatal.join(" | ")).toHaveLength(0);
  });

  test("direct MP4: extract → preview element → clipboard copy → genuine MP4 download", async ({ page }) => {
    watchErrors(page);
    await page.goto("/");
    // Capture the extract API response so failures print the server's reason.
    const extractPromise = page.waitForResponse(
      (r) => r.url().includes("/api/extract") && r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByLabel("Video URL", { exact: true }).fill(DIRECT_URL);
    await page.getByRole("button", { name: "Fetch video" }).click();
    const extractResp = await extractPromise;
    const extractBody = await extractResp.json().catch(() => ({}));
    expect(extractBody, `extract API → HTTP ${extractResp.status()}: ${JSON.stringify(extractBody).slice(0, 600)}`).toMatchObject({
      ok: true,
    });

    // Result card with an MP4 row/card (rows on desktop, cards on mobile).
    await expect(mp4FormatTarget(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /flower/i })).toBeVisible();

    // Preview player reached a real media state with a real source.
    const video = page.locator("video.preview-video");
    await expect(video).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => video.evaluate((v) => v.readyState), { timeout: 45_000 })
      .toBeGreaterThanOrEqual(1);
    const mediaState = await video.evaluate((v) => ({
      src: v.currentSrc || v.src || "",
      error: v.error ? v.error.code : null,
      width: v.videoWidth,
    }));
    expect(mediaState.src.length).toBeGreaterThan(0);
    expect(mediaState.error).toBeNull();

    // Copy puts a well-formed absolute URL into the clipboard.
    await page.getByRole("button", { name: /Copy direct URL/i }).first().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^https?:\/\//);

    // Download produces a real file whose leading bytes are a genuine MP4.
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /source as file/i }).first().click();
    const download = await downloadPromise;
    const filePath = await download.path();
    const fs = await import("node:fs");
    const stat = fs.statSync(filePath);
    expect(stat.size).toBeGreaterThan(100_000); // a real video, not an error page
    const head = fs.readFileSync(filePath).subarray(0, 64);
    // ISO-BMFF: bytes 4..8 == "ftyp"
    expect(head.subarray(4, 8).toString("latin1")).toBe("ftyp");
  });

  test("supplied Streamtape URL renders an honest result (copy available, no fake download)", async ({ page }) => {
    watchErrors(page);
    await page.goto("/");
    await page.getByLabel("Video URL", { exact: true }).fill(STREAMTAPE_URL);
    await page.getByRole("button", { name: "Fetch video" }).click();

    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: "1792525423448" })).toBeVisible({
      timeout: 60_000,
    });
    // Copy must always be available for a located source.
    await expect(page.locator('button[aria-label^="Copy direct URL"]').first()).toBeVisible();

    // If the host verified the media (no bot wall), the preview + download
    // affordances must be present and real. If it is walled from this network,
    // the UI must NOT offer a download — either state is acceptable, lying is not.
    const hasDownload = await page.locator('button[aria-label*="source as file"]').count();
    const unverifiedNote = page.getByText(/cannot be confirmed/i);
    const video = page.locator("video.preview-video");
    const mediaStatuses = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/media")) mediaStatuses.push(r.status());
    });
    if (await video.count()) {
      try {
        await expect.poll(() => video.evaluate((v) => v.readyState), { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
      } catch (e) {
        const diag = await video.evaluate((v) => ({
          ready: v.readyState,
          network: v.networkState,
          error: v.error ? { code: v.error.code, message: v.error.message } : null,
          src: v.currentSrc,
        }));
        // Re-fetch the preview URL ourselves and inspect what the server
        // actually returns (status, final URL, content-type, first bytes).
        const sniff = await page.evaluate(async (src) => {
          try {
            const r = await fetch(src, { headers: { Range: "bytes=0-63" } });
            const b = new Uint8Array(await r.arrayBuffer());
            let ascii = "";
            for (const ch of b) ascii += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : ".";
            return { status: r.status, finalUrl: r.url.slice(0, 160), ct: r.headers.get("content-type"), ascii: ascii.slice(0, 64) };
          } catch (err) {
            return { err: String(err) };
          }
        }, diag.src);
        throw new Error(
          `preview stalled: ${JSON.stringify(diag)} · sniff: ${JSON.stringify(sniff)} · /api/media statuses: [${mediaStatuses.join(", ")}]`,
        );
      }
      expect(hasDownload).toBeGreaterThan(0);
    } else {
      await expect(unverifiedNote.first()).toBeVisible();
      expect(hasDownload).toBe(0);
    }
  });

  test("mobile viewport: result renders as rows-or-cards without overflow, actions reachable", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    watchErrors(page);
    await page.goto("/");
    await page.getByLabel("Video URL", { exact: true }).fill(DIRECT_URL);
    await page.getByRole("button", { name: "Fetch video" }).click();

    const row = page.getByRole("row").filter({ hasText: "MP4" });
    const card = page.locator('[aria-label="Available formats"] .MuiCard-root').filter({ hasText: "MP4" });
    await expect(row.or(card).first()).toBeVisible({ timeout: 60_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await expect(page.locator('button[aria-label^="Copy direct URL"]').first()).toBeVisible();
    await expect(page.locator('button[aria-label*="source as file"]').first()).toBeVisible();
  });
});
