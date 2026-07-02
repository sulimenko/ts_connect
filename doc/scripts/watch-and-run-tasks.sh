#!/usr/bin/env bash
set -euo pipefail

GLOBAL_RUNNER="${HOME}/.codex/ai-pipeline/bin/watch-and-run-tasks.sh"

if [ ! -x "$GLOBAL_RUNNER" ]; then
  echo "AI Pipeline runner not found or not executable: $GLOBAL_RUNNER" >&2
  exit 1
fi

exec "$GLOBAL_RUNNER"
