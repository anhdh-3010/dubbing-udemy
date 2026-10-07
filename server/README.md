# TTS server

VieNeu v3 Turbo (voice "Hải Đăng", 48 kHz) behind an OpenAI-shaped HTTP endpoint, for the Udemy dubbing extension.

## Run

Native under `launchd` is the default. Docker still works and is documented
below, but it measured 2.7x slower on this machine (see the table further
down), so it is not what runs day to day.

Python 3.13, not 3.14: `requirements.txt` pins onnxruntime 1.23.2 (newer
releases refuse to load Turbo out of the Hugging Face cache — see the comment
there), and 1.23.2 has no 3.14 wheel.

```bash
uv venv --python 3.13 .venv
uv pip install -p .venv -r requirements.txt
./install-agent.sh
```

`install-agent.sh` writes `~/Library/LaunchAgents/com.udemy-dubbing.tts.plist`
with this directory's real path substituted in, loads it, and waits for
`/health` to answer. The agent has `RunAtLoad` and `KeepAlive`, so the server
comes back after a crash and after a reboot.

The model is loaded on the first synthesis request, not at startup, and stays
in memory afterwards: about 1.9–2.8 GB resident for as long as the agent runs.
That is the deliberate trade — no second cold start, ever.

Logs go to `tts.log` in this directory. To remove the agent:

```bash
./uninstall-agent.sh
```

To run it in the foreground instead, without launchd:

```bash
./.venv/bin/python app.py
```

## Endpoint

```bash
curl -X POST http://127.0.0.1:8770/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input": "Xin chào, đây là một component React."}' \
  --output out.wav
```

Responses carry `X-Audio-Duration` (seconds, exact) so the scheduler can
compute its stretch factor without decoding the audio first.

`voice` may be set per request; the default comes from `VIENEU_VOICE` in
`com.udemy-dubbing.tts.plist` (or `docker-compose.yml` under Docker). `steps`
is still accepted for compatibility but ignored: it was a Nano setting.

## Why not `python -m apps.openai_speech`

The server bundled with `vieneu` also serves Turbo, but `app.py` adds lazy
loading, the duration header, and a CORS policy scoped to
`chrome-extension://` origins.

## Why Turbo, not Nano

Turbo has the "Hải Đăng" voice and 48 kHz output; Nano has neither. The cost
is speed and memory. Measured on an M2 Pro, native:

| | RTF (warm) | Cold load | RAM |
|---|---|---|---|
| v3 Nano, 8 steps, 2 threads | 0.105 | 4.3s | 478 MB |
| v3 Turbo, default 6 threads | ~0.22 | ~6s | 1.9–2.8 GB |

Turbo is still about 4x faster than real time, so the extension's lookahead
stays ahead of playback. Turbo picks its own ONNX Runtime thread count
(half the cores, capped at 8), so `OMP_NUM_THREADS` no longer applies; 2
threads measured RTF 0.31 against 0.22 for the default.

Docker was measured on Nano only, at 2.7x slower than native under Colima,
most likely because the Linux arm64 ONNX Runtime build cannot reach the
accelerated kernels the macOS build uses. Expect the same gap for Turbo.

## Running it in Docker instead

```bash
docker-compose up -d
curl http://127.0.0.1:8770/health
```

Worth it when you need to stand this up on another machine, or want it gone
without leaving Python behind. Not worth it here: 2.7x slower, same file.
