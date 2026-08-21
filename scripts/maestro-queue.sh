#!/usr/bin/env bash
# Run an ordered queue of Maestro flows, one at a time, each under
# scripts/maestro-run.sh's watchdogs.
#
# WHY A QUEUE FILE
# Flow validation is serial — there is exactly one simulator — but the thing
# watching it must not be. A queue file plus progress.tsv means a watcher can
# tell "still working" from "wedged" by reading two small files, and a killed
# run can resume from the next unrun line instead of starting over.
#
# A flow that FAILS does not stop the queue: it is recorded and the queue moves
# on. Stopping would mean one broken screen costs every scenario behind it. A
# flow that STALLS (exit 124) is retried exactly once, on the theory that a
# wedged driver is usually transient — and if it stalls twice it is skipped and
# recorded as STALLED, never as a pass and never as an app defect.
#
# Queue file format: one flow path per line, relative to apps/mobile/.maestro.
# Blank lines and #-comments ignored. Optional per-line env overrides after a
# space, e.g.:
#   tests/26-parent-first-onboarding.yaml -e S1_EMAIL=x@y.test
#
# Usage:
#   SP=/abs/scratch OUT=/abs/caps/S1 scripts/maestro-queue.sh queue-s1.txt
set -uo pipefail

QUEUE="${1:?queue file required}"
: "${SP:?SP (scratch root) must be set}"
: "${OUT:?OUT (screenshot dir) must be set}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$OUT" "$SP/maestro"
STATUS="$SP/maestro/queue-status.txt"

echo "queue: $QUEUE  ->  $OUT" | tee -a "$STATUS"

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%$'\r'}"
  [ -z "${line// /}" ] && continue
  case "$line" in \#*) continue ;; esac

  # shellcheck disable=SC2086 -- per-line extra args are intentionally split
  set -- $line
  flow="$1"; shift
  extra=("$@")

  attempt=1
  while [ "$attempt" -le 2 ]; do
    SP="$SP" CAP="${CAP:-480}" STALL="${STALL:-150}" \
      bash "$REPO/scripts/maestro-run.sh" "$flow" -e "OUT=$OUT" ${extra[@]+"${extra[@]}"}
    code=$?
    # Only a STALL is worth a second attempt. A genuine assertion failure will
    # fail again identically, and re-running destroys the failure hierarchy
    # that diagnosing it depends on.
    if [ "$code" -eq 124 ] && [ "$attempt" -eq 1 ]; then
      echo "  stalled — recovering and retrying once" | tee -a "$STATUS"
      pkill -KILL -f "maestro.cli" 2>/dev/null
      SP="$SP" CAP=240 STALL=120 \
        bash "$REPO/scripts/maestro-run.sh" flows/reset-to-welcome.yaml >/dev/null 2>&1
      attempt=$((attempt + 1))
      continue
    fi
    break
  done
done < "$QUEUE"

echo "QUEUE COMPLETE: $QUEUE" | tee -a "$STATUS"
