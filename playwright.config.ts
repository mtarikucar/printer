import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — see https://playwright.dev/docs/test-configuration
 *
 * The webServer block boots `npm run dev` on port 3005 and waits for the
 * homepage to respond before tests run. The dev server requires a working
 * Postgres + Redis (the same the developer is running locally). Tests
 * deliberately do NOT depend on real PayTR / Meshy / SMTP — they intercept
 * those network calls via page.route().
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3005",
    trace: "on-first-retry",
    actionTimeout: 10_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3005",
        reuseExistingServer: !process.env.CI,
        // First Turbopack compile + huggingface model warm-up easily runs
        // 60-90s on a cold cache. Bump well past that to avoid flaky
        // "Timed out waiting for webServer" failures.
        timeout: 240_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
