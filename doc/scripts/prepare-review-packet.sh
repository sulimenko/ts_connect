#!/usr/bin/env bash
set -euo pipefail
exec "${AI_PIPELINE_HOME:-$HOME/.codex/ai-pipeline}/bin/prepare-review-packet.sh" "$@"
