/**
 * Streams a roleplay turn through the same /api/deepseek/chat proxy the main
 * Chat tool's streamOpenAI() uses - one calling convention for every AI
 * surface in the app, not a second bespoke one for Roleplay.
 */
export async function streamRoleplayReply(
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/deepseek/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      temperature: 0.9,
      max_tokens: 900,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...history],
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({} as any));
    throw new Error(detail?.error?.message || detail?.error || `The character couldn't respond (${response.status}).`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream from the character.");

  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        const delta = event?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          full += delta;
          onChunk(full);
        }
      } catch {
        // An incomplete SSE frame will complete on the next chunk.
      }
    }
  }
  return full;
}
