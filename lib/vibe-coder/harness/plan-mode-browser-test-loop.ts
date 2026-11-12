import { AgentBrowserController } from "../browser/agent-browser-controller";
import type { BrowserAction, StructuredObservation } from "../../openbrowser/browser-runtime";
import type { VibeBrowserAgentAction } from "../../../types/vibe-browser-agent";

/** Compatibility runner for plan-mode: every verdict derives from a real Chromium observation. */
export class PlanModeBrowserTestLoop {
  private isTesting = false;

  async runTest(url: string, actions: VibeBrowserAgentAction[]) {
    this.isTesting = true;
    let origin: string;
    try { origin = new URL(url).origin; }
    catch { this.isTesting = false; return { success: false, error: "Invalid preview URL" }; }
    if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) {
      this.isTesting = false;
      return { success: false, error: "Verification requires a local generated-app preview." };
    }
    try {
      await AgentBrowserController.startSession(url);
      let verified = 0;
      for (const action of actions) {
        if (!this.isTesting) return { success: false, error: "Cancelled" };
        const before = await AgentBrowserController.observeState();
        if (action.type === "observe") {
          if (!before.page.url || new URL(before.page.url).origin !== origin) {
            return { success: false, failedAction: action, error: "Could not observe generated app." };
          }
          verified++;
          continue;
        }
        const command = this.toAction(action);
        if (!command) return { success: false, failedAction: action, error: "Unsupported action" };
        await AgentBrowserController.act("default", command);
        const after = await AgentBrowserController.observeState();
        if (new URL(after.page.url).origin !== origin || !this.verify(action, before, after)) {
          return { success: false, failedAction: action, error: "Result not verified" };
        }
        verified++;
      }
      return { success: true, verifiedActions: verified };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.isTesting = false;
    }
  }

  private toAction(action: VibeBrowserAgentAction): BrowserAction | null {
    const target = action.target ? { text: action.target } : null;
    if (action.type === "navigate") return action.target ? { type: "navigate", url: action.target } : null;
    if (action.type === "click") return target ? { type: "click", target } : null;
    if (action.type === "type") return target && typeof action.value === "string"
      ? { type: "type", target, text: action.value } : null;
    if (action.type === "scroll") return { type: "scroll", direction: "down", amount: 520 };
    return null;
  }

  private verify(action: VibeBrowserAgentAction, before: StructuredObservation, after: StructuredObservation) {
    if (action.type === "navigate") return after.page.url === action.target ||
      after.page.url.replace(/\/$/, "") === action.target?.replace(/\/$/, "");
    if (action.type === "scroll") return before.viewport.scrollY !== after.viewport.scrollY;
    if (action.type === "type") return Boolean(action.value) &&
      after.elements.some(item => item.value.includes(action.value || ""));
    if (action.type === "click") return before.page.fingerprint !== after.page.fingerprint ||
      before.page.url !== after.page.url;
    return false;
  }

  cancel() {
    this.isTesting = false;
    AgentBrowserController.stopSession();
  }
}
