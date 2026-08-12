#!/bin/zsh -e
#
# Phase 4 (§9) cross-cutting Maestro batch: seed, then run flows 07-15 in
# dependency order, expiring the cover asks between 13a and 13b.
#
# Usage (from anywhere):
#   ./apps/mobile/.maestro/run-phase4.sh
#
# Requires:
#   - ONE booted simulator. Two booted sims make Maestro drive the wrong one
#     and `--udid` does not help — this has produced a false regression report
#     before. Check with `xcrun simctl list devices booted`.
#   - Metro on :8081 and the API on :8080 (the flows deep-link through the
#     expo-development-client URL and this script curls the job endpoint).
#   - SUPABASE_URL / SUPABASE_SERVICE_KEY exported for the LOCAL stack
#     (`supabase status -o env`). apps/api/.env points at production, so the
#     seeder's loopback guard refuses a bare run — that is deliberate
#     (GOLDEN-FIXES #26).
#   - apps/mobile/.env.maestro for the credentials (see .env.maestro.example).
#
# Every flow gets its `-e` arguments spelled out one per pair. Word-splitting a
# single ENV string in zsh does NOT work the way it does in bash — the whole
# string arrives as one argument and Maestro reports a missing variable that is
# right there in the command line.

set -u
set -o pipefail

REPO_ROOT="/Users/prashanthhalappa/Documents/Steadily-Nanny/steadily-nanny"
MAESTRO_DIR="${REPO_ROOT}/apps/mobile/.maestro"
ENV_FILE="${REPO_ROOT}/apps/mobile/.env.maestro"
API_BASE="${API_BASE:-http://localhost:8080}"
SIM_UDID="${SIM_UDID:-3DE35533-5F01-4D79-80AC-15CF0DCDFECE}"

# --- simulator prep (2026-08-11) -------------------------------------------
# iOS QuickType's predictive bar sits on top of app buttons near the
# keyboard — invisible to `maestro hierarchy` — and can eat a tap or commit
# a stray suggested word into whatever was just typed (flow 11's "Y").
# Disabling it is a standing simulator setting, not per-flow: re-run this on
# a fresh simulator or after `clearState`.
print "==> disabling iOS QuickType prediction on the simulator"
xcrun simctl spawn "${SIM_UDID}" defaults write com.apple.Preferences KeyboardPrediction -bool false
xcrun simctl spawn "${SIM_UDID}" defaults write com.apple.Preferences KeyboardAutocorrection -bool false
xcrun simctl spawn "${SIM_UDID}" defaults write com.apple.Preferences KeyboardShowPredictionBar -bool false

# A cold Metro bundle can take ~15s to build; reset-to-welcome's wait windows
# are tuned for a warm one and fail as if the app were wedged. Warm it here
# so the first flow isn't the one that pays for the rebuild.
print "==> warming the Metro bundle"
curl -s -o /dev/null --max-time 120 "http://localhost:8081/node_modules/expo-router/entry.bundle?platform=ios&dev=true" || true

# --- credentials ----------------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  print -u2 "missing ${ENV_FILE} — copy .env.maestro.example and fill it in"
  exit 1
fi
set -a
source "${ENV_FILE}"
set +a

: "${PARENT_EMAIL:?PARENT_EMAIL not set in .env.maestro}"
: "${PARENT_PASSWORD:?PARENT_PASSWORD not set in .env.maestro}"
: "${NANNY_EMAIL:?NANNY_EMAIL not set in .env.maestro}"
: "${NANNY_PASSWORD:?NANNY_PASSWORD not set in .env.maestro}"
: "${JOB_API_KEY:?JOB_API_KEY not set in .env.maestro — must match apps/api/.env}"

# Flow 14 signs in as a per-run seeded account whose password is the shared
# test password (scripts/seed-phase4-fixtures.ts's TEST_PASSWORD).
PHASE4_TEST_PASSWORD="${PHASE4_TEST_PASSWORD:-${PARENT_PASSWORD}}"

# --- seed -----------------------------------------------------------------
# The legacy fixtures FIRST, and with --reset: flows 11/12 consume the same
# seed week that flows 02/03/04 do, so a batch run that starts from a week left
# `approved` by the last run fails on a disabled Query button rather than on
# anything under test. `--reset` is idempotent and only touches the seed-owned
# week (2026-01-05) — see that script's module doc.
print "==> resetting legacy E2E fixtures"
bun run "${REPO_ROOT}/scripts/seed-e2e-approval-fixtures.ts" --reset

print "==> seeding Phase 4 fixtures"
SEED_LOG="$(mktemp -t phase4-seed)"
bun run "${REPO_ROOT}/scripts/seed-phase4-fixtures.ts" | tee "${SEED_LOG}"

# The seeder prints its contract as KEY=VALUE lines after a marker; everything
# above the marker is human-readable progress and must not be eval'd.
# Values are quoted before eval: nothing the seeder emits contains a space
# today (uuids, ISO dates, emails, XXX-XXX codes), but an unquoted eval turns
# the day one of them does into a silent truncation rather than an error.
eval "$(sed -n '/^# --- eval me/,$p' "${SEED_LOG}" \
  | grep -E '^PHASE4_[A-Z0-9_]+=' \
  | sed -E 's/^([A-Z0-9_]+)=(.*)$/\1="\2"/')"
rm -f "${SEED_LOG}"

