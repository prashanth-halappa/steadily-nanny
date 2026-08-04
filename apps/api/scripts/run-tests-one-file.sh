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
  # ponytail: .test.tsx is not matched — every caller of this script (api,
  # shared-types) is TS-only today, so this is a silent skip waiting to
  # happen the day one of them grows a .tsx test. Add `-o -name '*.test.tsx'`
  # if/when that happens.
  find "$root" -type f \( -name '*.test.ts' -o -name '*.integration.test.ts' \) | sort -u
)
