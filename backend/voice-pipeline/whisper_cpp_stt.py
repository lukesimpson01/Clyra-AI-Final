"""Local whisper.cpp STT for the Pipecat call pipeline.

Transcription runs against one warm `whisper-server` process shared by every
call this worker handles, instead of spawning a fresh `whisper-cli` process
(and reloading the model) for every utterance and every ~750ms partial. Audio
never leaves the machine.

Partial (interim) transcription also only re-decodes the most recent
`PARTIAL_WINDOW_SECS` of the in-progress utterance rather than the entire
growing buffer, so its cost stays roughly constant instead of growing with
utterance length. The final transcript (`run_stt`, called once per utterance
after the user stops speaking) always uses the complete segment.
"""
from __future__ import annotations

import asyncio
import io
import os
import platform
import time
import wave
from pathlib import Path
from typing import AsyncGenerator, Optional

import aiohttp
from loguru import logger
from pipecat.frames.frames import ErrorFrame, Frame, InterimTranscriptionFrame, TranscriptionFrame
from pipecat.services.settings import STTSettings
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.transcriptions.language import Language
from pipecat.utils.time import time_now_iso8601

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RUNTIME = ROOT / "speech-runtime" if (ROOT / "speech-runtime").exists() else ROOT / "vendor" / "whisper.cpp"
RUNTIME = Path(os.environ.get("CLYRA_WHISPER_RUNTIME", DEFAULT_RUNTIME))
SERVER_BIN = Path(
    os.environ.get(
        "CLYRA_WHISPER_SERVER_BIN",
        RUNTIME / "build" / "bin" / ("whisper-server.exe" if os.name == "nt" else "whisper-server"),
    )
)
MODEL_DIR = Path(os.environ.get("CLYRA_WHISPER_MODEL_DIR", RUNTIME / "models"))
SERVER_HOST = "127.0.0.1"
SERVER_PORT = int(os.environ.get("CLYRA_WHISPER_SERVER_PORT", "8790"))
SERVER_STARTUP_TIMEOUT_SECS = 20.0
PARTIAL_INTERVAL_SECS = 0.75
PARTIAL_WINDOW_SECS = 8.0


def _model() -> Path:
    explicit = os.environ.get("CLYRA_WHISPER_MODEL")
    candidates = [Path(explicit)] if explicit else []
    candidates += [MODEL_DIR / name for name in ("ggml-small.en.bin", "ggml-small.en-q5_1.bin", "ggml-base.en.bin", "ggml-base.en-q5_1.bin", "ggml-tiny.en.bin", "ggml-tiny.en-q5_1.bin")]
    return next((candidate for candidate in candidates if candidate.exists()), candidates[0] if candidates else MODEL_DIR / "ggml-small.en.bin")


