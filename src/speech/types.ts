export type SpeechIntent =
  | "DICTATE" | "REWRITE_SELECTION" | "INSERT_GENERATED_TEXT" | "EDIT_EXISTING_TEXT"
  | "REPLACE_TEXT" | "DELETE_TEXT" | "FORMAT_TEXT" | "UNDO_CORRECTION" | "COMMAND" | "CANCEL";

export type SpeechContext = {
  application?: string;
  selectedText?: string;
  nearbyText?: string;
  fieldKind?: "email" | "chat" | "document" | "search" | "terminal" | "code" | "unknown";
};

export type IntentResult = { intent: SpeechIntent; instruction: string; requiresSelectedText: boolean; confidence: number };
export type SpeechPhase = "idle" | "loading" | "listening" | "endpointing" | "thinking" | "speaking" | "paused" | "error" | "ended";
export type SpeechMetrics = Partial<Record<"captureStart" | "partial" | "final" | "firstToken" | "firstByte" | "firstAudible", number>>;
