# S2 gap rows that cannot be written

`docs/LAUNCH-MANUAL-PASS-MAESTRO.md` §4's S2 table lists three gaps under
`approval_mode: 'ask_other'` — co-parent asked and approves, co-parent
declines, and nobody answers so `approval_timeout_minutes` sends it anyway.
None of these are writable: the mode does not exist any more.

## Evidence

`supabase/migrations/072_remove_ask_other.sql` (2026-08-09, "product decision"
per its own header comment):

- Line 17-19 — every household still on `ask_other` was migrated to `either`
  server-side, one time, as part of applying this migration.
- Line 23-28 — `households_approval_mode_check` was dropped and recreated as
  `check (approval_mode in ('either', 'owner_only'))`. `ask_other` is not a
  legal value in the column any more; inserting or updating a row to that
  value now fails the CHECK constraint at the database.
- Line 31-32 — `approval_timeout_minutes` was dropped from `households`
  entirely: `alter table public.households drop column
  approval_timeout_minutes;`. There is no column left to seed a low value
  into for a timeout-arm flow, which is exactly what
  `LAUNCH-MANUAL-PASS-MAESTRO.md` §4 tells the driver to do ("set
  `approval_timeout_minutes` low via SQL").

`packages/shared-types/src/schemas/household.schema.ts:53-57` — the client
and server's shared source of truth for the enum:

```ts
export const HOUSEHOLD_APPROVAL_MODES = {
  EITHER: 'either',
  OWNER_ONLY: 'owner_only',
} as const;
```

Two members. `ask_other` is not one of them, so nothing in either app can
even construct a request that asks for it — the mobile approval-mode picker
(`ManageHouseholdScreen.tsx`'s `APPROVAL_MODE_OPTIONS`) only offers these two
chips, and the server's Zod schema (`household.schema.ts:256,306,337`) would
reject `ask_other` as an invalid enum value before it ever reached a query.

## What this means for the driver guide

The three `ask_other` rows in §4's S2 table describe a mode that was
deliberately deleted six months before this pass. They are not gaps in test
coverage — there is no product behaviour left to cover. Recommend removing
those three rows from the table (or replacing them with a note pointing at
this file) rather than carrying them forward as open work.

The two modes that DO still exist — `either` (the default; both parents can
act) and `owner_only` (only the owner can) — are exercised by
`29-owner-only-refuses-coparent.yaml` (`owner_only` refuses a co-parent,
legibly) to the extent current fixtures allow; see that flow's own header for
the co-parent-membership precondition it depends on and does not create.
