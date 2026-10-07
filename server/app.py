"""OpenAI-compatible TTS server for the Udemy dubbing extension.

Serves VieNeu v3 Turbo, for its "Hải Đăng" voice and 48 kHz output.
v3 Nano was about 2.6x faster on CPU (RTF 0.105 against Turbo's ~0.22 on
an M2 Pro) but has no such voice. The request shape matches OpenAI's, so a
single TTSProvider implementation can talk to either this or OpenAI's
hosted API.
"""

import io
import os
import time
import wave

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

VOICE = os.environ.get("VIENEU_VOICE", "Hải Đăng")
PORT = int(os.environ.get("PORT", "8770"))

app = FastAPI(title="Udemy Dubbing TTS", version="1.0")

# The extension calls this from its service worker, so the origin is the
# extension's own chrome-extension:// URL rather than udemy.com.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
    expose_headers=["X-Audio-Duration", "X-Synthesis-Seconds"],
)

_tts = None


def _engine():
    """Load the model on first use, not at startup.

    Keeps idle memory low; the ~6s cold load overlaps the first
    translation batch, so it is not felt at the start of a lecture.

    Threads are left at the engine's default (half the cores, capped at
    8). Unlike Nano, Turbo sets its own ONNX Runtime thread count, so
    OMP_NUM_THREADS does not reach it; on an M2 Pro, 6 threads ran at RTF
    0.22 against 0.31 for 2.
    """
    global _tts
    if _tts is None:
        from vieneu import Vieneu

        _tts = Vieneu(mode="v3turbo")
    return _tts


def _to_wav(audio, sample_rate: int) -> tuple[bytes, float]:
    samples = np.asarray(audio, dtype=np.float32).squeeze()
    peak = float(np.abs(samples).max()) or 1.0
    pcm = (samples / peak * 0.95 * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue(), len(pcm) / sample_rate


class SpeechRequest(BaseModel):
    input: str
    voice: str | None = None
    steps: int | None = None            # accepted and ignored: a Nano setting Turbo has no use for
    model: str | None = None            # accepted and ignored, for API compatibility
    response_format: str | None = None  # only "wav" is produced


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest) -> Response:
    text = req.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is empty")

    started = time.time()
    try:
        engine = _engine()
        audio = engine.infer(text, voice=req.voice or VOICE)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"synthesis failed: {exc}") from exc
    elapsed = time.time() - started

    data, duration = _to_wav(audio, engine.sample_rate)
    return Response(
        content=data,
        media_type="audio/wav",
        headers={
            # Exact duration, so the scheduler can compute its stretch
            # factor without decoding the audio first.
            "X-Audio-Duration": f"{duration:.3f}",
            "X-Synthesis-Seconds": f"{elapsed:.3f}",
        },
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model_loaded": _tts is not None, "model": "v3turbo", "voice": VOICE}


if __name__ == "__main__":
    import uvicorn

    # Loopback by default, not 0.0.0.0. The mixed-content exemption that lets
    # an HTTPS page call this server applies to 127.0.0.1 only (spec 4.2), so
    # binding wider buys nothing and exposes the machine to its LAN. Anyone
    # who wants that has to ask for it by name.
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=PORT, workers=1)
