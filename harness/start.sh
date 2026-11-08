#!/usr/bin/env bash
# Start the fake Substack (:7000), upstream (:5001) and this Worker under
# `wrangler dev` (:8787), wait for all three, replay the matrix, print the JSON
# result and stop everything. Arguments are passed to harness/run.ts.
#
# Runs as the container's command (docker run, or exec'd by the Sandbox
# Worker) and equally on a dev machine with node 22, uv and upstream/ cloned.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${HARNESS_LOG_DIR:-$(mktemp -d)}"
FAKE=http://127.0.0.1:7000

cd "$ROOT"
pids=()
cleanup() {
  [ -n "${EMPTY_ENV:-}" ] && rm -f "$EMPTY_ENV"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

node harness/fakeSubstackServer.ts >"$LOGS/fake.log" 2>&1 &
pids+=($!)

(
  cd upstream
  SUBSTACK_GATEWAY_SUBSTACK_BASE_URL="$FAKE" SUBSTACK_GATEWAY_LOG_LEVEL=WARNING \
    HOST=127.0.0.1 PORT=5001 exec uv run --frozen python -m substack_gateway.main
) >"$LOGS/upstream.log" 2>&1 &
pids+=($!)

# Hermetic: an explicit (empty) --env-file makes wrangler skip any repo-root
# .dev.vars, and CLOUDFLARE_INCLUDE_PROCESS_ENV=false keeps the shell's env out,
# so local owner secrets never reach the harness Worker.
EMPTY_ENV="$(mktemp)"
WRANGLER_SEND_METRICS=false CLOUDFLARE_INCLUDE_PROCESS_ENV=false \
  npx wrangler dev --port 8787 --ip 127.0.0.1 --env-file "$EMPTY_ENV" \
  --var "SUBSTACK_BASE_URL:$FAKE" --var LOG_LEVEL:error >"$LOGS/worker.log" 2>&1 &
pids+=($!)

wait_for() {
  for _ in $(seq 1 120); do
    if curl -fs -o /dev/null "$1"; then return 0; fi
    sleep 1
  done
  echo "timed out waiting for $1 (logs in $LOGS)" >&2
  tail -n 40 "$LOGS"/*.log >&2
  return 1
}
wait_for "$FAKE/api/v1/handle/options"
wait_for http://127.0.0.1:5001/api/v1/health/live
wait_for http://127.0.0.1:8787/api/v1/health/live

node harness/run.ts --upstream http://127.0.0.1:5001 --worker http://127.0.0.1:8787 "$@"
