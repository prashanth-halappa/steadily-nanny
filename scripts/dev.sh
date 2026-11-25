#!/usr/bin/env bash
# ============================================================================
# The three ways to run the app in dev. Each mode states its API and data
# explicitly, so apps/mobile/.env (which points at PRODUCTION) never decides.
# ============================================================================
#   bun run dev                       local Metro + local API + LOCAL D1
#   bun run devapp-devapi-proddata    local Metro + local API + PRODUCTION D1
#   bun run devapp-prodapi-proddata   local Metro + PRODUCTION API (+ its D1)
#
# Metro serves the app at this Mac's LAN IP so a phone (dev build) and the
# simulator both reach it. Override with LAN_IP=192.168.x.y.
# API output goes to apps/api/logs/dev.log (truncated on start):
#   tail -f apps/api/logs/dev.log
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-local}"
API_PORT=8080
PROD_API_URL="https://api.nanny.getsteadily.app/api"
LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)}"
LOCAL_API_URL="http://$LAN_IP:$API_PORT/api"

# A stale server on :8080 keeps serving whatever it booted with (GOLDEN-FIXES
# #26) — refuse rather than silently talk to it.
port_free() {
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "refusing: something is already listening on :$1 — stop it first" >&2
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >&2
    exit 1
  fi
}

start_api() {
  port_free "$API_PORT"
  mkdir -p apps/api/logs
  : >apps/api/logs/dev.log
  (cd apps/api && exec bunx wrangler dev --ip 0.0.0.0 --port "$API_PORT" "$@") \
    >>apps/api/logs/dev.log 2>&1 &
  API_PID=$!
  # Stop the API (bunx -> wrangler -> workerd) with Metro, however Metro exits.
  trap 'trap - EXIT INT TERM; kill 0 2>/dev/null || true' EXIT INT TERM
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && return
    kill -0 "$API_PID" 2>/dev/null || { tail -20 apps/api/logs/dev.log >&2; exit 1; }
    sleep 1
  done
  echo "API did not answer /health in 60s — see apps/api/logs/dev.log" >&2
  exit 1
}

case "$MODE" in
  local)
    start_api --test-scheduled
    API_URL="$LOCAL_API_URL"
    DATA="LOCAL D1 (apps/api/.wrangler/state)"
    # Keep dev sessions out of production analytics too (empty = off).
    export EXPO_PUBLIC_POSTHOG_API_KEY=""
    ;;
  devapi-proddata)
    if [ ! -f apps/api/.dev.vars.proddata ]; then
      # Without it wrangler falls back to .dev.vars (email sign-in ON).
      echo "refusing: apps/api/.dev.vars.proddata is missing" >&2
      exit 1
    fi
    # --remote: the local code runs on Cloudflare's edge (a preview, not a
    # deploy) because Apple's JWKS endpoint answers the local workerd runtime
    # with 403, so Sign in with Apple can only verify from the edge.
    # No --test-scheduled: jobs must not be fireable at production data from here.
    start_api --remote --env proddata --var "BETTER_AUTH_URL:http://$LAN_IP:$API_PORT"
    API_URL="$LOCAL_API_URL"
    DATA="PRODUCTION D1 — writes are real"
    ;;
  prodapi-proddata)
    API_URL="$PROD_API_URL"
    DATA="PRODUCTION (deployed API)"
    ;;
  *)
    echo "usage: $0 local|devapi-proddata|prodapi-proddata" >&2
    exit 2
    ;;
esac

echo "──────────────────────────────────────────────"
echo " mode : $MODE"
echo " API  : $API_URL"
echo " data : $DATA"
echo "──────────────────────────────────────────────"
export EXPO_PUBLIC_API_URL="$API_URL"
cd apps/mobile
mkdir -p logs
bun expo start -c 2>&1 | tee -a logs/dev.log
