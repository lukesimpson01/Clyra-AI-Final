import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/** Typing and caret checks against a running Clyra (CLYRA_URL, default the desktop service). */
export default defineConfig({
  testDir: "./tests/typing",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(os.tmpdir(), "clyra-typing-playwright"),
  use: { ...devices["Desktop Chrome"], baseURL: process.env.CLYRA_URL || "http://127.0.0.1:31415", deviceScaleFactor: 1 },
});
