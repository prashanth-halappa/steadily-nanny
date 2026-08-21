#!/usr/bin/env bash
# Run ONE Maestro flow under two independent watchdogs, and record the verdict.
#
# WHY
# A wedged Maestro session does not fail — it sits there. Overnight that costs
# the whole run, and it has happened here before. Every flow therefore goes
# through this wrapper; `maestro test` is never invoked directly.
#
# Two caps, because they catch different hangs:
#   STALL — the log stops growing (driver lost the device, XCUITest wedged,
#           an unanswered system alert). Default 120s.
#   CAP   — total wall clock, for a flow that is "productively" looping.
#           Default 420s.
# Either one fires SIGTERM, then SIGKILL, and the run exits 124.
#
# 124 means STALLED. It is never a pass, and it is never an app defect —
# it is a harness failure and must be reported as one.
#
# Appends one line to $PROGRESS: flow<TAB>started<TAB>ended<TAB>exit
# That file, not a transcript, is the ground truth a watcher reads.
#
# Usage:
#   scripts/maestro-run.sh tests/01-sign-in-parent.yaml [extra maestro args...]
#   CAP=900 STALL=180 scripts/maestro-run.sh tests/07-terms-setup-and-ca-ot-week.yaml
#
# Env:
#   SP        scratch root (required) — logs and progress.tsv live under it
#   CAP       total seconds (default 420)
#   STALL     no-log-growth seconds (default 120)
#   ENV_FILE  .env.maestro path (default apps/mobile/.env.maestro)
set -uo pipefail

FLOW="${1:?flow path required, relative to apps/mobile/.maestro}"
shift || true

: "${SP:?SP (scratch root) must be set}"
CAP="${CAP:-420}"
STALL="${STALL:-120}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MAESTRO_DIR="$REPO/apps/mobile/.maestro"
ENV_FILE="${ENV_FILE:-$REPO/apps/mobile/.env.maestro}"
PROGRESS="$SP/maestro/progress.tsv"
mkdir -p "$SP/maestro/logs"

SLUG="$(basename "$FLOW" .yaml)"
LOG="$SP/maestro/logs/${SLUG}.log"
: > "$LOG"

# .env.maestro -> one -e flag per pair. Never a single word-split string: in
# zsh that collapses into one argument and every value arrives as "undefined".
ENV_ARGS=()
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [ -z "$trimmed" ] && continue
    case "$trimmed" in \#*) continue ;; esac
    key="${trimmed%%=*}"
    value="${trimmed#*=}"
    key="$(echo "$key" | xargs)"
    [ -z "$key" ] && continue
    ENV_ARGS+=(-e "${key}=${value}")
  done < "$ENV_FILE"
else
  echo "warn: $ENV_FILE missing — running with no -e flags" >&2
fi

cd "$MAESTRO_DIR"

STARTED="$(date '+%H:%M:%S')"
START_EPOCH="$(date +%s)"

maestro test "$FLOW" "${ENV_ARGS[@]}" "$@" >> "$LOG" 2>&1 &
MPID=$!

# Watchdog. Polls every 10s; the log's byte count is the liveness signal.
(
  last_size=-1
  last_change="$START_EPOCH"
  while kill -0 "$MPID" 2>/dev/null; do
    sleep 10
    now="$(date +%s)"
    size="$(wc -c < "$LOG" 2>/dev/null || echo 0)"
    if [ "$size" != "$last_size" ]; then
      last_size="$size"
      last_change="$now"
    fi
    reason=""
    [ $((now - last_change)) -ge "$STALL" ] && reason="STALL (${STALL}s without log growth)"
    [ $((now - START_EPOCH)) -ge "$CAP" ] && reason="CAP (${CAP}s total)"
    if [ -n "$reason" ]; then
      echo "" >> "$LOG"
      echo "WATCHDOG-KILL: $reason" >> "$LOG"
      kill -TERM "$MPID" 2>/dev/null
      sleep 10
      kill -KILL "$MPID" 2>/dev/null
      # The `maestro` CLI is a launcher; the JVM it exec's does not die with
      # it. Only ever one flow runs at a time here, so a broad sweep is safe.
      # ponytail: pattern-matched sweep, upgrade to a process group if this
      # wrapper is ever used concurrently.
      pkill -KILL -f "maestro.cli" 2>/dev/null
      exit 0
    fi
  done
) &
WPID=$!

wait "$MPID"
CODE=$?
kill "$WPID" 2>/dev/null
wait "$WPID" 2>/dev/null

# A watchdog kill surfaces as 143/137 from `wait`; the marker is what makes it
# unambiguous, so trust the marker over the number.
if grep -q "^WATCHDOG-KILL:" "$LOG"; then
  CODE=124
fi

# DRIVER CRASH, not an app defect. The XCUITest driver 500s with
# `kAXErrorInvalidUIElement` when the accessibility element it is mid-query on
# disappears — typically because the app relaunched underneath it. Maestro then
# dies with `Exception in thread "main" UnknownFailure`, which is indistinguishable
# from an assertion failure in the exit code alone. Classify it as 125 so it is
# never written up as a product bug, and so the queue can retry it.
if grep -qE "Exception in thread \"main\" UnknownFailure|kAXErrorInvalidUIElement" "$LOG"; then
  CODE=125
fi

ENDED="$(date '+%H:%M:%S')"
printf '%s\t%s\t%s\t%s\n' "$SLUG" "$STARTED" "$ENDED" "$CODE" >> "$PROGRESS"

case "$CODE" in
  0)   echo "PASS    $SLUG  ($STARTED->$ENDED)" ;;
  124) echo "STALLED $SLUG  ($STARTED->$ENDED)  harness failure, not an app defect — see $LOG" ;;
  125) echo "DRIVER-CRASH $SLUG  ($STARTED->$ENDED)  harness failure, not an app defect — see $LOG" ;;
  *)   echo "FAIL    $SLUG  ($STARTED->$ENDED)  exit=$CODE — see $LOG" ;;
esac
exit "$CODE"
