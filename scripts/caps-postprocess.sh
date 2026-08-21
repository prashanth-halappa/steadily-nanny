#!/usr/bin/env bash
# Post-process a directory of Maestro screenshots for review and embedding.
#
# Two jobs, both of which exist because of measured failures:
#
# 1. DEDUPE. The capture flow scrolls a fixed number of times; once a list
#    bottoms out, every later slice is byte-identical to the last. A previous
#    run shipped `*-b`, `*-c` and `*-d-bottom` at 479527 bytes each — three
#    copies of one screen, which inflates a review and invites a persona to
#    "notice" something three times. Identical files are removed, and what was
#    removed is printed rather than silently dropped.
#
# 2. WEB SIZE. An Artifact page is capped at 16MB and every image is inlined as
#    base64 (~1.37x). Full-res sim PNGs are ~500KB each, so a 150-screen review
#    would not fit. Downscale + JPEG, and print the projected inlined total so
#    the cap is measured rather than assumed.
#
# Usage: scripts/caps-postprocess.sh <caps-dir> [web-width]
set -euo pipefail

DIR="${1:?caps directory required}"
WIDTH="${2:-620}"
WEB="$DIR/web"
mkdir -p "$WEB"

echo "== dedupe: $DIR =="
declare -a seen_hash=()
declare -a seen_name=()
removed=0
# Sorted so the SURVIVING copy is the earliest slice (…-a-top before …-d-bottom),
# which is the one whose name honestly describes what it shows.
while IFS= read -r f; do
  h="$(md5 -q "$f")"
  dup=""
  for i in "${!seen_hash[@]}"; do
    if [ "${seen_hash[$i]}" = "$h" ]; then dup="${seen_name[$i]}"; break; fi
  done
  if [ -n "$dup" ]; then
    echo "  drop $(basename "$f")  (identical to $(basename "$dup"))"
    rm -f "$f"
    removed=$((removed + 1))
  else
    seen_hash+=("$h")
    seen_name+=("$f")
  fi
done < <(find "$DIR" -maxdepth 1 -name '*.png' | sort)
echo "  removed $removed duplicate(s), $(find "$DIR" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ') unique remain"

echo "== web conversion (${WIDTH}px wide, jpeg) =="
rm -f "$WEB"/*.jpg 2>/dev/null || true
for f in "$DIR"/*.png; do
  [ -e "$f" ] || continue
  base="$(basename "$f" .png)"
  sips -Z "$WIDTH" -s format jpeg -s formatOptions 72 "$f" --out "$WEB/${base}.jpg" >/dev/null 2>&1
done

count=$(find "$WEB" -name '*.jpg' | wc -l | tr -d ' ')
bytes=$(find "$WEB" -name '*.jpg' -exec stat -f %z {} \; | awk '{s+=$1} END {print s+0}')
inlined=$(echo "$bytes" | awk '{printf "%.2f", $1 * 1.37 / 1048576}')
echo "  $count jpg, $(echo "$bytes" | awk '{printf "%.2f", $1/1048576}') MB on disk"
echo "  projected inlined (base64, x1.37): ${inlined} MB  [Artifact cap is 16 MB]"
