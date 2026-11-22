#!/usr/bin/env bash
# Delete every row from every app table in the D1 database, keeping the schema
# and d1_migrations. sqlite_* and _cf_* internals are left alone.
#
#   scripts/wipe-d1.sh --local
#   scripts/wipe-d1.sh --remote --yes-wipe-remote   # PRODUCTION — irreversible
#
# No trigger in migrations/0001_triggers.sql fires on DELETE, and
# `PRAGMA defer_foreign_keys = on` defers FK checks to the end of the batch,
# so table order does not matter (ON DELETE cascades still run, harmlessly).
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

case "${1:-}" in
  --local) ;;
  --remote)
    if [ "${2:-}" != "--yes-wipe-remote" ]; then
      echo "refusing: --remote wipes PRODUCTION; add --yes-wipe-remote" >&2
      exit 1
    fi
    ;;
  *) echo "usage: $0 --local | --remote --yes-wipe-remote" >&2; exit 2 ;;
esac
TARGET="$1"

d1() { bunx wrangler d1 execute steadily-nanny "$TARGET" --json "$@"; }

TABLES=$(d1 --command "select name from sqlite_master where type='table' \
  and name not like 'sqlite_%' and name not like '_cf_%' and name <> 'd1_migrations' order by name" \
  | bun -e 'const r = JSON.parse(await Bun.stdin.text()); for (const t of r[0].results) console.log(t.name)')

SQL=$(mktemp -t wipe-d1).sql
trap 'rm -f "$SQL"' EXIT
{
  echo "PRAGMA defer_foreign_keys = on;"
  for t in $TABLES; do echo "DELETE FROM \"$t\";"; done
} > "$SQL"

echo "wiping $(echo "$TABLES" | wc -l | tr -d ' ') tables ($TARGET)"
d1 --file "$SQL" > /dev/null

# Verify: every table must now be empty. One row of scalar subqueries — D1
# caps compound SELECTs far below 43 UNION ALL terms.
COUNTS=$(for t in $TABLES; do printf '(select count(*) from "%s") as "%s", ' "$t" "$t"; done)
d1 --command "select ${COUNTS%, }" \
  | bun -e 'const row = JSON.parse(await Bun.stdin.text())[0].results[0]; const bad = Object.entries(row).filter(([, n]) => n !== 0); for (const [t, n] of Object.entries(row)) console.log(`${t}\t${n}`); if (bad.length) { console.error(`NOT EMPTY: ${bad.map(([t]) => t).join(", ")}`); process.exit(1); } console.log(`all ${Object.keys(row).length} tables empty`)'
