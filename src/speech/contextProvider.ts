import type { SpeechContext } from "./types";
export function inferContext(input: Partial<SpeechContext> = {}): SpeechContext {
  const selectedText = input.selectedText || "";
  const app = input.application || "";
  const nearby = input.nearbyText || "";
  const haystack = `${app} ${nearby}`.toLowerCase();
  const fieldKind = input.fieldKind || (/terminal|iterm|powershell/.test(haystack) ? "terminal" : /code|visual studio|xcode/.test(haystack) ? "code" : /mail|outlook|gmail/.test(haystack) ? "email" : /search/.test(haystack) ? "search" : /message|slack|discord|whatsapp/.test(haystack) ? "chat" : selectedText || nearby ? "document" : "unknown");
  return { ...input, selectedText, nearbyText: nearby.slice(-1200), fieldKind };
}
