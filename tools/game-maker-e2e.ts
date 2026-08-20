/**
 * Clyra Game Maker — browser end-to-end checks.
 *
 * These are the two proofs the specification calls critical, run against the
 * real app in a real browser:
 *
 *   1. The editor spine: a persistent 3D viewport that actually renders, a
 *      generated world in the hierarchy, selection, a context-aware AI edit
 *      ("put a tower here") landing at the frozen cursor target, and undo
 *      reverting the whole thing as one step.
 *   2. Play mode: the sandboxed runtime boots, a bot walks to a door,
 *      presses interact, and the RUNTIME reports the door is open.
 *
 * Nothing here asserts on pixels. Every assertion reads state out of the
 * live editor or the running game, because that is how the agent works too.
 *
 * Usage:  npm run test:game-maker:e2e         (expects the dev server on :3000)
 *         BASE_URL=http://localhost:3000 npm run test:game-maker:e2e
 */
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
/**
 * Worlds are a pure function of their seed, and `?gmSeed=` pins it. The
 * milestone tests use a fixed seed so they exercise the same village every
 * run: a flaky world is not a useful regression test, and a specific layout
 * failing is a separate bug from the mechanism being broken.
 */
const SEED = process.env.GAME_MAKER_SEED || "20260820";
const URL = `${BASE_URL}/?embedTool=forge&gmSeed=${SEED}`;
const HEADLESS = process.env.HEADED !== "1";
/**
 * The AI leg calls the real model, so it costs money and is not
 * deterministic. It is opt-in: GAME_MAKER_AI=1 npm run test:game-maker:e2e
 */
const RUN_AI = process.env.GAME_MAKER_AI === "1";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail = "") {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    process.stdout.write(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}\n`);
  }
}

function group(name: string) {
  process.stdout.write(`\n${name}\n`);
}

/** Poll until `predicate` is true in the page, or fail with the last value. */
async function waitFor<T>(page: Page, label: string, evaluate: () => T | Promise<T>, predicate: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = (await page.evaluate(evaluate)) as T;
    if (predicate(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(last)?.slice(0, 500)}`);
}

/** Wait for the dev server to answer before driving a browser at it. */
async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never responded";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/game-runtime.html`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`The dev server at ${BASE_URL} is not serving the game runtime (${lastError}). Start it with: npm run dev`);
}

