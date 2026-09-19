# TTS server

VieNeu v3 Nano behind an OpenAI-shaped HTTP endpoint, for the Udemy dubbing extension.

## Run

```bash
docker-compose up -d        # or: docker build -t udemy-dubbing-tts . && docker run ...
curl http://127.0.0.1:8770/health
```

The model is not baked into the image. The host's HuggingFace cache is
mounted at `/models`, so the first run reuses weights already on disk
and downloads them only if they are missing.

## Endpoint

```bash
curl -X POST http://127.0.0.1:8770/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input": "Xin chào, đây là một component React."}' \
  --output out.wav
```

Responses carry `X-Audio-Duration` (seconds, exact) so the scheduler can
compute its stretch factor without decoding the audio first.

`voice` and `steps` may be set per request; the defaults come from
`VIENEU_VOICE` and `VIENEU_STEPS` in `docker-compose.yml`.

## Why not `python -m apps.openai_speech`

The server bundled with `vieneu` hardcodes `mode="v3turbo"`, which is
about six times slower on CPU than the Nano model this project uses,
with no environment variable to switch it. `app.py` is a thin wrapper
that serves Nano and adds lazy loading, the duration header, and a CORS
policy scoped to `chrome-extension://` origins.

## Measured on an M2 Pro

Same 17.2s of audio, Nano at 8 steps, through this same `app.py`:

| | Inference | RTF | Cold start | RAM |
|---|---|---|---|---|
| Native | 1.79s | 0.105 | 4.34s | 478 MB |
| This container (Colima, 2 CPU) | 4.89s | 0.284 | 7.72s | 639 MB |

The container is 2.7x slower. CPU count is not the cause — native
pinned to 2 threads is actually *faster* than native unpinned (1.47s),
so the workload suffers from thread contention rather than benefiting
from more cores. Setting `OMP_NUM_THREADS=2` is worth about 18% either
way. The likely reason for the gap is that the Linux arm64 ONNX Runtime
build cannot reach the accelerated kernels the macOS build uses.

Still comfortably faster than real time, so the extension's lookahead
stays ahead of playback either way. The cost is power, not latency.

## Running it natively instead

Same file, no container:

```bash
pip install vieneu==3.8.1
OMP_NUM_THREADS=2 PORT=8770 python app.py
```
