#!/usr/bin/env npx tsx
/**
 * Browser E2E verification for chat research routing.
 * Run: npx tsx scripts/browser-test-research-chat.ts
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.CLYRA_BASE_URL ?? "http://localhost:3000";
const ARTIFACTS = "/opt/cursor/artifacts/research-chat-test";

type ScenarioResult = {
  name: string;
  passed: boolean;
  details: string[];
};

async function waitForComposer(page: Page) {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(3200);
  return textarea;
}

async function sendMessage(page: Page, text: string) {
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill(text);
  const send = page.locator('[aria-label="Send message"]').first();
  await send.waitFor({ state: "visible", timeout: 10000 });
  await send.click();
}

async function waitForAnyText(page: Page, patterns: RegExp[], timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const body = await page.locator("body").innerText();
    for (const pattern of patterns) {
      if (pattern.test(body)) return pattern.source;
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function bodyHasText(page: Page, pattern: RegExp) {
  const body = await page.locator("body").innerText();
  return pattern.test(body);
}

async function runScenario(
  page: Page,
  name: string,
  message: string,
  expectations: {
    shouldShow?: RegExp[];
    shouldNotShow?: RegExp[];
    waitMs?: number;
  },
): Promise<ScenarioResult> {
  const details: string[] = [];
  let passed = true;

  details.push(`Sending: "${message}"`);
  await page.reload({ waitUntil: "networkidle" });
  await waitForComposer(page);
  await sendMessage(page, message);

  const waitMs = expectations.waitMs ?? 12000;

  if (expectations.shouldShow?.length) {
    const found = await waitForAnyText(page, expectations.shouldShow, waitMs);
    if (found) {
      details.push(`✓ Saw expected UI: /${found}/`);
    } else {
      passed = false;
      details.push(
        `✗ Missing expected UI within ${waitMs}ms: ${expectations.shouldShow.map((p) => p.source).join(", ")}`,
      );
    }
  }

  if (expectations.shouldNotShow?.length) {
    await page.waitForTimeout(5000);
    for (const pattern of expectations.shouldNotShow) {
      const seen = await bodyHasText(page, pattern);
      if (seen) {
        passed = false;
        details.push(`✗ Should NOT show: /${pattern.source}/`);
      } else {
        details.push(`✓ Correctly absent: /${pattern.source}/`);
      }
    }
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await page.screenshot({
    path: path.join(ARTIFACTS, `${slug}.png`),
    fullPage: true,
  });
  details.push(`Screenshot: ${slug}.png`);

  return { name, passed, details };
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const results: ScenarioResult[] = [];

  try {
    results.push(
      await runScenario(page, "Research", "what is fable 5 ai", {
        shouldShow: [/Searching/i, /anthropic|fable|claude/i],
        shouldNotShow: [/Analysing youtube video/i],
        waitMs: 20000,
      }),
    );

    results.push(
      await runScenario(
        page,
        "YouTube",
        "analyse this youtube video https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        {
          shouldShow: [/Analysing youtube video/i, /youtube|Rick|Never/i],
          shouldNotShow: [/Searching…/i],
          waitMs: 20000,
        },
      ),
    );

    results.push(
      await runScenario(page, "Normal chat - greeting", "how are you?", {
        shouldNotShow: [/Searching/i, /Analysing youtube video/i],
        waitMs: 8000,
      }),
    );

    results.push(
      await runScenario(page, "Normal chat - math", "what is 25 + 17", {
        shouldNotShow: [/Searching/i, /Analysing youtube video/i],
        waitMs: 8000,
      }),
    );

    // Wait for at least one AI response on research scenario page reload check
    await page.reload({ waitUntil: "networkidle" });
    await waitForComposer(page);
    await sendMessage(page, "what is fable 5 ai");
    const cited = await waitForAnyText(
      page,
      [/fable|anthropic|claude|\[1\]/i],
      90000,
    );
    results.push({
      name: "Research cited answer",
      passed: Boolean(cited),
      details: cited
        ? [`✓ AI response contains research content: /${cited}/`]
        : ["✗ No cited research answer within 90s (API may be slow)"],
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, "research-answer.png"),
      fullPage: true,
    });
  } finally {
    await browser.close();
  }

  const report = results
    .map((r) => {
      return `## ${r.name}: ${r.passed ? "PASS" : "FAIL"}\n${r.details.map((d) => `- ${d}`).join("\n")}`;
    })
    .join("\n\n");

  fs.writeFileSync(path.join(ARTIFACTS, "report.md"), report);

  console.log(report);
  console.log(`\nArtifacts: ${ARTIFACTS}`);

  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
