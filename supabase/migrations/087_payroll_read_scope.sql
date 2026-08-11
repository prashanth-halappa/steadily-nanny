-- 087 Payroll read scope — hours stop being a household-wide fact (D-21, P4/P8)
--
-- `timesheets` and `time_entries` have read policies from 017, rewritten by
-- 018 and repointed by 040, that use `private.can_read_household` — which is
-- `is_household_member`: ANY active member, ANY role. Since 042, a
-- `timesheets` row carries `gross_minor` and the frozen `earnings` snapshot.
-- So today a HELPER — someone brought in to do the school run — and a SECOND
-- NANNY can both read another carer's pay for the week, and `time_entries`
-- gives them her exact clock-in times, break lengths and shift notes on top.
-- The client narrows the view; the door does not.
--
-- Every OTHER money table in this schema already refuses that: 041
-- (pay_arrangements), 043 (pto_ledger), 044 (expenses) and 067 (payments) all
-- read as `can_write_household(household_id) or carer_id = auth.uid()` —
-- parents and the carer herself, nobody else. 041's header states the rule
-- these two tables were the exception to: "PostgREST is a real door: a policy
-- looser than the service is not 'belt and braces', it is the hole the service
-- was written to close." 087 removes the exception.
--
-- WHY THIS IS A PRIVACY BUSTER AND NOT A TIDY-UP. One screenshot of another
-- nanny's weekly gross, posted in a nanny Facebook group, is an extinction
-- event for a product whose entire proposition is that both sides trust the
-- record (§5 D-21). The helper case is worse than the second-nanny case: she
-- never had a money surface to lose.
--
-- THE SERVICE MOVES IN THE SAME COMMIT. `timesheetQueryService`'s
-- `assertPayrollReader` granted household scope to any ACTIVE member before
-- checking the role at all; it now resolves by ROLE first, status second —
-- owner/parent read everything, a nanny reads only her own rows (FORCED, not
-- offered), a helper reads nothing. Repositories run as the service role and
-- bypass RLS entirely, so the service is the check and this policy is the
-- backstop (`docs/11-MONEY.md` §8/§9) — but a backstop that is WIDER than the
-- check is the door, which is the whole reason both halves land together.
--
-- WHAT THE CARER SELF-ARM STILL BUYS. `carer_id = auth.uid()` is
-- membership-independent by design, exactly as in 067 and 044: a nanny who has
-- left keeps reading the hours she worked and the weeks she was owed for.
-- Payroll is an audit trail, not a live surface that disappears with the
-- badge. That arm is what makes narrowing the first arm safe.
--
-- 040 TRAP 2: the helper is called BARE, never `(select
-- private.can_write_household(...))` — it takes a per-row `household_id` and
-- cannot be an initplan. 018's `(select auth.uid())` form is kept on the carer
-- arm, where it IS an initplan. Both are reproduced verbatim from 067.
--
-- ---------------------------------------------------------------------------
-- P9 — the dead enum values: DOCUMENTED, deliberately not dropped
-- ---------------------------------------------------------------------------
--
-- `timesheets.status` declares 'open' and `time_entries.status` declares
-- 'approved' and 'queried'. Nothing writes any of the three: a week is born
-- 'submitted' by the clock-out roll-up (there is no carer submit step — an
-- explicit submit model was considered and declined, `timesheet.schema.ts`),
-- and sign-off is a WEEK-level fact carried on `timesheets`, never per entry.
--
-- Dropping them is not one line and is not free. 'open' is `timesheets.status`'
-- column DEFAULT as well as a CHECK member, so removing it means changing the
-- default, dropping and recreating the constraint, and narrowing
-- `TIMESHEET_STATUSES` — which SHIPPED CLIENTS still read: mobile's
-- `widgetSnapshot.ts` treats 'open' as "no week yet" and uses it as its
-- `??` fallback tone, and `ParentWeekView` branches on it. Narrowing a wire
-- enum under clients already in the field is the fleet risk §2.5 exists to
-- prevent, and it buys nothing: an unwritten value costs no storage and no
-- correctness. Same reasoning for the two on `time_entries`, whose CHECK 069
-- has already had to drop and recreate once.
--
-- So they are documented AT THE COLUMN, where `\d+` and every schema browser
-- will show it, rather than left as a silent oddity a future reader has to
-- audit the whole write path to explain. Revisit only if a status enum ever
-- becomes a real Postgres enum type.

-- ---------------------------------------------------------------------------
-- The policies
-- ---------------------------------------------------------------------------

drop policy if exists "Members can view time entries" on public.time_entries;
create policy "Parents and the carer can view time entries"
  on public.time_entries
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );

drop policy if exists "Members can view timesheets" on public.timesheets;
create policy "Parents and the carer can view timesheets"
  on public.timesheets
  for select using (
    private.can_write_household(household_id) or carer_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- P9 — the documentation, at the column
-- ---------------------------------------------------------------------------

comment on column public.timesheets.status is
  'submitted | approved | queried. ''open'' is dead — it is 017''s column default and no code path ever writes it (the week is born ''submitted'' by the clock-out roll-up; there is deliberately no carer submit step). Kept in the CHECK because shipped clients still read it; see 087''s header.';

comment on column public.time_entries.status is
  'running | submitted | voided. ''approved'' and ''queried'' are dead — sign-off is a week-level fact on public.timesheets, never per entry, and nothing writes either value here. Kept in the CHECK because shipped clients still read the enum; see 087''s header.';
