import type { Page } from "playwright";
import { stableElementId } from "./semantic-desktop";
import type { ComputerAction, DesktopElement, DesktopRole, NativeComputerAdapter, SemanticDesktopSnapshot } from "./types";

const ROLE_SELECTOR = "button,input,textarea,select,a[href],[role],[contenteditable=true]";
const mapRole = (tag: string, type: string | null, explicit: string | null): DesktopRole => {
  if (explicit) return ({ textbox: "textfield", option: "listitem" } as Record<string, DesktopRole>)[explicit] ?? explicit as DesktopRole;
  if (tag === "button") return "button"; if (tag === "a") return "link"; if (tag === "textarea") return "textarea";
  if (tag === "select") return "combobox"; if (tag === "input") return type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : "textfield";
  return "unknown";
};

/** DOM-first adapter for Clyra's existing Playwright/CDP browser. Raw screenshots never leave this adapter. */
export class BrowserComputerAdapter implements NativeComputerAdapter {
  private revision = 0;
  constructor(private page: Page) {}
  async observe(): Promise<SemanticDesktopSnapshot> {
    const url = this.page.url(); const title = await this.page.title();
    const raw = await this.page.locator(ROLE_SELECTOR).evaluateAll(nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    }).slice(0, 1000).map((node, index) => {
      const el = node as HTMLElement; const input = el as HTMLInputElement; const rect = el.getBoundingClientRect();
      return { index, tag: el.tagName.toLowerCase(), type: input.type || null, role: el.getAttribute("role"), automationId: el.id || el.getAttribute("data-testid"), name: el.getAttribute("aria-label") || el.innerText?.trim().slice(0, 300) || input.placeholder || input.name, value: input.type === "password" ? undefined : input.value, placeholder: input.placeholder, disabled: input.disabled, focused: document.activeElement === el, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, sensitive: input.type === "password" };
    }));
    const elements: DesktopElement[] = raw.map(item => ({ id: stableElementId(item.automationId ?? undefined, `${url}:${item.index}:${item.tag}:${item.name}`), platformId: item.automationId ?? undefined, appId: "clyra-browser", windowId: url, role: mapRole(item.tag, item.type, item.role), name: item.name || undefined, value: item.value || undefined, placeholder: item.placeholder || undefined, bounds: item.bounds, enabled: !item.disabled, focused: item.focused, actions: item.tag === "input" || item.tag === "textarea" ? ["focus", "setValue", "click"] : ["invoke", "click", "focus"], confidence: 1, sensitive: item.sensitive }));
    return { revision: ++this.revision, capturedAt: Date.now(), activeApp: "Clyra Browser", activeWindow: url, windows: [{ id: url, appId: "clyra-browser", title, active: true }], elements, changedElementIds: elements.map(e => e.id) };
  }
  async execute(action: ComputerAction, target: DesktopElement | undefined, signal: AbortSignal) {
    if (signal.aborted) return { success: false, detail: "Cancelled" };
    if (action.name === "wait") { await this.page.waitForTimeout(Math.min(action.timeoutMs ?? 500, 30_000)); return { success: true }; }
    if (action.name === "keypress") { await this.page.keyboard.press((action.keys ?? []).join("+")); return { success: true }; }
    if (action.name === "type") { await this.page.keyboard.type(action.value ?? ""); return { success: true }; }
    if (!target) return { success: false, detail: "A semantic target is required" };
    const selector = target.platformId ? `[id=${JSON.stringify(target.platformId)}]` : undefined;
    const locator = selector ? this.page.locator(selector) : this.page.getByRole(target.role === "textfield" ? "textbox" : target.role as never, target.name ? { name: target.name, exact: true } : undefined).first();
    if (action.name === "focus") await locator.focus();
    else if (action.name === "set_value") await locator.fill(action.value ?? "");
    else if (action.name === "hover") await locator.hover();
    else if (action.name === "double_click") await locator.dblclick();
    else if (action.name === "right_click") await locator.click({ button: "right" });
    else await locator.click();
    return { success: true };
  }
  async releaseInput() { await this.page.mouse.up().catch(() => undefined); }
}
