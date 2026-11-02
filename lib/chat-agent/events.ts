/** The chat agent's event contract: the only thing the server and the chat UI share. Types only. */
export type TodoItem = { id: string; content: string; status: "pending" | "in_progress" | "completed" };
export type AgentSource = { id?: string; url: string; host: string; title?: string };
export type AgentEvent =
  | { type: "todos"; items: TodoItem[] }
  | { type: "step"; id: string; tool: string; label: string; state: "running" | "done" | "failed"; detail?: string; query?: string; sources?: AgentSource[]; document?: { id: string; title: string }; error?: string }
  | { type: "map"; place: { name: string; region?: string; country?: string; lat: number; lon: number; matchedFrom?: string } }
  | { type: "text"; text: string }
  | { type: "done"; text: string; citations: Array<{ id: string; url: string; host: string; title: string; retrievedAt: string }>; diagnostics: Record<string, unknown> }
  | { type: "error"; code: "credits" | "unavailable" | "failed" | "cancelled"; message: string };

