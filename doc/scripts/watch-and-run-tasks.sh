#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
GLOBAL_RUNNER="${AI_PIPELINE_HOME:-$HOME/.codex/ai-pipeline}/bin/watch-and-run-tasks.sh"

cd "$ROOT_DIR"
export BASE_BRANCH="${BASE_BRANCH:-develop}"
export QUEUE_BRANCH="${QUEUE_BRANCH:-ai-task-queue}"
export AI_PIPELINE_PROJECT="ts_connect"
export AI_PIPELINE_CONTRACT_KIND="ai-task-contract"

if [ ! -x "$GLOBAL_RUNNER" ]; then
  echo "AI Pipeline runner not found or not executable: $GLOBAL_RUNNER" >&2
  exit 1
fi

exec "$GLOBAL_RUNNER" "$@"
