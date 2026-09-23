#!/usr/bin/env bash
set -euo pipefail
exec "${AI_PIPELINE_HOME:-$HOME/.ai-pipeline}/bin/run-ai-cycle.sh" "$@"
