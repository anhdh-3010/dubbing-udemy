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

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__DIR__|$DIR|g" "$DIR/$LABEL.plist" > "$TARGET"

# bootout first so this script can be re-run after an edit. An agent that
# was never loaded makes bootout exit non-zero, which is not an error here.
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$TARGET"

echo "installed $TARGET"
echo -n "waiting for the server to answer"
for _ in $(seq 1 20); do
    if curl -fs -m 1 http://127.0.0.1:8770/health >/dev/null; then
        echo " ok"

        # A 200 here only proves *something* answers on the port — not that
        # it is the instance we just bootstrapped. A stale process already
        # holding 8770 would pass this while the new instance crash-loops
        # under KeepAlive (e.g. EADDRINUSE on a re-install). Cross-check
        # with launchd itself: a live PID for our label and a clean last
        # exit status. A one-shot check right after the first 200 can catch
        # our own freshly bootstrapped instance mid-fork, before a fast
        # bind failure has even been recorded, so give it a moment to
        # settle first.
        sleep 1

        # Each grep is guarded with `|| true` because a miss (no PID line
        # while crash-looping) is an expected outcome here, not a script
        # error, and set -e would otherwise abort on it.
        JOB_INFO="$(launchctl list "$LABEL" 2>/dev/null || true)"
        JOB_PID="$(echo "$JOB_INFO" | grep '"PID"' | grep -Eo '[0-9]+' || true)"
        LAST_EXIT="$(echo "$JOB_INFO" | grep '"LastExitStatus"' | grep -Eo '\-?[0-9]+' || true)"

        if [ -n "$JOB_PID" ] && [ "$LAST_EXIT" = "0" ]; then
            curl -s http://127.0.0.1:8770/health
            echo
            exit 0
        fi

        echo "error: something answers on 8770, but launchd does not report" >&2
        echo "$LABEL healthy (pid=${JOB_PID:-none}, last exit status=${LAST_EXIT:-unknown})." >&2
        echo "Something else is likely still bound to the port — check $DIR/tts.log" >&2
        exit 1
    fi
    echo -n "."
    sleep 1
done

echo " timed out"
echo "check $DIR/tts.log" >&2
exit 1
