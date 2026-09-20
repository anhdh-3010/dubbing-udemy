# TTS server

VieNeu v3 Nano behind an OpenAI-shaped HTTP endpoint, for the Udemy dubbing extension.

## Run

Native under `launchd` is the default. Docker still works and is documented
below, but it measured 2.7x slower on this machine (see the table further
down), so it is not what runs day to day.

```bash
uv venv --python 3.14 .venv
uv pip install -p .venv -r requirements.txt
./install-agent.sh
```

`install-agent.sh` writes `~/Library/LaunchAgents/com.udemy-dubbing.tts.plist`
with this directory's real path substituted in, loads it, and waits for
`/health` to answer. The agent has `RunAtLoad` and `KeepAlive`, so the server
comes back after a crash and after a reboot.

The model is loaded on the first synthesis request, not at startup, and stays
in memory afterwards: about 478 MB resident for as long as the agent runs.
That is the deliberate trade — no second cold start, ever.

Logs go to `tts.log` in this directory. To remove the agent:

```bash
./uninstall-agent.sh
```

To run it in the foreground instead, without launchd:

```bash
OMP_NUM_THREADS=2 ./.venv/bin/python app.py
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

`voice` and `steps` may be set per request; the defaults come from
`VIENEU_VOICE` and `VIENEU_STEPS` in `com.udemy-dubbing.tts.plist` (or
`docker-compose.yml` under Docker).

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

## Running it in Docker instead

```bash
docker-compose up -d
curl http://127.0.0.1:8770/health
```

Worth it when you need to stand this up on another machine, or want it gone
without leaving Python behind. Not worth it here: 2.7x slower, same file.
