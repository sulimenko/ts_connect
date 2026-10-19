#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"
exec "${AI_PIPELINE_HOME:-$HOME/.ai-pipeline}/bin/ai-pipeline" run "$@"
