#!/usr/bin/env bash
# Load apps/mobile/.env.maestro into `maestro test -e KEY=VALUE` flags.
# Maestro 2.x has no --env-file; this is the docs/09-TESTING.md harness.
set -euo pipefail

disable_ios_quicktype() {
  # iOS QuickType's predictive bar sits on top of app buttons near the
  # keyboard — invisible to `maestro hierarchy` — and can eat a tap or commit
  # a stray suggested word into whatever was just typed (flow 11's "Y").
  # Same standing simulator setting as run-phase4.sh; best-effort so a missing
  # booted sim does not abort the run. Takes effect after Keyboard.app restarts.
  if ! xcrun simctl list devices 2>/dev/null | grep -q '(Booted)'; then
    echo "warn: no booted simulator — skipping QuickType disable" >&2
    return 0
  fi
  local key
  for key in KeyboardPrediction KeyboardAutocorrection KeyboardShowPredictionBar; do
    xcrun simctl spawn booted defaults write com.apple.Preferences "${key}" -bool false 2>/dev/null \
      || echo "warn: defaults write ${key} failed (continuing)" >&2
  done
}

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

disable_ios_quicktype

env_file="${MAESTRO_ENV_FILE:-.env.maestro}"
config=".maestro/config.yaml"

env_args=()
if [[ -f "$env_file" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
    key="${trimmed%%=*}"
    value="${trimmed#*=}"
    key="$(echo "$key" | xargs)"
    if [[ ( "$value" == \"*\" && "$value" == *\" ) || ( "$value" == \'*\' && "$value" == *\' ) ]]; then
      value="${value:1:${#value}-2}"
    fi
    env_args+=(-e "${key}=${value}")
  done < "$env_file"
else
  echo "warn: $env_file missing — copy .env.maestro.example → .env.maestro" >&2
fi

if [[ $# -eq 0 ]]; then
  set -- .maestro/tests
fi

exec maestro test --config "$config" "${env_args[@]}" "$@"
