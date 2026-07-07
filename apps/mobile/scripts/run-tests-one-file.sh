#!/usr/bin/env bash
# Run each matching test file in a separate bun process so mock.module(...)
# and similar hooks do not leak between files.
#
# Each file is wrapped in an OS-level watchdog: a test that hangs at module-load
# (e.g. an animation timer that never settles under Bun) would otherwise wedge
# the whole gate forever. Bun's `--timeout` is per-*test* and cannot catch an
# import-time hang, and macOS ships no `timeout`/`gtimeout`, so we background the
# run and kill it after PER_FILE_TIMEOUT seconds. A timeout is treated as a
# failure (the file names itself in the output).
set -euo pipefail

root="${1:-src}"
PER_FILE_TIMEOUT="${PER_FILE_TIMEOUT:-60}"

while IFS= read -r f; do
  [[ -n "$f" ]] || continue

  bun test "$f" &
  pid=$!
  ( sleep "$PER_FILE_TIMEOUT"; kill -9 "$pid" 2>/dev/null ) &
  watcher=$!

  if wait "$pid" 2>/dev/null; then
    kill -9 "$watcher" 2>/dev/null || true
  else
    rc=$?
    kill -9 "$watcher" 2>/dev/null || true
    if [[ "$rc" -eq 137 ]]; then
      echo "TIMEOUT (>${PER_FILE_TIMEOUT}s, likely a module-load hang): $f" >&2
    fi
    exit 1
  fi
done < <(
  find "$root" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | sort -u
)
