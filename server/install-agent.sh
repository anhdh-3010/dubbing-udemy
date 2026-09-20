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
        curl -s http://127.0.0.1:8770/health
        echo
        exit 0
    fi
    echo -n "."
    sleep 1
done

echo " timed out"
echo "check $DIR/tts.log" >&2
exit 1
