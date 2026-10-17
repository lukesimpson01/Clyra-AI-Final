import type { IntentResult, SpeechContext } from "./types";

const command = (intent: IntentResult["intent"], instruction: string, requiresSelectedText = false): IntentResult => ({ intent, instruction, requiresSelectedText, confidence: 0.97 });

/** Fast local classifier. The backend may only be consulted for genuinely ambiguous text. */
export function routeSpeechIntent(transcript: string, context: SpeechContext = {}): IntentResult {
  const text = transcript.trim();
  const normalized = text.toLowerCase().replace(/[.!?]+$/g, "");
  if (/^(cancel|never mind|stop dictation)$/.test(normalized)) return command("CANCEL", "");
  if (/^(undo|undo that|undo correction)$/.test(normalized)) return command("UNDO_CORRECTION", "");
  if (/^(delete|remove)(?: that| the)? (last sentence|last line|last paragraph)$/.test(normalized)) return command("DELETE_TEXT", normalized);
  if (/^(make|rewrite|change|turn|shorten|format) (this|that|it)\b/.test(normalized) && context.selectedText?.trim()) {
    const intent = /turn .*bullet|format/.test(normalized) ? "FORMAT_TEXT" : "REWRITE_SELECTION";
    return command(intent, text, true);
  }
  if (/^(reply|write) (saying |an |a )/.test(normalized) || /^(draft|write) (an |a )?(polite )?(email|message|reply)\b/.test(normalized)) return command("INSERT_GENERATED_TEXT", text);
  if (/^(change|replace) .+ (to|with) .+/.test(normalized)) return command("REPLACE_TEXT", text);
  if (/^(turn|format) .+ (into|as) (a )?(bullet|list)/.test(normalized)) return command("FORMAT_TEXT", text, Boolean(context.selectedText));
  return command("DICTATE", text);
}
