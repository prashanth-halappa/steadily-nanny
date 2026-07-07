#!/usr/bin/env bash
# Run each matching test file in a SEPARATE bun process so mock.module('ai', …)
# and similar hooks do not leak between files (bun:test isolation gotcha).
set -euo pipefail

root="${1:?test root directory (e.g. tests/unit)}"

[[ -d "$root" ]] || exit 0

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  bun test "$f" || exit 1
done < <(
  find "$root" -type f \( -name '*.test.ts' -o -name '*.integration.test.ts' \) | sort -u
)
