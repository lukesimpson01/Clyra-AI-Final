"""Voice LLM gateway: an OpenAI-compatible endpoint served by this process.

The pipeline's LLM stage always talks to this loopback route. It forwards to the
configured cloud model and, when that account is out of credits or unreachable,
answers from a small local Ollama model instead, so a voice call keeps working.
The local model is picked automatically from what Ollama has installed.
"""

from __future__ import annotations

import os
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from config import load_config

router = APIRouter()

CREDIT = re.compile(
    r"insufficient(?:[_\s-]?(?:balance|quota|credit))|credit(?:s)?(?:\s+are)?\s+(?:exhausted|depleted)"
    r"|billing(?:\s+hard)?\s+limit|payment required|exceeded your current quota",
    re.I,
)
PREFERENCE = [
    r"^qwen3:(?:4b|8b)", r"^qwen2\.5:(?:3b|7b)", r"^llama3\.[123]:(?:3b|8b)", r"^gemma3:(?:4b|12b)",
    r"^phi4-mini", r"^phi4", r"^mistral", r"^gemma3", r"^llama3", r"^qwen", r"^phi3",
]
SKIP = re.compile(r"llava|embed|vision|clip|rerank|whisper|tts|moondream|bakllava", re.I)
_local: dict[str, Any] = {"model": None, "at": 0.0}


def _ollama_host() -> str:
    return (os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")


async def _local_model(client: httpx.AsyncClient) -> str | None:
    if os.environ.get("CLYRA_LOCAL_LLM_ENABLED") == "false":
        return None
    explicit = (os.environ.get("CLYRA_OLLAMA_MODEL") or os.environ.get("CLYRA_LOCAL_MODEL") or "").strip()
    if explicit:
        return explicit
    if time.time() - _local["at"] < 45:
        return _local["model"]
    _local["at"] = time.time()
    try:
        response = await client.get(f"{_ollama_host()}/api/tags", timeout=1.5)
        names = [m.get("name", "") for m in response.json().get("models", []) if m.get("name")]
        usable = [n for n in names if not SKIP.search(n)]
        pick = next((n for pattern in PREFERENCE for n in usable if re.match(pattern, n)), usable[0] if usable else None)
        _local["model"] = pick
    except Exception:
        _local["model"] = None
    return _local["model"]


async def _send(client: httpx.AsyncClient, url: str, key: str, body: dict[str, Any]) -> httpx.Response | None:
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        request = client.build_request("POST", url, json=body, headers=headers)
        return await client.send(request, stream=True)
    except Exception:
        return None


@router.post("/llm/v1/chat/completions")
async def chat_completions(request: Request) -> Response:
    body: dict[str, Any] = await request.json()
    config = load_config()
    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=8.0))
    attempts: list[tuple[str, str, str, str]] = []
    cloud_key = config.llm_api_key if config.llm_api_key and config.llm_api_key not in ("ollama", "gateway") else ""
    if cloud_key:
        attempts.append(("cloud", f"{config.llm_base_url.rstrip('/')}/chat/completions", cloud_key, body.get("model") or config.llm_model))
    local = await _local_model(client)
    if local:
        attempts.append(("local", f"{_ollama_host()}/v1/chat/completions", "", local))
    if not attempts:
        await client.aclose()
        return JSONResponse({"error": {"message": "No language model is available."}}, status_code=503)

    last: tuple[int, bytes] = (502, b"")
    for kind, url, key, model in attempts:
        payload = {**body, "model": model}
        response = await _send(client, url, key, payload)
        if response is not None and response.status_code == 400 and kind == "local" and payload.get("tools"):
            # Small local models often have no tool support: answer in plain chat.
            try:
                text = (await response.aread()).decode("utf-8", "ignore")
            except Exception:
                text = ""
            await response.aclose()
            if "does not support tools" in text.lower():
                plain = {k: v for k, v in payload.items() if k not in ("tools", "tool_choice")}
                response = await _send(client, url, key, plain)
        if response is None:
            continue
        if response.status_code < 400:
            media = response.headers.get("content-type", "text/event-stream" if body.get("stream") else "application/json")
            async def closer(resp=response, cl=client):
                await resp.aclose()
                await cl.aclose()
            return StreamingResponse(response.aiter_raw(), status_code=response.status_code, media_type=media, background=BackgroundTask(closer))
        try:
            raw = await response.aread()
        except Exception:
            raw = b""
        await response.aclose()
        last = (response.status_code, raw)
        # Out of credits, rate limited or a provider outage: try the next model.
        if response.status_code in (402, 429) or response.status_code >= 500 or CREDIT.search(raw.decode("utf-8", "ignore")):
            continue
        break
    await client.aclose()
    return Response(content=last[1], status_code=last[0], media_type="application/json")
