export type VoiceConfig = {
  enabled: boolean;
  sampleRate: number;
  pipelineUrl: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  fishApiKey: string;
  fishReferenceId: string;
  fishModel: string;
};

export function loadVoiceConfig(): VoiceConfig {
  const localModel = String(process.env.CLYRA_OLLAMA_MODEL || process.env.CLYRA_LOCAL_MODEL || "").trim();
  const localHost = String(process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
  const llmApiKey = process.env.MY_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || (localModel ? "ollama" : "");
  const llmBaseUrl =
    process.env.MY_LLM_BASE_URL ||
    (process.env.DEEPSEEK_API_KEY ? "https://api.deepseek.com" : localModel ? `${localHost}/v1` : "https://api.openai.com/v1");
  const llmModel =
    process.env.MY_LLM_MODEL ||
    process.env.DEEPSEEK_MODEL ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek-v4-flash" : localModel || "gpt-4o-mini");

  return {
    enabled: process.env.VOICE_ENABLED !== "false",
    sampleRate: Number(process.env.VOICE_SAMPLE_RATE ?? 16000),
    pipelineUrl: process.env.VOICE_PIPELINE_URL ?? "http://127.0.0.1:8787",
    llmBaseUrl,
    llmApiKey,
    llmModel,
    fishApiKey: process.env.FISH_AUDIO_API_KEY ?? "",
    fishReferenceId: process.env.FISH_TTS_REFERENCE_ID ?? "",
    fishModel: process.env.FISH_TTS_MODEL ?? "",
  };
}

export function voiceConfigPublic(config: VoiceConfig) {
  return {
    enabled: config.enabled,
    sampleRate: config.sampleRate,
    sttProvider: "local-whisper.cpp",
    ttsProvider: "fish-audio",
    transport: "webrtc",
    ttsConfigured: Boolean(config.fishApiKey),
  };
}
