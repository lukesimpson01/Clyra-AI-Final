"""Configuration for the Clyra voice Pipecat worker.

STT + TTS: Fish Audio (https://fish.audio). LLM: DeepSeek, another explicit
OpenAI-compatible endpoint, or opt-in local Ollama through its /v1 endpoint.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class VoiceConfig:
    port: int
    sample_rate: int
    fish_api_key: str
    fish_reference_id: str | None
    fish_tts_model: str | None
    llm_base_url: str
    llm_api_key: str
    llm_model: str


def load_config() -> VoiceConfig:
    local_model = (os.environ.get("CLYRA_OLLAMA_MODEL") or os.environ.get("CLYRA_LOCAL_MODEL") or "").strip()
    local_host = (os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")
    llm_api_key = os.environ.get("MY_LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ("ollama" if local_model else "")
    llm_base_url = (
        os.environ.get("MY_LLM_BASE_URL")
        or ("https://api.deepseek.com" if os.environ.get("DEEPSEEK_API_KEY") else f"{local_host}/v1" if local_model else "https://api.openai.com/v1")
    )
    llm_model = (
        os.environ.get("MY_LLM_MODEL")
        or os.environ.get("DEEPSEEK_MODEL")
        or ("deepseek-v4-flash" if os.environ.get("DEEPSEEK_API_KEY") else local_model or "gpt-4o-mini")
    )
    return VoiceConfig(
        port=int(os.environ.get("PIPELINE_PORT", os.environ.get("VOICE_PIPELINE_PORT", "8787"))),
        sample_rate=int(os.environ.get("VOICE_SAMPLE_RATE", "16000")),
        fish_api_key=os.environ.get("FISH_AUDIO_API_KEY", ""),
        fish_reference_id=os.environ.get("FISH_TTS_REFERENCE_ID") or None,
        fish_tts_model=os.environ.get("FISH_TTS_MODEL") or None,
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
    )
