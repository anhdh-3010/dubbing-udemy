#!/bin/bash
# Installs the TTS server as a launchd user agent. Idempotent: re-running
# replaces the existing agent rather than failing.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.udemy-dubbing.tts"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -x "$DIR/.venv/bin/python" ]; then
    echo "error: $DIR/.venv/bin/python not found — run the install steps in README.md first" >&2
    exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
    echo "error: lsof not found — cannot verify which process ends up on port 8770" >&2
    exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__DIR__|$DIR|g" "$DIR/$LABEL.plist" > "$TARGET"

# bootout first so this script can be re-run after an edit. An agent that
# was never loaded makes bootout exit non-zero, which is not an error here.
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true

# bootout can return before launchd has finished tearing the job down, so
# an immediate bootstrap of the same label can fail transiently with
# "Input/output error" — reproduced repeatedly by re-installing over a
# live instance, which is exactly the idempotent path this script's own
# header advertises and Task 10's recovery steps rely on. A bare retry
# demonstrably succeeds, so retry here instead of making the operator do
# it by hand.
BOOTSTRAP_OK=false
for attempt in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$UID" "$TARGET"; then
        BOOTSTRAP_OK=true
        break
    fi
    echo "bootstrap attempt $attempt failed (launchd is likely still tearing down the previous instance) — retrying..." >&2
    sleep 1
done

if [ "$BOOTSTRAP_OK" != true ]; then
    echo "error: launchctl bootstrap kept failing after $attempt attempts — check $DIR/tts.log" >&2
    exit 1
fi

echo "installed $TARGET"
echo -n "waiting for the server to answer"
for _ in $(seq 1 20); do
    if curl -fs -m 1 http://127.0.0.1:8770/health >/dev/null; then
        echo " ok"

        # A 200 here only proves *something* answers on the port — not that
        # it is the instance we just bootstrapped. A stale process already
        # holding 8770 would pass this while the new instance crash-loops
        # under KeepAlive (e.g. EADDRINUSE on a re-install). Answer the
        # exact question instead: is the PID listening on the port the
        # same PID launchd reports for our label? (LastExitStatus is not
        # part of this check — it is the last exit recorded for the
        # label, not for whatever is running now, so a stale non-zero
        # value there can coexist with a perfectly healthy live PID.) A
        # brief settle avoids reading launchd's bookkeeping in the instant
        # right after bootstrap returns.
        sleep 1

        PORT_PID="$(lsof -ti tcp:8770 -sTCP:LISTEN || true)"

        # Each grep is guarded with `|| true` because a miss (no PID line
        # while crash-looping) is an expected outcome here, not a script
        # error, and set -e would otherwise abort on it.
        JOB_INFO="$(launchctl list "$LABEL" 2>/dev/null || true)"
        JOB_PID="$(echo "$JOB_INFO" | grep '"PID"' | grep -Eo '[0-9]+' || true)"
        LAST_EXIT="$(echo "$JOB_INFO" | grep '"LastExitStatus"' | grep -Eo '\-?[0-9]+' || true)"

        if [ -n "$PORT_PID" ] && [ "$PORT_PID" = "$JOB_PID" ]; then
            curl -s http://127.0.0.1:8770/health
            echo
            exit 0
        fi

        echo "error: something answers on 8770, but it is not the instance" >&2
        echo "launchd just bootstrapped — port pid=${PORT_PID:-none}, $LABEL pid=${JOB_PID:-none}" >&2
        echo "(last exit status=${LAST_EXIT:-unknown}, for context). Check $DIR/tts.log" >&2
        exit 1
    fi
    echo -n "."
    sleep 1
done

echo " timed out"
echo "check $DIR/tts.log" >&2
exit 1
