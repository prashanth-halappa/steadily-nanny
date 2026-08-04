#!/usr/bin/env bash
# One-file-per-process runner for root scripts/*.test.ts and scripts/__tests__/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  bun test "$f" || exit 1
done < <(
  find scripts -type f -name '*.test.ts' | sort -u
)