def _pcm_to_wav_bytes(pcm: bytes, rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setsampwidth(2); wav.setnchannels(1); wav.setframerate(rate); wav.writeframes(pcm)
    return buffer.getvalue()


class _WarmWhisperServer:
    """Keeps one `whisper-server` process (model loaded once) alive for the
    life of this worker. Shared by every voice call in this process -- fine
    for Clyra's single-user desktop usage; two calls transcribing at the
    exact same moment would serialize through it rather than run in
    parallel, which is an acceptable trade-off for avoiding a model reload
    (and a fresh process spawn) on every single utterance and partial.
    """

    def __init__(self) -> None:
        self._process: Optional[asyncio.subprocess.Process] = None
        self._session: Optional[aiohttp.ClientSession] = None
        self._starting: Optional[asyncio.Task] = None

    async def transcribe(self, pcm: bytes, sample_rate: int, language: str) -> str:
        session = await self._ensure_started()
        form = aiohttp.FormData()
        form.add_field("file", _pcm_to_wav_bytes(pcm, sample_rate), filename="utterance.wav", content_type="audio/wav")
        form.add_field("response_format", "text")
        form.add_field("language", language)
        async with session.post(
            f"http://{SERVER_HOST}:{SERVER_PORT}/inference",
            data=form,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            body = await resp.text()
            if resp.status != 200:
                raise RuntimeError(f"whisper-server failed ({resp.status}): {body[:220]}")
            return body.strip()

    async def _ensure_started(self) -> aiohttp.ClientSession:
        if self._session is not None and self._process is not None and self._process.returncode is None:
            return self._session
        if self._starting is None or self._starting.done():
            self._starting = asyncio.ensure_future(self._start())
        await self._starting
        assert self._session is not None
        return self._session

    async def _start(self) -> None:
        if not SERVER_BIN.exists():
            raise RuntimeError("Local Whisper is not installed. Run npm run setup:speech once.")
        model = _model()
        if not model.exists():
            raise RuntimeError("A local Whisper model is missing. Run npm run setup:speech once.")
        args = [
            str(SERVER_BIN), "-m", str(model),
            "--host", SERVER_HOST, "--port", str(SERVER_PORT),
            "-t", str(max(2, min(8, os.cpu_count() or 4))), "-l", "en",
        ]
        if platform.system() == "Darwin" and platform.machine().lower() not in ("arm64", "aarch64"):
            args.insert(1, "-ng")
        logger.info(f"[whisper.cpp] starting warm server on :{SERVER_PORT}")
        self._process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        self._session = aiohttp.ClientSession()
        deadline = time.monotonic() + SERVER_STARTUP_TIMEOUT_SECS
        last_error: Optional[BaseException] = None
        while time.monotonic() < deadline:
            if self._process.returncode is not None:
                stderr = await self._process.stderr.read() if self._process.stderr else b""
                raise RuntimeError(f"whisper-server exited before starting: {stderr.decode(errors='ignore')[-300:]}")
            try:
                _reader, writer = await asyncio.open_connection(SERVER_HOST, SERVER_PORT)
                writer.close()
                logger.info("[whisper.cpp] warm server ready")
                return
            except OSError as exc:
                last_error = exc
                await asyncio.sleep(0.2)
        raise RuntimeError(f"whisper-server did not become ready in time: {last_error}")

    async def stop(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None
        if self._process is not None and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
        self._process = None
        self._starting = None


_warm_server = _WarmWhisperServer()


async def shutdown_warm_server() -> None:
    await _warm_server.stop()


class WhisperCppSTTService(SegmentedSTTService):
    def __init__(self, *, sample_rate: Optional[int] = None, language: str = "en", **kwargs):
        super().__init__(sample_rate=sample_rate, settings=STTSettings(model="whisper.cpp", language=Language.EN), **kwargs)
        self._language = language
        self._partial_task: Optional[asyncio.Task] = None
        self._user_id = ""

    async def stop(self, frame):
        await self._cancel_partial_task(); await super().stop(frame)

    async def cancel(self, frame):
        await self._cancel_partial_task(); await super().cancel(frame)

    async def _cancel_partial_task(self):
        if self._partial_task and not self._partial_task.done(): self._partial_task.cancel()
        self._partial_task = None

    async def _handle_user_started_speaking(self, frame):
        await super()._handle_user_started_speaking(frame)
        self._partial_task = self.create_task(self._partial_loop())

    async def _handle_user_stopped_speaking(self, frame):
        await self._cancel_partial_task(); await super()._handle_user_stopped_speaking(frame)

    async def _partial_loop(self):
        window_bytes = int(PARTIAL_WINDOW_SECS * self.sample_rate) * 2  # 16-bit mono PCM
        try:
            while True:
                await asyncio.sleep(PARTIAL_INTERVAL_SECS)
                snapshot = bytes(self._audio_buffer[-window_bytes:])
                if len(snapshot) < self.sample_rate: continue
                text = await self._transcribe(snapshot)
                if text: await self.push_frame(InterimTranscriptionFrame(text=text, user_id=self._user_id, timestamp=time_now_iso8601(), language=Language.EN))
        except asyncio.CancelledError:
            return

    async def _transcribe(self, pcm: bytes) -> str:
        try:
            return await _warm_server.transcribe(pcm, self.sample_rate, self._language)
        except Exception as exc:
            raise RuntimeError(f"whisper.cpp failed: {exc}") from exc

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        started = time.perf_counter()
        try: text = await self._transcribe(audio)
        except Exception as exc:
            logger.warning(f"[whisper.cpp] transcription failed: {exc}"); yield ErrorFrame(str(exc)); return
        logger.debug(f"[whisper.cpp] final in {(time.perf_counter() - started) * 1000:.0f}ms: {text!r}")
        if text: yield TranscriptionFrame(text=text, user_id=self._user_id, timestamp=time_now_iso8601(), language=Language.EN)
