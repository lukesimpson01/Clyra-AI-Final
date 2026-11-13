import type { ResearchImage, ResearchRepository } from "./rich-search";
/** The chat agent's event contract: the only thing the server and the chat UI share. Types only. */
import type { StepAction, StepChanges } from "./actions";
export type TodoItem = { id: string; content: string; status: "pending" | "in_progress" | "completed" };
export type AgentSource = { id?: string; url: string; host: string; title?: string };
export type AgentEvent =
  | { type: "todos"; items: TodoItem[]; agent?: string }
  | { type: "step"; id: string; tool: string; label: string; state: "running" | "done" | "failed"; detail?: string; query?: string; sources?: AgentSource[]; images?: ResearchImage[]; repositories?: ResearchRepository[]; document?: { id: string; title: string }; error?: string; ms?: number; agent?: string; actions?: StepAction[]; changes?: StepChanges }
  | { type: "edit"; edit: { id: string; pageId: string; title: string; kind: "insert" | "replace"; markdown?: string; position?: "start" | "end" | "after"; afterText?: string; find?: string; replace?: string; supersedes?: string } }
  | { type: "agent"; id: string; name: string; goal: string; state: "running" | "done" | "failed"; summary?: string }
  | { type: "board"; from: string; text: string }
  /* Where the run is in its work: planning, doing, checking itself, reviewing quality, answering. */
  | { type: "phase"; phase: "planning" | "working" | "checking" | "reviewing" | "answering"; label: string; agent?: string }
  | { type: "map"; place: { name: string; region?: string; country?: string; lat: number; lon: number; matchedFrom?: string } }
  /* Model prose belongs on the side of the tool run on which it was produced.
     This lets the UI preserve the run's actual chronology. */
  | { type: "text"; text: string; placement?: "before" | "after" }
  | { type: "done"; text: string; citations: Array<{ id: string; url: string; host: string; title: string; retrievedAt: string }>; diagnostics: Record<string, unknown> }
  | { type: "error"; code: "credits" | "unavailable" | "failed" | "cancelled"; message: string };

