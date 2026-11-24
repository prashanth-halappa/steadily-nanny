#!/usr/bin/env bash
# Full launch-pass seed chain, and the regeneration of apps/mobile/.env.maestro
# that has to follow it.
#
# WHY ONE SCRIPT
# The chain has six ordered steps and two of them used to be hand-typed SQL.
# Run out of order, or with one step skipped, the result is not an error — it is
# a green run against fixtures that do not exist. `seed-e2e-approval-fixtures.ts`
# in particular prints `[skip]` and exits 0 when "Our household" is missing, so
# this script greps for that and fails loudly.
#
# A full reset (local D1 wiped, migrations replayed) invalidates every id in .env.maestro, so the file
# is rewritten from the seeders' own `# --- eval me` output rather than
# hand-merged. Ids from a prior reset are dead; never merge an old copy.
#
# Usage:
#   scripts/seed-launch-pass.sh            # full: db reset + whole chain
#   scripts/seed-launch-pass.sh --no-reset # re-seed fixtures, keep the DB
set -euo pipefail
cd "$(dirname "$0")/.."

# LOCAL only. Production refuses email/password sign-in, so remote seeding
# of email users can't work (scripts/lib/localDb.ts refuses it too).
if [ "${D1_REMOTE:-}" = "1" ]; then
  echo "refusing: D1_REMOTE=1 is no longer supported: production refuses email/password sign-in, so seeded email users could never log in there. Seed LOCAL D1 and run the tests against wrangler dev (apps/api, with EMAIL_AUTH_ENABLED=true in .dev.vars)." >&2
  exit 1
fi
D1_TARGET=--local

# One scalar from the D1: first column of the first row, or empty.
d1_scalar() {
  (cd apps/api && bunx wrangler d1 execute steadily-nanny "$D1_TARGET" --json --command "$1") \
    | bun -e 'const r = JSON.parse(await Bun.stdin.text()); const row = r[0]?.results?.[0]; console.log(row ? Object.values(row)[0] ?? "" : "")'
}

OUT=$(mktemp -t launchpass-seed)
trap 'rm -f "$OUT"' EXIT

step() { echo; echo "==> $*"; }

# `[skip]` from a fixture seeder is a silent no-op that exits 0. Treat it as
# fatal: downstream flows would fail on missing fixtures and read as app bugs.
run_seed() {
  local label="$1"; shift
  step "$label"
  "$@" 2>&1 | tee "$OUT"
  if grep -q '^\[skip\] *Could not find' "$OUT"; then
    echo "FATAL: $label skipped its work — the household it needs does not exist." >&2
    exit 1
  fi
}

if [ "${1:-}" != "--no-reset" ]; then
  step "local D1 reset (destructive) + migrations + test users"
  scripts/dev-local.sh reset
else
  step "skipping db reset (--no-reset); ensuring test users (idempotent)"
  bun run scripts/seed-test-users.ts
fi

run_seed "bootstrap: Our household + nanny draft household" \
  bun run scripts/seed-launch-pass-bootstrap.ts
BOOTSTRAP_KV=$(sed -n '/^# --- eval me/,$p' "$OUT" | grep -E '^[A-Z0-9_]+=' || true)

run_seed "seed-e2e-approval-fixtures (--reset)" \
  bun run scripts/seed-e2e-approval-fixtures.ts --reset
# This one prints `KEY: value`, not KEY=VALUE — convert the three ids by hand.
APPROVAL_KV=$(grep -E '^ *(EXTRA_SHIFT_ID|DEMOTED_SHIFT_ID|TIME_ENTRY_ID): ' "$OUT" \
  | sed -E 's/^ *([A-Z_]+): +([^ ]+).*/\1=\2/' || true)

run_seed "seed-second-household (LEAKCANARY)" \
  bun run scripts/seed-second-household.ts
CROSS_KV=$(sed -n '/^# --- eval me/,$p' "$OUT" | grep -E '^CROSS_HOUSEHOLD_[A-Z0-9_]+=' || true)
# That seeder prints canary strings but no id, and flow 22 deep-links by id.
# Flows address carers by user id in a testID (pay-carer-picker-<id>), so the
# ids of the cast members no seeder prints are needed too.
NANNY2_ID=$(d1_scalar "select id from user where email='nanny2@steadilynanny.test'")
COPARENT_ID=$(d1_scalar "select id from user where email='coparent@steadilynanny.test'")
OTHER_PARENT_ID=$(d1_scalar "select id from user where email='otherparent@steadilynanny.test'")
: "${NANNY2_ID:?nanny2 user missing}"
LEAKCANARY_HOUSEHOLD_ID=$(d1_scalar \
  "select id from households where name = 'LEAKCANARY the Cole household' limit 1")
: "${LEAKCANARY_HOUSEHOLD_ID:?second household not found after seeding}"

run_seed "seed-phase4-fixtures" \
  bun run scripts/seed-phase4-fixtures.ts