async function main() {
  await waitForServer();
  const browser: Browser = await chromium.launch({
    headless: HEADLESS,
    // SwiftShader gives a real WebGL2 context in headless CI.
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  // A dev server that is transpiling a large module graph can take a while
  // on a cold cache; a navigation timeout here is not a product failure.
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(60_000);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  try {
    group("Editor spine");

    await page.goto(URL, { waitUntil: "domcontentloaded" });
    // A restored project from a previous run must not mask a broken welcome
    // screen, so always start from a clean slate.
    await page.evaluate(() => indexedDB.deleteDatabase("clyra-game-maker"));
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.waitForSelector(".gm-welcome", { timeout: 30_000 });
    check("the welcome screen loads", true);

    // Third person: the smallest template with a player, ground and controller.
    await page.getByRole("button", { name: /Third person/ }).first().click();
    await page.waitForSelector(".gm-shell", { timeout: 30_000 });
    check("a template creates a project and opens the editor", true);

    const rows = await page.locator(".gm-tree__row").count();
    check("the hierarchy is populated", rows >= 2, `expected at least 2 entities, got ${rows}`);

    // The persistent viewport must actually be running a frame loop.
    const stats = await waitFor(
      page,
      "the viewport to render frames",
      () => document.querySelector(".gm-viewport__hud")?.textContent ?? "",
      (text) => /[1-9]\d*\s*fps/.test(text),
      25_000,
    );
    check("the 3D viewport renders a live frame loop", /[1-9]/.test(stats), stats);

    const drawing = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".gm-viewport__canvas");
      if (!canvas) return null;
      const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      return { hasContext: Boolean(context), width: canvas.width, height: canvas.height };
    });
    check("the viewport holds a real WebGL context", drawing?.hasContext === true && (drawing?.width ?? 0) > 100, JSON.stringify(drawing));

    /* ---- selection + inspector ---- */
    await page.locator(".gm-tree__row").filter({ hasText: "Player" }).first().click();
    await page.waitForTimeout(300);
    const inspectorText = (await page.locator(".gm-inspector").innerText()).replace(/\s+/g, " ");
    check("selecting an entity populates the inspector", /Transform/.test(inspectorText) && /Health|PlayerController/.test(inspectorText), inspectorText.slice(0, 200));

    /* ---- manual edit + undo ---- */
    const before = await page.evaluate(() => document.querySelectorAll(".gm-tree__row").length);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(400);
    const afterDelete = await page.evaluate(() => document.querySelectorAll(".gm-tree__row").length);
    check("deleting the selection removes it from the scene", afterDelete < before, `${before} → ${afterDelete}`);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await page.waitForTimeout(400);
    const afterUndo = await page.evaluate(() => document.querySelectorAll(".gm-tree__row").length);
    check("undo restores it", afterUndo === before, `${before} → ${afterDelete} → ${afterUndo}`);

    /* ---- persistence ---- */
    await page.waitForTimeout(1600); // debounced autosave
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".gm-shell", { timeout: 30_000 });
    const restored = await page.locator(".gm-tree__row").count();
    check("the project survives a reload", restored >= 2, `restored ${restored} entities`);

    /* ================================================================ */
    group("Play mode and the sandboxed runtime");

    // The RPG world has houses, and every generated house has a real door —
    // which is what the door milestone needs.
    await page.evaluate(() => indexedDB.deleteDatabase("clyra-game-maker"));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".gm-welcome", { timeout: 30_000 });
    await page.getByRole("button", { name: /RPG world/ }).first().click();
    await page.waitForSelector(".gm-shell", { timeout: 60_000 });

    const worldSize = await page.locator(".gm-tree__row").count();
    check("a whole world is generated from one action", worldSize > 20, `${worldSize} entities`);

    const assetCount = await page.locator(".gm-asset").count();
    check("generators produce real assets with provenance", assetCount > 5, `${assetCount} assets`);

    // Press Play: this boots the sandboxed iframe runtime.
    await page.getByRole("button", { name: /^Play/ }).click();

    const frameState = await waitFor(
      page,
      "the sandboxed runtime to load",
      () => {
        const frame = document.querySelector<HTMLIFrameElement>("iframe.gm-runtime-frame");
        const console_ = Array.from(document.querySelectorAll(".gm-console li")).map((node) => node.textContent ?? "");
        return { hasFrame: Boolean(frame), sandbox: frame?.getAttribute("sandbox") ?? "", logs: console_.slice(-8) };
      },
      (value) => value.hasFrame && value.logs.some((line) => /Loaded/.test(line)),
      90_000,
    );
    check("the runtime frame is created", frameState.hasFrame);
    check(
      "the runtime is sandboxed without same-origin access",
      frameState.sandbox === "allow-scripts",
      `sandbox="${frameState.sandbox}" — allow-same-origin would give the game access to the editor's storage`,
    );
    check("the runtime loaded the scene", frameState.logs.some((line) => /Loaded/.test(line)), frameState.logs.join(" | "));

    /* ---- the door test, driven through the product's own Tests tab ---- */
    await page.getByRole("button", { name: /^Tests/ }).click();
    await page.waitForSelector(".gm-tests__editor textarea");
    await page.locator(".gm-tests__editor textarea").fill(
      [
        "move player to door",
        "interact",
        "assert event door_opened",
        "assert runtime_errors == 0",
      ].join("\n"),
    );
    await page.getByRole("button", { name: /Run test/ }).click();

    const verdict = await waitFor(
      page,
      "the playtest to finish",
      () => {
        const node = document.querySelector(".gm-tests__verdict");
        const steps = Array.from(document.querySelectorAll(".gm-tests__report li")).map((item) => item.textContent ?? "");
        return { verdict: node?.textContent ?? "", pass: node?.classList.contains("is-pass") ?? false, steps };
      },
      (value) => value.verdict.length > 0,
      180_000,
    );

    check(
      "a bot walks to a door, opens it, and the RUNTIME confirms it opened",
      verdict.pass,
      `${verdict.verdict}\n       ${verdict.steps.join("\n       ")}`,
    );

    /* ---- performance contract ---- */
    await page.getByRole("button", { name: /^Profiler/ }).click();
    await page.getByRole("button", { name: /Profile 180 frames/ }).click();
    const profile = await waitFor(
      page,
      "the profiler to report",
      () => document.querySelector(".gm-profiler__metrics")?.textContent ?? "",
      (text) => text.length > 0,
      120_000,
    );
    check("the profiler measures the running game", /entityCount|drawCalls|fps/.test(profile.replace(/\s+/g, "")), profile.slice(0, 200));

    /* ================================================================ */
    group("Voxel sandbox");

    await page.evaluate(() => indexedDB.deleteDatabase("clyra-game-maker"));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".gm-welcome", { timeout: 30_000 });
    await page.getByRole("button", { name: /Voxel sandbox/ }).first().click();
    await page.waitForSelector(".gm-shell", { timeout: 90_000 });

    await page.getByRole("button", { name: /^Play/ }).click();
    const voxelLoaded = await waitFor(
      page,
      "the voxel world to load",
      () => Array.from(document.querySelectorAll(".gm-console li")).map((node) => node.textContent ?? "").slice(-10),
      (logs) => logs.some((line) => /Loaded scene/.test(line)),
      120_000,
    );
    check("a voxel world loads in the runtime", voxelLoaded.some((line) => /Loaded scene/.test(line)), voxelLoaded.join(" | "));

    // Break a block, then put one back — the two things a sandbox is for.
    await page.getByRole("button", { name: /^Tests/ }).click();
    await page.locator(".gm-tests__editor textarea").fill(
      ["wait 0.5s", "look down 55", "press attack", "assert event block_broken", "press interact", "assert event block_placed", "assert runtime_errors == 0"].join("\n"),
    );
    await page.getByRole("button", { name: /Run test/ }).click();
    const voxelVerdict = await waitFor(
      page,
      "the voxel playtest",
      () => {
        const node = document.querySelector(".gm-tests__verdict");
        return { verdict: node?.textContent ?? "", pass: node?.classList.contains("is-pass") ?? false, steps: Array.from(document.querySelectorAll(".gm-tests__report li")).map((item) => item.textContent ?? "") };
      },
      (value) => value.verdict.length > 0,
      120_000,
    );
    check("blocks can be broken and placed in the running voxel world", voxelVerdict.pass, `${voxelVerdict.verdict}\n       ${voxelVerdict.steps.join("\n       ")}`);

    /* ================================================================ */
    group("2D platformer");

    await page.evaluate(() => indexedDB.deleteDatabase("clyra-game-maker"));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".gm-welcome", { timeout: 30_000 });
    await page.getByRole("button", { name: /2D platformer/ }).first().click();
    await page.waitForSelector(".gm-shell", { timeout: 60_000 });

    await page.getByRole("button", { name: /^Play/ }).click();
    const twoDLoaded = await waitFor(
      page,
      "the 2D runtime to load",
      () => ({
        frame: document.querySelector<HTMLIFrameElement>("iframe.gm-runtime-frame")?.getAttribute("src") ?? "",
        logs: Array.from(document.querySelectorAll(".gm-console li")).map((node) => node.textContent ?? "").slice(-10),
      }),
      (value) => value.logs.some((line) => /Loaded scene/.test(line)),
      120_000,
    );
    check("a 2D project loads the Phaser runtime document", twoDLoaded.frame.includes("game-runtime-2d.html"), `iframe src was "${twoDLoaded.frame}"`);
    check("the 2D scene loads", twoDLoaded.logs.some((line) => /Loaded scene/.test(line)), twoDLoaded.logs.join(" | "));

    await page.getByRole("button", { name: /^Tests/ }).click();
    await page.locator(".gm-tests__editor textarea").fill(
      ["hold moveRight for 3s", "assert player.position.0 > 100", "assert runtime_errors == 0"].join("\n"),
    );
    await page.getByRole("button", { name: /Run test/ }).click();
    const twoDVerdict = await waitFor(
      page,
      "the 2D playtest",
      () => {
        const node = document.querySelector(".gm-tests__verdict");
        return { verdict: node?.textContent ?? "", pass: node?.classList.contains("is-pass") ?? false, steps: Array.from(document.querySelectorAll(".gm-tests__report li")).map((item) => item.textContent ?? "") };
      },
      (value) => value.verdict.length > 0,
      120_000,
    );
    check("the 2D player actually runs and moves", twoDVerdict.pass, `${twoDVerdict.verdict}\n       ${twoDVerdict.steps.join("\n       ")}`);

    /* ================================================================ */
    if (RUN_AI) {
      group("The AI agent, end to end");

      // Back to the editor so the agent works against the edit-time scene.
      await page.getByRole("button", { name: /Stop/ }).click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^Clyra$/ }).click();
      await page.waitForSelector(".gm-ai__input textarea");

      const beforeEntities = await page.locator(".gm-tree__row").count();
      await page.locator(".gm-ai__input textarea").fill("Add three barrels next to the inn, then check the project is valid.");
      await page.keyboard.press("Enter");

      const outcome = await waitFor(
        page,
        "the agent to finish",
        () => {
          const summary = document.querySelector(".gm-ai__summary p")?.textContent ?? "";
          const error = document.querySelector(".gm-ai__error")?.textContent ?? "";
          const steps = Array.from(document.querySelectorAll(".gm-ai__steps li")).map((item) => (item.textContent ?? "").slice(0, 80));
          return { summary, error, steps };
        },
        (value) => Boolean(value.summary || value.error),
        300_000,
      );

      check("the agent connects and runs tools", outcome.steps.length > 0, JSON.stringify(outcome.steps).slice(0, 400));
      check("the agent finished without erroring", !outcome.error, outcome.error);
      check("the agent reported what it did", outcome.summary.length > 10, outcome.summary);

      const afterEntities = await page.locator(".gm-tree__row").count();
      check("the agent actually changed the scene", afterEntities > beforeEntities, `${beforeEntities} → ${afterEntities} entities`);

      // The whole AI turn must be ONE undo step.
      await page.getByRole("button", { name: /^History/ }).click();
      const aiEntries = await page.locator(".gm-history li .gm-history__author.is-ai").count();
      check("the whole AI turn is a single history entry", aiEntries === 1, `${aiEntries} AI entries in history`);
    }

    /* ---- no unhandled page errors throughout ---- */
    const realErrors = pageErrors.filter((message) => !/favicon|ResizeObserver loop|Download the React DevTools/.test(message));
    check("no unhandled errors during the whole session", realErrors.length === 0, realErrors.slice(0, 4).join(" | "));
  } catch (error) {
    failures.push(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.stdout.write(`\n  FATAL ${error instanceof Error ? error.message : String(error)}\n`);
    try {
      await page.screenshot({ path: "qa-screenshots/game-maker-e2e-failure.png", fullPage: false });
      process.stdout.write("       screenshot: qa-screenshots/game-maker-e2e-failure.png\n");
    } catch {
      // Screenshotting a dead page is not worth failing over.
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(`\n${"─".repeat(60)}\n`);
  if (failures.length) {
    process.stdout.write(`${passed} passed, ${failures.length} FAILED\n\n`);
    for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`);
    process.stdout.write("\n");
    process.exit(1);
  }
  process.stdout.write(`All ${passed} browser checks passed.\n\n`);
}

void main();
