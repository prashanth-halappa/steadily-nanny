#!/usr/bin/env bash
# ============================================================================
# Run against the LOCAL Supabase stack — never the hosted project.
# ============================================================================
# `apps/api/.env` and `apps/mobile/.env` both point at PRODUCTION
# (GOLDEN-FIXES #26). Both apps load their .env with dotenv's default
# semantics, so an ALREADY-EXPORTED variable wins over the file. This script
# exports the local stack's values and never edits a file, which is why it is
# safe to run next to a checkout you have not "prepared" in any way.
#
# Usage:
#   scripts/dev-local.sh start     # bring the local stack up (see NOTE below)
#   scripts/dev-local.sh api       # API on :8080, bound 0.0.0.0 (LAN-reachable)
#   scripts/dev-local.sh mobile    # Metro, EXPO_PUBLIC_* pointed at the LAN IP
#   scripts/dev-local.sh seed      # (re)create the test cast
#   scripts/dev-local.sh reset     # wipe the local DB, replay ALL migrations, re-seed
#   scripts/dev-local.sh migrate   # apply pending migrations only, keep the data
#   scripts/dev-local.sh job <name>  # fire a scheduled job by hand
#
# Override the LAN address for the physical devices with LAN_IP=192.168.x.y.
#
# NOTE ON `start`: it passes `-x studio`. The pinned Studio image
# (2026.04.27-sha-4afbe9c) has a CORRUPT layer in the local Docker store —
# /app/apps/studio/package.json is 8098 null bytes, so Node exits with
# ERR_INVALID_PACKAGE_CONFIG, the container never turns healthy, and a plain
# `supabase start` tears the WHOLE stack back down (volumes included). Docker
# Desktop's containerd image store will not re-download a blob it already has,
# so `docker rmi` + `docker pull` is a no-op; the only real repair is
# `docker system prune -a` (~7GB re-download of every image). Studio is just
# the web dashboard — nothing in this repo's tooling needs it — so skipping it
# is the cheap fix. Drop the flag once the image has been purged and re-pulled.
set -euo pipefail
cd "$(dirname "$0")/.."

eval "$(supabase status -o env | sed 's/^/export /')"

# The whole point of the script. If `supabase status` ever hands back a hosted
# URL, stop rather than run a dev server or a service-role seed against it.
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "refusing: local stack reported $API_URL" >&2; exit 1 ;;
esac

export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY"

LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0)}"

# `supabase db reset` replays every file in supabase/migrations, and
# `migration up` applies the pending tail — but a migration that half-applies
# still leaves the CLI reporting success, and a stack that predates a new file
# looks identical to a healthy one until a screen 404s mid-scenario. Comparing
# the two counts is the cheapest thing that goes red on either.
assert_migrations() {
  local files applied newest
  files=$(ls supabase/migrations/*.sql | wc -l | tr -d " ")
  applied=$(psql "$DB_URL" -tAc \
    "select count(*) from supabase_migrations.schema_migrations" | tr -d " ")
  newest=$(basename "$(ls supabase/migrations/*.sql | tail -1)")
  if [ "$files" != "$applied" ]; then
    echo "migrations: $applied applied, $files on disk — local DB is behind ($newest is the newest file)" >&2
    exit 1
  fi
  echo "migrations: all $applied applied, through $newest"
}

case "${1:-}" in
  start)
    exec supabase start -x studio
    ;;
  api)
    exec bun run --cwd apps/api dev
    ;;
  mobile)
    # Simulators could use localhost, the phones cannot. One LAN address serves
    # all four clients, so there is only ever one value to be wrong.
    export EXPO_PUBLIC_SUPABASE_URL="http://$LAN_IP:54321"
    export EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
    export EXPO_PUBLIC_API_URL="http://$LAN_IP:8080/api"
    echo "mobile -> API http://$LAN_IP:8080/api  ·  Supabase http://$LAN_IP:54321"
    exec bun run --cwd apps/mobile dev
    ;;
  seed)
    exec bun scripts/seed-test-users.ts
    ;;
  reset)
    # Destructive and total: drops the local DB and replays 001 → newest, so a
    # migration added since the stack was created is picked up without any
    # separate step.
    supabase db reset
    assert_migrations
    exec bun scripts/seed-test-users.ts
    ;;
  migrate)
    # Non-destructive: applies only the pending tail. Use this when a migration
    # lands mid-pass and you do not want to lose the households you built.
    supabase migration up --local
    assert_migrations
    ;;
  job)
    key="$(grep -E '^JOB_API_KEY=' apps/api/.env | cut -d= -f2- | tr -d '"'"'"'')"
    curl -fsS -X POST "http://127.0.0.1:8080/api/jobs/${2:?job name required}" \
      -H "X-Job-Api-Key: $key" && echo
    ;;
  *)
    echo "usage: $0 start|api|mobile|seed|reset|migrate|job <name>" >&2
    exit 2
    ;;
esac
