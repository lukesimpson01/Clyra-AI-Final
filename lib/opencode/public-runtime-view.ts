/**
 * The coding runtime can retain private model reasoning for its own recovery
 * bookkeeping. These helpers create the only representations allowed across
 * the renderer/diagnostics boundary: final text, tool lifecycle and compact
 * operational metadata. They intentionally never mutate the runtime's
 * internal objects.
 */
export function publicRuntimeEvent(event: Record<string, unknown>): Record<string, unknown> | null {
  const payload = event.payload as {
    properties?: { part?: { type?: unknown } };
  } | undefined;
  if (payload?.properties?.part?.type === "reasoning") return null;
  return event;
}

export function publicRuntimeMessages(messages: unknown) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const record = message as { parts?: unknown[] };
    return {
      ...record,
      parts: Array.isArray(record.parts)
        ? record.parts.filter((part) => !(part && typeof part === "object" && (part as { type?: unknown }).type === "reasoning"))
        : record.parts,
    };
  });
}

export function publicRuntimeDiagnostic(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const record = snapshot as { events?: unknown[]; [key: string]: unknown };
  const events = Array.isArray(record.events)
    ? record.events.map((entry) => {
      const event = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return {
        id: event.id,
        projectId: event.projectId,
        sessionId: event.sessionId,
        sequence: event.sequence,
        timestamp: event.timestamp,
        type: event.type,
        status: event.status,
      };
    })
    : [];
  return { ...record, events };
}
