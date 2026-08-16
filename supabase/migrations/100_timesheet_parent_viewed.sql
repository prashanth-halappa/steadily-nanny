-- ---------------------------------------------------------------------------
-- 100_timesheet_parent_viewed.sql — one-way receipt that a parent opened
-- this week in the app (CX stream U2)
--
-- NOT YET APPLIED TO PROD. Apply via the Supabase MCP `apply_migration` in
-- order after 099 — never `supabase db push` (version-scheme mismatch; see
-- 092's header and the note in docs/ROLLBACK-RUNBOOK.md).
--
-- Wire: packages/shared-types/src/schemas/timesheet.schema.ts
--         (`TimesheetSchema.parent_viewed_at`)
-- Write: apps/api/src/domains/timesheet/services/timesheetCommandService.ts
--          (`markParentViewed` — parents only, submitted/queried only)
--        apps/api/src/domains/timesheet/repositories/timesheetRepository.ts
--          (`stampParentViewed` — `.is('parent_viewed_at', null)`)
-- Read:  the nanny Hours screen (`WeekTotal` status timeline)
--
-- =========================================================================
-- THE GAP
-- =========================================================================
--
-- The nanny can already see when a family opened the terms she sent
-- (`terms_proposals.viewed_at`, 092). She cannot see whether anyone opened
-- THE HOURS HER RENT DEPENDS ON: her week just reads "With the family"
-- whether that has been five minutes or five days. This column is the
-- matching receipt: WHETHER a parent opened this week in the app, never how
-- many times. One-way: set once, never cleared. Mirrors 092.
--
-- =========================================================================
-- THE HAZARD — DO NOT TRIP
-- =========================================================================
--
-- `approveSubmittedWithEarnings` compare-and-swaps on `updated_at`
-- (`.eq('status', 'submitted').eq('updated_at', expectedUpdatedAt)`). The
-- shared `public.set_updated_at()` (001, used by 16 tables) stamps `now()`
-- on EVERY update. NEVER edit that function: a viewed-only write that
-- bumped `updated_at` would invalidate an in-flight approve and the
-- parent's tap would fail.
--
-- So `timesheets` gets its OWN trigger function. A write whose ONLY changed
-- column is `parent_viewed_at` preserves `OLD.updated_at`. Every other
-- write — including a roll-up that rewrites identical values, which
-- `timesheetRepository.ts:218-221` relies on — still bumps.
--
-- See GOLDEN-FIXES.md ("A receipt column on a compare-and-swap row needs
-- its own updated_at trigger") and docs/ROLLBACK-RUNBOOK.md.
-- ---------------------------------------------------------------------------

alter table public.timesheets add column if not exists parent_viewed_at timestamptz;
comment on column public.timesheets.parent_viewed_at is
  'WHETHER a parent opened this week in the app, never how many times. One-way: set once, never cleared. Mirrors terms_proposals.viewed_at (092). A write touching ONLY this column must not bump updated_at, because approve() compare-and-swaps on updated_at — see the trigger below and GOLDEN-FIXES.';
create or replace function public.set_timesheets_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.parent_viewed_at is distinct from old.parent_viewed_at
     and (to_jsonb(new) - 'parent_viewed_at' - 'updated_at')
       = (to_jsonb(old) - 'parent_viewed_at' - 'updated_at') then
    new.updated_at = old.updated_at;   -- a receipt is not a new row version
    return new;
  end if;
  new.updated_at = now();
  return new;
end; $$;
drop trigger if exists set_timesheets_updated_at on public.timesheets;
create trigger set_timesheets_updated_at before update on public.timesheets
  for each row execute function public.set_timesheets_updated_at();
