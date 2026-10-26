import { test, expect } from "@playwright/test";

/**
 * Browser-level E2E suite.
 *
 * Sources:
 * - The full interaction flow (extract → preview → copy → download with real
 *   bytes) runs against a stable, public, Creative-Commons sample MP4
 *   (Blender Foundation “For Bigger Blazes”, CC-BY, Google’s open test bucket)
 *   so the flow is verified deterministically in CI.
 * - The Streamtape page from the supplied URL list is exercised for honest
 *   extraction/result rendering. Preview/download for third-party hosts are
 *   verified by `npm run verify:sources` (live report), because some hosts
 *   serve CAPTCHA/interstitials to datacenter IPs — the UI must cope with
 *   that honestly rather than pretend.
 */

const STREAMTAPE_URL = "https://streamtape.com/v/74AwoLa6xQCAAQ4/1792525423448.mp4";
const DIRECT_URL = "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

test.describe("UI", () => {
  test("homepage renders without console errors and the URL form works", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Video URL", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fetch video" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /three steps/i })).toBeVisible();

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
    await page.getByLabel("Video URL", { exact: true }).fill(DIRECT_URL);
    await page.getByRole("button", { name: "Fetch video" }).click();

    // Result card with an MP4 row.
    const row = page.getByRole("row").filter({ hasText: "MP4" }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /ForBiggerBlazes/i })).toBeVisible();

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
    if (await video.count()) {
      await expect.poll(() => video.evaluate((v) => v.readyState), { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
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
    const card = page.locator(".MuiCard-root").filter({ hasText: "MP4" });
    await expect(row.or(card).first()).toBeVisible({ timeout: 60_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await expect(page.locator('button[aria-label^="Copy direct URL"]').first()).toBeVisible();
    await expect(page.locator('button[aria-label*="source as file"]').first()).toBeVisible();
  });
});
