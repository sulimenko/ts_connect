#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="${BASE_BRANCH:-develop}"
CHECK_MODE="${CHECK_MODE:-default}"

if [ ! -f package.json ]; then
  echo "ERROR: package.json not found" >&2
  exit 1
fi

git diff --check "$BASE_BRANCH"...HEAD

case "$CHECK_MODE" in
  default|test) npm test ;;
  lint) npm run lint ;;
  types) npm run types ;;
  full)
    npm run lint
    npm run types
    npm test
    ;;
  *)
    echo "ERROR: unknown CHECK_MODE=$CHECK_MODE" >&2
    exit 1
    ;;
esac