: "${PHASE4_HOUSEHOLD_ID:?seeder did not emit PHASE4_HOUSEHOLD_ID}"
: "${PHASE4_NANNY_ID:?seeder did not emit PHASE4_NANNY_ID}"
: "${PHASE4_TODAY_SHIFT_ID:?seeder did not emit PHASE4_TODAY_SHIFT_ID}"

if [[ -z "${PHASE4_TODAY_SHIFT_ID}" ]]; then
  print -u2 "no today-shift fixture — run scripts/seed-e2e-approval-fixtures.ts TODAY first (flow 08 needs it)"
  exit 1
fi

# --- runner ---------------------------------------------------------------
# `maestro test` is run from the .maestro directory: the MCP server mangles
# absolute flow-file paths, and the flows' own `runFlow: ../flows/...` refs
# resolve relative to the file, so the CLI from this directory is the reliable
# combination.
cd "${MAESTRO_DIR}"

run_flow() {
  local flow="$1"
  shift
  print "\n==> ${flow}"
  if ! maestro test "tests/${flow}" "$@"; then
    print -u2 "\nFAILED: ${flow}"
    exit 1
  fi
}

COMMON=(
  -e "PARENT_EMAIL=${PARENT_EMAIL}"
  -e "PARENT_PASSWORD=${PARENT_PASSWORD}"
  -e "NANNY_EMAIL=${NANNY_EMAIL}"
  -e "NANNY_PASSWORD=${NANNY_PASSWORD}"
  -e "PHASE4_HOUSEHOLD_ID=${PHASE4_HOUSEHOLD_ID}"
  -e "PHASE4_NANNY_ID=${PHASE4_NANNY_ID}"
  -e "PHASE4_PARENT_ID=${PHASE4_PARENT_ID}"
  -e "PHASE4_SEED_WEEK_START=${PHASE4_SEED_WEEK_START}"
  -e "PHASE4_OT_WEEK_START=${PHASE4_OT_WEEK_START}"
  -e "PHASE4_HOLIDAY_WEEK_START=${PHASE4_HOLIDAY_WEEK_START}"
  -e "PHASE4_SUNDAY_HOUSEHOLD_ID=${PHASE4_SUNDAY_HOUSEHOLD_ID}"
  -e "PHASE4_SUNDAY_WEEK_START=${PHASE4_SUNDAY_WEEK_START}"
  -e "PHASE4_ARRANGEMENT_VALID_FROM=${PHASE4_ARRANGEMENT_VALID_FROM}"
  -e "PHASE4_HOURLY_RATE=${PHASE4_HOURLY_RATE}"
  -e "PHASE4_HOLIDAY_MULTIPLIER=${PHASE4_HOLIDAY_MULTIPLIER}"
  -e "PHASE4_TODAY_SHIFT_ID=${PHASE4_TODAY_SHIFT_ID}"
  -e "PHASE4_EXPIRED_ASK_SHIFT_ID=${PHASE4_EXPIRED_ASK_SHIFT_ID}"
  -e "PHASE4_DECLINE_ASK_SHIFT_ID=${PHASE4_DECLINE_ASK_SHIFT_ID}"
  -e "PHASE4_NEW_PARENT_EMAIL=${PHASE4_NEW_PARENT_EMAIL}"
  -e "PHASE4_TEST_PASSWORD=${PHASE4_TEST_PASSWORD}"
  -e "PHASE4_DRAFT_CODE_A=${PHASE4_DRAFT_CODE_A}"
  -e "PHASE4_DRAFT_CODE_B=${PHASE4_DRAFT_CODE_B}"
)

# ORDER IS LOAD-BEARING:
#   07 creates the arrangement 09/11/12 price against, and must run while the
#      seeder's arrangement delete is still in effect.
#   11 approves the seed week; 12 pays and corrects that approved week.
#   13a must precede the expiry curl, 13b must follow it.
run_flow 07-terms-setup-and-ca-ot-week.yaml "${COMMON[@]}"
run_flow 08-sick-timeoff-cancels-shift.yaml "${COMMON[@]}"
run_flow 09-holiday-premium-week.yaml "${COMMON[@]}"
run_flow 10-sunday-workweek-hours.yaml "${COMMON[@]}"
run_flow 11-query-thread-withdraw-approve.yaml "${COMMON[@]}"
run_flow 12-payment-record-correct-export.yaml "${COMMON[@]}"

run_flow 13a-cover-ask-awaiting.yaml "${COMMON[@]}"

print "\n==> expiring cover asks (POST ${API_BASE}/api/jobs/cover-ask-expiry)"
# `jobHandler` fire-and-forgets, so a 2xx is an ACK that the job STARTED, not
# that it finished. `-f` turns a 401 (wrong JOB_API_KEY) into a non-zero exit
# instead of a green run against an unexpired shift.
curl -sS -f -X POST "${API_BASE}/api/jobs/cover-ask-expiry" \
  -H "X-Job-Api-Key: ${JOB_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{}'
print ""
sleep 5

run_flow 13b-cover-ask-expired-declined.yaml "${COMMON[@]}"
run_flow 14-onboarding-nanny-first.yaml "${COMMON[@]}"
run_flow 15-onboarding-absorption.yaml "${COMMON[@]}"

print "\nAll Phase 4 flows passed. Screenshots: ${MAESTRO_DIR}/screenshots"
print "no-show during quiet hours is covered at the job level — see tests/NO-SHOW-QUIET-HOURS.md"
