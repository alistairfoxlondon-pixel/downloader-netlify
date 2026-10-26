import { defineConfig, devices } from "@playwright/test";

/**
 * E2E UI verification. Requires browsers (`npx playwright install chromium`)
 * — runs in CI after install; locally it needs the same one-time install.
 *
 * Two servers start automatically:
 *  - the local Netlify Functions emulator (port 8899)
 *  - `vite preview` of the production build (port 4173, proxies /api)
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // source sites are hit politely, one at a time
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: "node scripts/functions-dev-server.mjs",
      port: 8899,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // The E2E suite legitimately issues many extract requests in a short
      // window across two viewport projects and retries — give the local
      // emulator headroom. Production defaults stay strict.
      env: {
        FETCH_TIMEOUT_MS: "8000",
        MEDIA_FETCH_TIMEOUT_MS: "12000",
        EXTRACT_BURST: "40",
        EXTRACT_PER_MIN: "60",
        MEDIA_BURST: "240",
        MEDIA_PER_MIN: "300",
        JOBS_BURST: "20",
        JOBS_PER_MIN: "30",
      },
    },
    {
      command: "npm run build && npm run preview -- --port 4173",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
