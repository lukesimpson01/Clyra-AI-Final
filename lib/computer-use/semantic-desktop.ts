import crypto from "node:crypto";
import type { DesktopElement, DesktopRole, SemanticDesktopSnapshot } from "./types";

const SENSITIVE = /password|passcode|one.?time|security code|cvv|card number|private key|recovery code/i;
const ROLE_MAP: Record<string, DesktopRole> = {
  axbutton: "button", button: "button", checkbox: "checkbox", axcheckbox: "checkbox",
  radiobutton: "radio", edit: "textfield", axtextfield: "textfield", textarea: "textarea",
  hyperlink: "link", axlink: "link", menu: "menu", menuitem: "menuitem", tabitem: "tab",
  list: "list", listitem: "listitem", tree: "tree", treeitem: "treeitem", table: "table",
  row: "row", cell: "cell", slider: "slider", combobox: "combobox", toolbar: "toolbar",
  dialog: "dialog", window: "window", document: "document", image: "image", text: "statictext",
  axstatictext: "statictext",
};

export function normalizeRole(role: string): DesktopRole {
  return ROLE_MAP[role.toLowerCase().replaceAll(" ", "")] ?? "unknown";
}

export function stableElementId(platformId: string | undefined, fingerprint: string): string {
  return `el_${crypto.createHash("sha256").update(platformId || fingerprint).digest("hex").slice(0, 8)}`;
}

export function redactElement(element: DesktopElement): DesktopElement {
  const sensitive = element.sensitive || SENSITIVE.test([element.name, element.placeholder, element.description].filter(Boolean).join(" "));
  return sensitive ? { ...element, value: element.value ? "[REDACTED]" : element.value, sensitive: true } : element;
}

function terms(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean); }

export class SemanticDesktop {
  private snapshot?: SemanticDesktopSnapshot;
  update(next: SemanticDesktopSnapshot) {
    const ids = new Set(next.elements.map((item) => item.id));
    if (ids.size !== next.elements.length) throw new Error("Desktop snapshot contains duplicate element IDs");
    this.snapshot = { ...next, elements: next.elements.map(redactElement) };
    return this.snapshot;
  }
  getState(limit = 150) {
    if (!this.snapshot) return undefined;
    const elements = this.snapshot.elements
      .filter((element) => element.enabled && (element.actions.length > 0 || element.focused || this.snapshot?.changedElementIds.includes(element.id)))
      .slice(0, Math.max(1, Math.min(limit, 500)));
    return { ...this.snapshot, elements };
  }
  inspect(id: string) { return this.snapshot?.elements.find((element) => element.id === id); }
  find(query: string, roles: DesktopRole[] = [], limit = 10) {
    if (!this.snapshot) return [];
    const queryTerms = terms(query);
    return this.snapshot.elements.filter((element) => !roles.length || roles.includes(element.role)).map((element) => {
      const label = [element.name, element.value, element.placeholder, element.description].filter(Boolean).join(" ");
      const candidateTerms = terms(label);
      const exact = label.toLowerCase() === query.toLowerCase() ? 50 : 0;
      const overlap = queryTerms.filter((term) => candidateTerms.some((candidate) => candidate === term || candidate.includes(term))).length;
      const score = exact + overlap * 8 + (element.windowId === this.snapshot?.activeWindow ? 6 : 0) + (element.enabled ? 3 : -20) + element.confidence;
      return { element, score };
    }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(limit, 50)));
  }
  signature(action?: string) {
    const state = this.snapshot;
    const payload = state ? [state.activeApp, state.activeWindow, state.elements.filter(e => e.focused || state.changedElementIds.includes(e.id)).map(e => [e.id, e.value]), action] : [action];
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  }
}