PHASE4_KV=$(sed -n '/^# --- eval me/,$p' "$OUT" | grep -E '^PHASE4_[A-Z0-9_]+=' || true)

run_seed "seed-usual-week-fixtures" \
  bun run scripts/seed-usual-week-fixtures.ts
USUALWEEK_KV=$(sed -n '/^# --- eval me/,$p' "$OUT" | grep -E '^USUAL_WEEK_[A-Z0-9_]+=' || true)

# The one value no seeder can derive: it must match what `wrangler dev` loads
# (apps/api/.dev.vars, else apps/api/.env) or the cover-ask-expiry curl 401s
# and flow 13b passes against an unexpired ask.
JOB_API_KEY=$(grep -hE '^JOB_API_KEY=' apps/api/.dev.vars apps/api/.env 2>/dev/null \
  | head -1 | cut -d= -f2- | tr -d '"'"'"'' || true)
: "${JOB_API_KEY:?JOB_API_KEY not found}"

# The bootstrap's PHASE4_HOUSEHOLD_ID and the phase4 seeder's must agree — they
# resolve the same household by the same rule, so a mismatch means one of them
# adopted a stray. Fail rather than pick one.
BOOT_HH=$(echo "$BOOTSTRAP_KV" | grep '^PHASE4_HOUSEHOLD_ID=' | cut -d= -f2)
SEED_HH=$(echo "$PHASE4_KV"    | grep '^PHASE4_HOUSEHOLD_ID=' | cut -d= -f2)
if [ -n "$SEED_HH" ] && [ "$BOOT_HH" != "$SEED_HH" ]; then
  echo "FATAL: household id mismatch — bootstrap=$BOOT_HH phase4=$SEED_HH" >&2
  exit 1
fi

step "regenerating apps/mobile/.env.maestro"
{
  echo "# Maestro E2E credentials + fixture IDs — GENERATED by"
  echo "# scripts/seed-launch-pass.sh on $(date '+%Y-%m-%d %H:%M:%S')."
  echo "# Every id below belongs to THIS reset. Do not hand-merge an older copy:"
  echo "# ids from a prior reset are dead."
  echo
  echo "PARENT_EMAIL=parent@steadilynanny.test"
  echo "PARENT_PASSWORD=SteadilyTest!2026"
  echo
  echo "NANNY_EMAIL=nanny@steadilynanny.test"
  echo "NANNY_PASSWORD=SteadilyTest!2026"
  echo
  echo "COPARENT_EMAIL=coparent@steadilynanny.test"
  echo "COPARENT_PASSWORD=SteadilyTest!2026"
  echo "NANNY2_EMAIL=nanny2@steadilynanny.test"
  echo "NANNY2_PASSWORD=SteadilyTest!2026"
  echo "OTHER_PARENT_EMAIL=otherparent@steadilynanny.test"
  echo "LEAKCANARY_HOUSEHOLD_ID=${LEAKCANARY_HOUSEHOLD_ID}"
  echo "NANNY2_ID=${NANNY2_ID}"
  echo "COPARENT_ID=${COPARENT_ID}"
  echo "OTHER_PARENT_ID=${OTHER_PARENT_ID}"
  echo
  echo "# Must match JOB_API_KEY in apps/api/.dev.vars or .env (jobAuth middleware)."
  echo "JOB_API_KEY=${JOB_API_KEY}"
  echo
  echo "# Monday anchor for the Hours deep-link regression (flow 05)."
  echo "HOURS_DEEPLINK_WEEK_START=2026-01-05"
  echo
  echo "# --- seed-second-household.ts (flows 35/36) ---"
  echo "$CROSS_KV"
  echo
  echo "# --- seed-e2e-approval-fixtures.ts (flows 02/03/04) ---"
  echo "$APPROVAL_KV"
  echo
  echo "# --- seed-launch-pass-bootstrap.ts ---"
  echo "$BOOTSTRAP_KV"
  echo
  echo "# --- seed-phase4-fixtures.ts ---"
  echo "$PHASE4_KV"
  echo
  echo "# --- seed-usual-week-fixtures.ts (flows 21/25) ---"
  echo "$USUALWEEK_KV"
  echo
  echo "PHASE4_TEST_PASSWORD=SteadilyTest!2026"
} > apps/mobile/.env.maestro

# A blank value reaches Maestro as the literal string "undefined" and turns a
# missing fixture into a mystery assertion failure three flows later.
if grep -qE '^[A-Z0-9_]+=$' apps/mobile/.env.maestro; then
  echo "FATAL: empty values in .env.maestro:" >&2
  grep -nE '^[A-Z0-9_]+=$' apps/mobile/.env.maestro >&2
  exit 1
fi

echo
echo "wrote apps/mobile/.env.maestro ($(grep -cE '^[A-Z0-9_]+=' apps/mobile/.env.maestro) keys)"
