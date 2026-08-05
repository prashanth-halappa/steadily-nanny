#!/usr/bin/env bash
# Generate in-app illustrations via Higgsfield (run from repo root).
set -euo pipefail
REF="/Users/prashanthhalappa/Documents/Steadily-Nanny/steadily-nanny/apps/mobile/assets/_staging/icon-source.png"
OUT="/Users/prashanthhalappa/Documents/Steadily-Nanny/steadily-nanny/apps/mobile/assets/illustrations"
STYLE="Soft flat vector illustration matching attached reference icon style. Plum purple #5B3E5D and apricot #E8823C accents. Warm domestic, minimal, no text, transparent background."

gen() {
  local name="$1"
  local prompt="$2"
  echo "=== $name ==="
  local url
  url=$(higgsfield generate create gpt_image_2 \
    --prompt "$prompt $STYLE" \
    --image "$REF" \
    --aspect_ratio 1:1 \
    --resolution 2k \
    --wait --wait-timeout 15m 2>&1 | tail -1)
  curl -fsSL "$url" -o "$OUT/_staging-$name.png"
  sips -z 480 480 "$OUT/_staging-$name.png" --out "$OUT/$name.png"
  rm -f "$OUT/_staging-$name.png"
}

gen "welcome-hero" "Parent and nanny silhouettes beside a cozy home and weekly calendar."
gen "onboarding-role" "Two friendly abstract figures choosing paths, parent and caregiver roles."
gen "empty-schedule" "Empty weekly calendar with a gentle clock motif."
gen "empty-inbox" "Inbox tray with a checkmark, all caught up feeling."
gen "empty-hours" "Clock and hourglass representing tracked work hours."
gen "empty-pay" "Handshake and coins representing pay arrangement."
gen "empty-time-off" "Calendar with a blocked day off."
gen "empty-household" "Cozy home with an open door, inviting."
gen "empty-today" "Sunrise over a teacup, peaceful day off."
gen "empty-no-carer" "Envelope invite for a nanny to join."
gen "empty-children" "Building blocks representing children profiles."
gen "empty-pending" "Hourglass waiting for schedule approval."

echo "All illustrations generated."
