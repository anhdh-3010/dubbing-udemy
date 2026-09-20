#!/bin/bash
# Removes the launchd user agent. Leaves .venv and the model cache alone.
set -euo pipefail

LABEL="com.udemy-dubbing.tts"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$TARGET"
echo "removed $TARGET"
