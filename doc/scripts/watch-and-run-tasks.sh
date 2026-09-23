#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"
export BASE_BRANCH="${BASE_BRANCH:-develop}"
export QUEUE_BRANCH="${QUEUE_BRANCH:-ai-task-queue}"
exec "${AI_PIPELINE_HOME:-$HOME/.ai-pipeline}/bin/watch-and-run-tasks.sh" "$@"
