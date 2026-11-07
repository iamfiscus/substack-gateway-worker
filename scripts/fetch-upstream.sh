#!/usr/bin/env bash
# Clone the pinned upstream reference (read-only) into upstream/. Idempotent.
set -euo pipefail

REPO_URL="https://github.com/jakub-k-slys/substack-gateway-oss"
PIN="bc2e875"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/upstream"

if [ ! -d "$DEST/.git" ]; then
  git clone "$REPO_URL" "$DEST"
fi

cd "$DEST"
if [ "$(git rev-parse --short=7 HEAD)" != "$PIN" ]; then
  git fetch --quiet origin || true
  git checkout --quiet "$PIN"
fi
echo "upstream pinned at $(git rev-parse --short=7 HEAD)"
