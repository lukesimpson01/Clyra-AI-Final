/**
 * Real Chromium smoke for the CURRENT voice-call controller:
 * React VoiceCallHost -> dictation WebSocket -> typed/voiced turns ->
 * durable mission correction -> persistent call controls.
 *
 * The media device is fake and the backends are deterministic test doubles.
 * This validates UI and protocol wiring, NOT real speech accuracy, TTS audio,
 * DeepSeek latency, or a physical microphone.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = (process.env.CLYRA_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const missionId = "voice-ui-smoke-mission";
let starts = 0;
const revisions = [];
const visionRequests = [];
let objective = "Research competitors";

const mission = (state = "EXECUTING") => ({
  id: missionId,
  state,
  plan: {
    objective,
    steps: [{ id: "research", description: "Research the brief", toolId: "browser.search", status: "running" }],
  },
});
const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
try {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // Screen selection is controlled by the OS. Use a local fake video stream
    // so this smoke tests the UI/capture lifecycle without a chooser dialog.
    const media = navigator.mediaDevices;
    if (media?.getUserMedia) {
      const capture = media.getUserMedia.bind(media);
      Object.defineProperty(media, "getDisplayMedia", {
        configurable: true,
        value: () => {
          window.__clyraScreenActivation = navigator.userActivation?.isActive === true;
          return capture({ video: true, audio: false });
        },
      });
    }
    const NativeWebSocket = window.WebSocket;
    class LocalVoiceSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 0;
      onopen = null;
      onclose = null;
      onerror = null;
      onmessage = null;
      constructor() {
        window.__clyraVoiceSmokeSocket = this;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
          this.onmessage?.({ data: JSON.stringify({ type: "pipeline_mode", sessionId: "voice-ui-smoke" }) });
        }, 20);
      }
      send(payload) {
        try {
          const body = JSON.parse(payload);
          if (body.type === "partial") {
            this.onmessage?.({ data: JSON.stringify({ type: "partial_done" }) });
          }
        } catch { /* only JSON messages are used on this socket */ }
      }
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    }
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        if (String(url).startsWith("ws://voice-smoke.invalid")) return new LocalVoiceSocket();
        super(url, protocols);
      }
    };
  });
  await page.route("**/voice/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, sessionId: "voice-ui-smoke", websocketUrl: "ws://voice-smoke.invalid/stream" }),
  }));
  await page.route("**/api/companion/vision-frame", (route) => {
    const body = route.request().postDataJSON();
    assert.match(body.image, /^data:image\/jpeg;base64,/);
    visionRequests.push(body.question);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, text: "I can see the shared view." }) });
  });
  await page.route("**/voice/end", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }),
  }));
  await page.route("**/api/agent/missions/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/agent/missions/start") {
      starts += 1;
      objective = request.postDataJSON().prompt;
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    if (path.endsWith("/revise")) {
      const instruction = request.postDataJSON().instruction;
      revisions.push(instruction);
      objective += "\\nFollow-up instruction: " + instruction;
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    if (path.endsWith("/resume")) {
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    if (path.endsWith("/pause")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission("PAUSED") }) });
    }
    if (path.endsWith("/stop")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission("CANCELLED") }) });
    }
    if (path === `/api/agent/missions/${missionId}`) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    return route.continue();
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Wait for the installed React voice controller itself. The chat composer
  // may not be visible while the workspace opens on another app tab.
  await page.waitForFunction(() => document.documentElement.dataset.clyraVoiceController === "ready", { timeout: 30_000 });
  // The event is also what the real chat/command palette uses.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("clyra:voice-call", { detail: { action: "start" } })));
  await page.locator(".clyra-voice-call").waitFor({ timeout: 15_000 });
  await page.locator('.clyra-voice-call[data-state="ready"]').waitFor({ timeout: 15_000 });
  const call = page.locator(".clyra-voice-call");
  const stage = call.locator(".clyra-voice-media-stage");
  // Capture real React layouts at all supported breakpoints. Check the voice
  // overlay, not unrelated workspaces rendered behind its full-screen layer.
  await mkdir("qa-screenshots/voice-call", { recursive: true });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: "qa-screenshots/voice-call/ready-" + width + ".png" });
    const dims = await call.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(dims.scroll <= dims.width + 4, "voice call horizontal overflow at " + width + "px: " + JSON.stringify(dims));
  }
  await page.setViewportSize({ width: 1200, height: 900 });

  await call.getByRole("button", { name: "Start camera" }).click();
  await call.getByRole("region", { name: "Live camera preview" }).waitFor();
  await page.waitForFunction(() => {
    const video = document.querySelector(".clyra-voice-media-stage video");
    return video instanceof HTMLVideoElement && video.readyState >= 2;
  }, { timeout: 15_000 });
  assert.equal(await call.getByRole("button", { name: "Ask Clyra about this view" }).isEnabled(), true);
  await call.getByRole("button", { name: "3D pose" }).click();
  assert.equal(await call.getByRole("button", { name: "3D pose" }).getAttribute("aria-pressed"), "true");
  await call.getByRole("button", { name: "3D pose" }).click();
  await call.getByRole("button", { name: "Ask Clyra about this view" }).click();
  await page.waitForFunction(() => document.querySelector('.clyra-voice-response-line')?.textContent?.includes("I can see the shared view."), { timeout: 12_000 });
  assert.equal(visionRequests.length, 1, "visual questions send exactly one compressed frame");
  await page.screenshot({ path: "qa-screenshots/voice-call/camera.png" });

  await call.getByRole("button", { name: "Start screen sharing" }).click();
  assert.equal(await page.evaluate(() => window.__clyraScreenActivation), true, "screen share permission is requested from user activation");
  await stage.locator('[aria-label="Screen share preview"]').waitFor({ timeout: 12_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector(".clyra-voice-media-stage video");
    return video instanceof HTMLVideoElement && video.readyState >= 2;
  }, { timeout: 15_000 });
  await call.getByRole("button", { name: "Ask Clyra about this view" }).click();
  await page.waitForFunction(() => document.querySelector('.clyra-voice-response-line')?.textContent?.includes("I can see the shared view."), { timeout: 12_000 });
  assert.equal(visionRequests.length, 2, "camera and screen each support real one-frame vision requests");
  await page.screenshot({ path: "qa-screenshots/voice-call/screen-share.png" });
  await call.getByRole("button", { name: "Stop media sharing" }).click();
  await stage.waitFor({ state: "detached", timeout: 12_000 });
  assert.equal(await call.getByRole("button", { name: "Start screen sharing" }).count(), 1);

  await call.getByRole("button", { name: "Type a message" }).click();
  await call.locator(".clyra-voice-composer-v2__input").fill("Research competitors");
  await call.locator(".clyra-voice-composer-v2__send").click();
  await call.locator(".clyra-voice-agent-bar").getByRole("button", { name: "Chat", exact: true }).waitFor({ timeout: 12_000 });
  assert.equal(starts, 1, "first turn starts one mission");
  await call.getByRole("button", { name: "Full screen" }).click();
  await call.getByRole("button", { name: "Exit full screen" }).waitFor();
  await call.getByRole("button", { name: "Exit full screen" }).click();
  await call.getByRole("button", { name: "Full screen" }).waitFor();
  await call.getByRole("button", { name: "Pause" }).click();
  await call.locator('[data-mode="paused"]').waitFor({ timeout: 8_000 });
  await call.getByRole("button", { name: "Resume", exact: true }).click();
  await call.locator('[data-mode="acting_browser"]').waitFor({ timeout: 8_000 });
  await call.getByRole("button", { name: "Mute microphone" }).first().click();
  await call.getByRole("button", { name: "Unmute microphone" }).first().click();
  await call.locator(".clyra-voice-agent-bar").getByRole("button", { name: "Chat", exact: true }).click();
  await call.locator(".clyra-voice-composer-v2__input").fill("Actually focus on TikTok and Instagram, and keep the budget under $500");
  const revisedRequest = page.waitForResponse((response) => response.url().includes("/revise") && response.request().method() === "POST", { timeout: 12_000 });
  await call.locator(".clyra-voice-composer-v2__send").click();
  await revisedRequest;
  assert.equal(starts, 1, "correction modifies existing mission instead of starting a second");
  assert.equal(revisions.length, 1, "correction is sent to mission revision route");
  assert.match(revisions[0], /TikTok and Instagram/);
  await page.screenshot({ path: "qa-screenshots/voice-call/agent-browser.png" });
  await call.getByRole("button", { name: "End call" }).first().click();
  await page.locator(".clyra-voice-call").waitFor({ state: "detached", timeout: 10_000 });
  console.log("voice-call-live-smoke: React call controls, same-mission correction and clean ending passed");
} finally {
  await browser.close();
}
