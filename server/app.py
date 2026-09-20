"""OpenAI-compatible TTS server for the Udemy dubbing extension.

The `apps.openai_speech` server bundled with `vieneu` hardcodes mode
"v3turbo" (see its line 100), which is roughly six times slower on CPU
than the v3 Nano model this project settled on. This wrapper serves
Nano instead, and keeps the same request shape so a single TTSProvider
implementation can talk to either this or OpenAI's hosted API.
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

# Must be set before onnxruntime is imported, which happens lazily inside
# _engine(). Two threads beat the default by about 18% on this workload —
# it loses to thread contention rather than gaining from more cores (spec
# 8.1). setdefault, not assignment: an explicit value from the environment
# or the launchd plist still wins.
os.environ.setdefault("OMP_NUM_THREADS", "2")

VOICE = os.environ.get("VIENEU_VOICE", "Minh Quân")
STEPS = int(os.environ.get("VIENEU_STEPS", "8"))
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

    Keeps idle memory low; the ~5s cold load overlaps the first
    translation batch, so it is not felt at the start of a lecture.
    """
    global _tts
    if _tts is None:
        from vieneu import Vieneu

        _tts = Vieneu(mode="v3nano")
    return _tts


def _to_wav(audio, sample_rate: int = 24000) -> tuple[bytes, float]:
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
    steps: int | None = None
    model: str | None = None            # accepted and ignored, for API compatibility
    response_format: str | None = None  # only "wav" is produced


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest) -> Response:
    text = req.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is empty")

    started = time.time()
    try:
        audio = _engine().infer(
            text,
            voice=req.voice or VOICE,
            steps=req.steps or STEPS,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"synthesis failed: {exc}") from exc
    elapsed = time.time() - started

    data, duration = _to_wav(audio)
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
    return {"status": "ok", "model_loaded": _tts is not None, "voice": VOICE, "steps": STEPS}


if __name__ == "__main__":
    import uvicorn

    # Loopback by default, not 0.0.0.0. The mixed-content exemption that lets
    # an HTTPS page call this server applies to 127.0.0.1 only (spec 4.2), so
    # binding wider buys nothing and exposes the machine to its LAN. Anyone
    # who wants that has to ask for it by name.
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=PORT, workers=1)
