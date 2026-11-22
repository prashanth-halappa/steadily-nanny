#!/usr/bin/env bash
# ============================================================================
# Run against the LOCAL D1 database — never the remote one.
# ============================================================================
# The API is a Worker served by `wrangler dev`, which binds a Miniflare D1
# persisted under apps/api/.wrangler/state/v3. Every subcommand here passes
# `--local`, and the seeders reach the same files through scripts/lib/localDb.ts,
# so nothing in this script can touch the remote database.
#
# Usage:
#   scripts/dev-local.sh api       # API on :8080, bound 0.0.0.0 (LAN-reachable)
#   scripts/dev-local.sh mobile    # Metro, EXPO_PUBLIC_API_URL pointed at the LAN IP
#   scripts/dev-local.sh seed      # (re)create the test cast
#   scripts/dev-local.sh reset     # wipe the local D1, apply ALL migrations, re-seed
#   scripts/dev-local.sh migrate   # apply pending migrations only, keep the data
#   scripts/dev-local.sh job <name>  # fire a scheduled job by hand
#
# Port 8080 (not wrangler's default 8787) because the Maestro harness
# (apps/mobile/.maestro/run-phase4.sh) and apps/mobile/.env.example assume it.
# Override the LAN address for the physical devices with LAN_IP=192.168.x.y.
set -euo pipefail
cd "$(dirname "$0")/.."

API_PORT=8080
LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0)}"

# `--local` only; wrangler reports the applied/pending list itself and exits
# non-zero if a migration fails.
migrate() {
  (cd apps/api && bunx wrangler d1 migrations apply steadily-nanny --local)
}

case "${1:-}" in
  api)
    cd apps/api
    mkdir -p logs
    LOG_LEVEL=debug bunx wrangler dev --ip 0.0.0.0 --port "$API_PORT" \
      --test-scheduled 2>&1 | tee -a logs/dev.log
    ;;
  mobile)
    # Simulators could use localhost, the phones cannot. One LAN address serves
    # all four clients, so there is only ever one value to be wrong.
    export EXPO_PUBLIC_API_URL="http://$LAN_IP:$API_PORT/api"
    echo "mobile -> API $EXPO_PUBLIC_API_URL"
    exec bun run --cwd apps/mobile dev
    ;;
  seed)
    exec bun scripts/seed-test-users.ts
    ;;
  reset)
    # Destructive and total: deletes the local D1 files and replays every
    # migration. A running `wrangler dev` keeps the old sqlite file open, so
    # refuse rather than leave it serving a database that no longer exists.
    if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "refusing: something is listening on :$API_PORT — stop wrangler dev first" >&2
      exit 1
    fi
    rm -rf apps/api/.wrangler/state/v3/d1
    migrate
    exec bun scripts/seed-test-users.ts
    ;;
  migrate)
    # Non-destructive: applies only the pending tail. Use this when a migration
    # lands mid-pass and you do not want to lose the households you built.
    migrate
    ;;
  job)
    key="$(grep -hE '^JOB_API_KEY=' apps/api/.dev.vars apps/api/.env 2>/dev/null \
      | head -1 | cut -d= -f2- | tr -d '"'"'"'' || true)"
    curl -fsS -X POST "http://127.0.0.1:$API_PORT/api/jobs/${2:?job name required}" \
      -H "X-Job-Api-Key: $key" && echo
    ;;
  *)
    echo "usage: $0 api|mobile|seed|reset|migrate|job <name>" >&2
    exit 2
    ;;
esac
