// Thin HTTP client for the Creator TTS service (backend/creator-tts/service.ts).
// Shared by render.ts's narration stage and the Fake Text timeline builder so
// there is exactly one place that knows the request/response shape, including
// the real measured duration the service reports in X-Clyra-TTS-Duration.

export type FetchedSpeech = {
  bytes: Buffer;
  durationMs: number;
  engine: string;
  extension: string;
  warning?: string;
};

export async function fetchSpeech(origin: string, text: string, voice: string, signal?: AbortSignal): Promise<FetchedSpeech> {
  const response = await fetch(`${origin}/api/creator/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 600), voice }),
    signal,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error || `Narration failed (${response.status})`);
  }
  const type = response.headers.get("content-type") || "";
  const extension = type.includes("mpeg") ? "mp3" : type.includes("wav") || type.includes("wave") ? "wav" : "bin";
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    durationMs: Number(response.headers.get("X-Clyra-TTS-Duration")) || 0,
    engine: response.headers.get("X-Clyra-TTS-Engine") || "unknown",
    extension,
    warning: response.headers.get("X-Clyra-TTS-Warning") || undefined,
  };
}
