#!/usr/bin/env bash
# ============================================================================
# Apply Supabase migrations (template wrapper around the Supabase CLI).
# ============================================================================
# Usage:
#   bun run db:migrate            # push all migrations to the linked project
#   bun run db:migrate up         # apply pending migrations only
#   bun run db:migrate local      # apply to the local dev stack
#
# Prereqs:
#   - Supabase CLI installed (https://supabase.com/docs/guides/cli).
#   - `supabase link --project-ref <ref>` run once (remote), OR
#     `supabase start` running (local).
#   - Migrations live in ../../supabase/migrations (repo root supabase/).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Error: supabase CLI not found. Install it: https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

MODE="${1:-push}"
case "$MODE" in
  push)  supabase db push ;;                 # push local migrations to linked remote
  up)    supabase migration up ;;            # apply pending (uses linked/local per config)
  local) supabase migration up --local ;;    # apply to the local dev database
  *)     echo "Unknown mode '$MODE' (use: push | up | local)" >&2; exit 1 ;;
esac
