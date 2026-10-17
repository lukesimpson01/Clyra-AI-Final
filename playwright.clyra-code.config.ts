import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.CLYRA_URL || "http://localhost:3000";

/**
 * Responsive and sidebar regression for the real Clyra Code workspace. It runs
 * against a live dev server (npm run dev) and does not start one itself.
 */
export default defineConfig({
  testDir: "./tests/clyra-code",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // Outside the project: Vite watches the project, and its overlay would cover the page.
  outputDir: path.join(os.tmpdir(), "clyra-code-playwright"),
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
