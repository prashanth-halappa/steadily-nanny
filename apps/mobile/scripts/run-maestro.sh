#!/usr/bin/env bash
# Load apps/mobile/.env.maestro into `maestro test -e KEY=VALUE` flags.
# Maestro 2.x has no --env-file; this is the docs/09-TESTING.md harness.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

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
