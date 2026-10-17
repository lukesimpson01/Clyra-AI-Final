import type { Express, Request, Response } from "express";
import { localSpeechStatus, transcribePcm } from "./whisper-engine";

export function registerLocalSpeechRoutes(app: Express) {
  // No boot-time warm-up here: the desktop shell's Flow engine already keeps one
  // model loaded, and a second copy would double idle memory. Voice calls warm
  // this one when they start (see dictation-stream).
  app.get("/api/speech/status", async (_req, res) => res.json(await localSpeechStatus()));
  app.post("/api/speech/transcribe", async (req: Request, res: Response) => {
    const data = String(req.body?.pcm || "");
    if (!data || data.length > 24 * 1024 * 1024) { res.status(400).json({ ok: false, error: "A small PCM utterance is required." }); return; }
    try {
      const result = await transcribePcm(Buffer.from(data, "base64"), Number(req.body?.sampleRate) || 16000, {
        language: typeof req.body?.language === "string" ? req.body.language : "en",
        profile: typeof req.body?.profile === "string" ? req.body.profile : undefined,
        prompt: Array.isArray(req.body?.dictionary) ? req.body.dictionary.map(String) : [],
      });
      res.json({ ok: true, ...result, runtime: result.runtime && { profile: result.runtime.profile, gpu: result.runtime.gpu, model: result.runtime.model.split(/[\\/]/).pop() } });
    } catch (error) { res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Local transcription failed." }); }
  });
}
