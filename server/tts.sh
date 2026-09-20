#!/bin/bash
# Control the local VieNeu TTS server.
#
# Thin wrapper over launchctl and install-agent.sh — it adds no logic of its
# own beyond reporting, so there is one place (install-agent.sh) that knows
# how to bring the agent up and verify it really came up.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.udemy-dubbing.tts"
URL="http://127.0.0.1:8770"

loaded() { launchctl list | grep -q "$LABEL"; }
answering() { curl -fs -m 2 "$URL/health" >/dev/null 2>&1; }

case "${1:-status}" in
  start)
    if loaded && answering; then
      echo "already running"
      exec "$0" status
    fi
    # install-agent.sh is idempotent, retries the bootout/bootstrap race, and
    # confirms the PID on the port belongs to the agent before claiming success.
    exec "$DIR/install-agent.sh"
    ;;

  stop)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    sleep 1
    if answering; then
      echo "something is STILL answering on 8770 — it is not this agent" >&2
      exit 1
    fi
    echo "stopped"
    ;;

  restart)
    "$0" stop
    exec "$0" start
    ;;

  status)
    if ! loaded; then
      echo "agent:  not loaded   (run: ./tts.sh start)"
      # A listener with no agent loaded means something else holds the port,
      # which is worth saying out loud rather than reporting a bare "down".
      answering && echo "WARNING: something else is answering on 8770"
      exit 1
    fi
    read -r pid _ <<<"$(launchctl list | grep "$LABEL")"
    echo "agent:  loaded, pid $pid"
    if answering; then
      echo "health: $(curl -s "$URL/health")"
      echo "memory: $(( $(ps -o rss= -p "$pid") / 1024 )) MB resident"
    else
      echo "health: NOT ANSWERING — check $DIR/tts.log"
      exit 1
    fi
    ;;

  logs)
    tail -f "$DIR/tts.log"
    ;;

  *)
    echo "usage: ./tts.sh [start|stop|restart|status|logs]" >&2
    exit 2
    ;;
esac
