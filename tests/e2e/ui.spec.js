import { test, expect } from "@playwright/test";
import fs from "node:fs";

const STREAMTAPE_URL = "https://streamtape.com/v/74AwoLa6xQCAAQ4/1792525423448.mp4";

/** Collect page errors + console errors; network-level noise is allowlisted. */
function watchErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR_|ERR_BLOCKED_BY_CLIENT|AbortError/.test(text)) {
      consoleErrors.push(text); // recorded but not fatal (media/CDN network noise)
      return;
    }
    consoleErrors.push(text);
  });
  return { pageErrors, consoleErrors };
}

const fatalConsole = (list) =>
  list.filter((t) => !/Failed to load resource|net::ERR_|ERR_BLOCKED_BY_CLIENT|AbortError/.test(t));

test.describe("homepage", () => {
  test("renders without console errors and the URL form works", async ({ page }) => {
    const w = watchErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Video URL", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fetch video" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /three steps/i })).toBeVisible();

    // keyboard navigation: focus reaches the input
    await page.getByLabel("Video URL", { exact: true }).focus();
    await expect(page.getByLabel("Video URL", { exact: true })).toBeFocused();

    expect(w.pageErrors, `page errors: ${w.pageErrors.join("\n")}`).toHaveLength(0);
    expect(fatalConsole(w.consoleErrors), `console errors: ${fatalConsole(w.consoleErrors).join("\n")}`).toHaveLength(0);
  });

  test("no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("error handling", () => {
  test("unreachable domain shows a structured error, not a crash", async ({ page }) => {
    const w = watchErrors(page);
    await page.goto("/");
    await page.getByLabel("Video URL", { exact: true }).fill("https://definitely-not-a-real-host-for-tests.invalid/v.mp4");
    await page.getByRole("button", { name: "Fetch video" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Could not fetch" }).first();
    await expect(alert).toBeVisible();
    expect(w.pageErrors).toHaveLength(0);
  });
});

test.describe("streamtape end-to-end", () => {
  test.skip(({ isMobile }) => isMobile, "desktop-only deep flow (mobile runs the lighter flow below)");

  test("extract → preview → copy → download", async ({ page }) => {
    test.slow();
    const w = watchErrors(page);
    await page.goto("/");
    await page.getByLabel("Video URL", { exact: true }).fill(STREAMTAPE_URL);
    await page.getByRole("button", { name: "Fetch video" }).click();

    // Result card appears with at least one MP4 row.
    const row = page.getByRole("row").filter({ hasText: "MP4" }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: "1792525423448" })).toBeVisible();

    // Preview element exists and is a real video.
    const video = page.locator("video.preview-video").first();
    await expect(video).toBeVisible();
    // Give the player a chance to reach a decodable state (proxy path).
    await page.waitForTimeout(4000);
    const mediaState = await video.evaluate((v) => ({
      readyState: v.readyState,
      networkState: v.networkState,
      error: v.error ? v.error.code : null,
      src: v.currentSrc || v.src || "",
    }));
    console.log("video state:", JSON.stringify(mediaState));
    expect(mediaState.src.length, "video element must have a media source").toBeGreaterThan(0);

    // Copy the direct media URL and verify the clipboard content.
    await page.getByRole("button", { name: /Copy direct URL/i }).first().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/^https?:\/\//);
    expect(clip).toMatch(/get_video|\.mp4|\.m3u8/i);
    await expect(page.getByRole("alert").filter({ hasText: "copied" })).toBeVisible();

    // Download produces a real file (starts and completes).
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    // Accessible name comes from aria-label: "Download <quality> source as file".
    await page.getByRole("button", { name: /source as file/i }).first().click();
    const download = await downloadPromise;
    const tmpPath = await download.path();
    expect(tmpPath).toBeTruthy();
    const stat = fs.statSync(tmpPath);
    console.log(`downloaded ${stat.size} bytes → ${download.suggestedFilename()}`);
    expect(stat.size, "downloaded file must be non-trivial").toBeGreaterThan(100_000);
    const head = fs.readFileSync(tmpPath).subarray(0, 16);
    const container = head.subarray(4, 8).toString("latin1") === "ftyp" ? "mp4" : "not-mp4";
    console.log("container sniff:", container, head.toString("hex"));
    expect(container, "downloaded file must be a genuine MP4").toBe("mp4");

    expect(w.pageErrors, w.pageErrors.join("\n")).toHaveLength(0);
  });
});

test.describe("mobile flow", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile-only flow");

  test("extract works and layout stays contained", async ({ page }) => {
    test.slow();
    const w = watchErrors(page);
    await page.goto("/");
    await page.getByLabel("Video URL", { exact: true }).fill(STREAMTAPE_URL);
    await page.getByRole("button", { name: "Fetch video" }).click();
    const row = page.getByRole("row").filter({ hasText: "MP4" }).first();
    // On mobile the table renders as stacked cards without role=row; fall back:
    const mobileCard = page.locator(".MuiCard-root").filter({ hasText: "MP4" }).first();
    await expect(row.or(mobileCard).first()).toBeVisible({ timeout: 60_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "no horizontal overflow after results").toBeLessThanOrEqual(1);
    expect(w.pageErrors, w.pageErrors.join("\n")).toHaveLength(0);
  });
});
