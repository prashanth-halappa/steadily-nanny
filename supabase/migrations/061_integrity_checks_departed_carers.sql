-- 061 Integrity checks see departed carers
--
-- WHY THIS IS A SEPARATE MIGRATION AND NOT AN EDIT TO 056
-- 056 must keep parsing on a database that has only reached 056 — and
-- `household_member_id` does not exist until 058. Naming the column in 056's
-- body would break the migration chain for anyone replaying it in order,
-- which is exactly what Lane G's CI reset does. So 056 stays as written and
-- this replaces the function once the column is there.
--
-- WHAT WAS BLIND
-- 033 nulls `carer_id` on both `time_entries` and `timesheets` when a carer
-- deletes her account, keeping `carer_display_name` so the row stays legible.
-- 056's carer-grouped checks therefore had to filter `carer_id is not null`:
-- the only remaining join key was the display name, and two carers called
-- Emma in one household would have reported as a permanent mismatch —
-- monitoring that cries wolf until someone mutes it. The cost was that a
-- departed carer's weeks became permanently invisible to
-- `timesheet_total_mismatch` and `orphan_week`, which is precisely where an
-- unnoticed wrong total is most likely to sit: nobody is logging in to
-- notice it any more.
--
-- 058 stamps `household_member_id` on insert and backfills it, and it is NOT
-- nulled by the deletion (the FK is `on delete set null` on `carer_id`, and
-- the stamping trigger is INSERT-only). So it is identity that outlives the
-- account, and the key becomes:
--   coalesce(carer_id::text, household_member_id::text)
-- cast to text because the two columns are separate uuid columns, not because
-- the values need it — the coalesce needs one type and either half may be
-- null. Both sides of the entry-to-timesheet join use the SAME expression; if
-- they ever diverge the join matches nothing and every week reports as
-- orphaned.
--
-- STILL EXCLUDED: rows with NEITHER key. Those are pre-058 departures, whose
-- memberships were already gone by the time the backfill ran, so nothing can
-- reconstruct their identity and grouping them by display name would
-- reintroduce the two-Emmas false positive. Accepted and forward-only, as
-- Lane C's C1 note says.
--
-- Everything else is 056 verbatim: same eight checks, same minutes formula
-- (still the twin of `computeWorkedMinutes` plus C7's coalesce), same
-- security invoker, same revoke/grant. A CREATE OR REPLACE drops whatever it
-- omits, so the whole body is restated rather than patched.

create or replace function public.run_integrity_checks()
returns table (check_name text, entity_id uuid, details jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  with entry_minutes as (
    select
      te.id,
      te.household_id,
      te.carer_id,
      coalesce(te.carer_id::text, te.household_member_id::text) as carer_key,
      date_trunc('week', te.local_date)::date as week_start,
      case
        -- Clamp OUTSIDE the coalesce, not around `scheduled_minutes`: 017
        -- declares that column with no non-negative CHECK, and Postgres
        -- GREATEST ignores nulls, so `coalesce(greatest(0, scheduled), span)`
        -- would return 0 for a legacy null instead of falling back to the
        -- span. This shape is the twin of the TS `Math.max(0, scheduled ??
        -- span)`; the span arm is already floored, so the outer clamp only
        -- bites a negative stored value.
        when te.kind = 'cancellation_paid'
          then greatest(0, coalesce(te.scheduled_minutes, greatest(0, round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60) - te.break_minutes)))
        else greatest(0, round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60) - te.break_minutes)
      end as minutes
    from public.time_entries te
    where te.clock_in_at is not null
      and te.clock_out_at is not null
      and (te.carer_id is not null or te.household_member_id is not null)
  ),
  week_minutes as (
    select
      em.household_id,
      em.carer_key,
      em.week_start,
      sum(em.minutes) as total
    from entry_minutes em
    group by em.household_id, em.carer_key, em.week_start
  )

  -- 1. The banked total disagrees with the entries it is derived from (I-02,
  --    I-03). `rollUpIntoTimesheet` recomputes this from scratch on every
  --    write, so a mismatch means a roll-up that never ran — a crash between
  --    the entry write and the roll-up, or an entry corrected out of band.
  select
    'timesheet_total_mismatch'::text,
    ts.id,
    jsonb_build_object(
      'household_id', ts.household_id,
      'week_start', ts.week_start,
      'stored_minutes', ts.total_minutes,
      'derived_minutes', coalesce(wm.total, 0)
    )
  from public.timesheets ts
  left join week_minutes wm
    on wm.household_id = ts.household_id
   and wm.carer_key = coalesce(ts.carer_id::text, ts.household_member_id::text)
   and wm.week_start = ts.week_start
  where (ts.carer_id is not null or ts.household_member_id is not null)
    and ts.total_minutes <> coalesce(wm.total, 0)

  union all

  -- 2. A torn earnings snapshot on an approved week. 042's invariant is that
  --    `gross_minor` and `earnings` are written and cleared together; either
  --    half alone is a settled amount with nothing behind it, or a priced
  --    week with no price.
  select
    'approved_snapshot_mismatch'::text,
    ts.id,
    jsonb_build_object(
      'household_id', ts.household_id,
      'week_start', ts.week_start,
      'has_gross', ts.gross_minor is not null,
      'earnings_status', ts.earnings ->> 'status'
    )
  from public.timesheets ts
  where ts.status = 'approved'
    and (
      (ts.gross_minor is not null and ts.earnings is null)
      or (ts.earnings ->> 'status' = 'ok' and ts.gross_minor is null)
    )

  union all

  -- 3. More leave was reversed than was ever taken (I-33). `pto_ledger.minutes`
  --    is signed and paying MORE is more negative (ptoCommandService), so net
  --    PAID minutes is -sum(minutes); a positive sum is a household that has
  --    been credited leave it never spent.
  select
    'pto_net_negative'::text,
    pl.time_off_id,
    jsonb_build_object(
      'household_id', pl.household_id,
      'net_paid_minutes', -sum(pl.minutes),
      'ledger_rows', count(*)
    )
  from public.pto_ledger pl
  where pl.time_off_id is not null
  group by pl.household_id, pl.time_off_id
  having sum(pl.minutes) > 0

  union all

  -- 4. Two pending claims for the same expense — the regression canary for
  --    051's dedupe index. Identity columns copied from that index verbatim,
  --    including its two coalesces; `carer_id is not null` because the index
  --    does not treat two nulls as equal and neither should this.
  select
    'expense_pending_dup'::text,
    (array_agg(e.id order by e.id))[1],
    jsonb_build_object(
      'household_id', e.household_id,
      'local_date', e.local_date,
      'kind', e.kind,
      'duplicate_count', count(*)
    )
  from public.expenses e
  where e.status = 'pending'
    and e.carer_id is not null
  group by
    e.household_id,
    e.carer_id,
    e.local_date,
    e.kind,
    e.description,
    e.currency,
    coalesce(e.amount_minor, -1),
    coalesce(e.miles, -1)
  having count(*) > 1

  union all

  -- 5. A paid cancellation with no payable entry behind it (I-38). The accept
  --    path leaves the flag standing as durable evidence and relies on the
  --    hourly reconcile job to settle it, so anything still unsettled two
  --    hours later has outlived that window: either the job is not running or
  --    it cannot repair this one.
  select
    'cancellation_unsettled'::text,
    s.id,
    jsonb_build_object(
      'household_id', s.household_id,
      'carer_id', s.carer_id,
      'cancelled_at', s.cancelled_at
    )
  from public.shifts s
  where s.cancellation_paid
    and s.status = 'cancelled'
    and s.carer_id is not null
    and coalesce(s.cancelled_at, s.updated_at) < now() - interval '2 hours'
    and not exists (
      select 1
      from public.time_entries te
      where te.shift_id = s.id
        and te.kind = 'cancellation_paid'
    )

  union all

  -- 6. Two overlapping completed entries for one carer — the canary for 055's
  --    exclusion constraints, reproducing both of its rules: presence cannot
  --    overlap presence in ANY household (cancellation pay is compensation,
  --    not presence, so it is exempt), and within ONE household nothing may
  --    overlap anything. Half-open ranges, matching `spansOverlap`. Keyed on
  --    `carer_id` like 055's constraints are — a departed carer cannot be
  --    double-booked in the future, and her past rows already passed.
  select
    'entry_overlap'::text,
    a.id,
    jsonb_build_object(
      'other_entry_id', b.id,
      'carer_id', a.carer_id,
      'rule', case
        when a.household_id = b.household_id then 'per_household'
        else 'per_carer'
      end
    )
  from public.time_entries a
  join public.time_entries b
    on b.carer_id = a.carer_id
   and b.id > a.id
   and b.clock_in_at is not null
   and b.clock_out_at is not null
   and tstzrange(a.clock_in_at, a.clock_out_at) && tstzrange(b.clock_in_at, b.clock_out_at)
  where a.carer_id is not null
    and a.clock_in_at is not null
    and a.clock_out_at is not null
    and (
      a.household_id = b.household_id
      or (a.kind <> 'cancellation_paid' and b.kind <> 'cancellation_paid')
    )

  union all

  -- 7. A session nobody closed. MAX_SESSION_SPAN_MS is 16 hours, so 20 gives
  --    slack for a long legitimate day; past that the carer cannot clock in
  --    anywhere (the one-running-per-carer index is not household scoped) and
  --    her hours are not banked. Also the backstop for a clock-out that
  --    crashed between writing the second week's fragment and closing this
  --    row.
  select
    'stuck_runner'::text,
    te.id,
    jsonb_build_object(
      'household_id', te.household_id,
      'carer_id', te.carer_id,
      'clock_in_at', te.clock_in_at
    )
  from public.time_entries te
  where te.status = 'running'
    and te.clock_out_at is null
    and te.clock_in_at < now() - interval '20 hours'

  union all

  -- 8. Completed entries in a week with no timesheet at all. Check #1 can only
  --    compare totals that exist; this is the case where the roll-up never
  --    created the row, so the hours are recorded and invisible to everyone
  --    who reviews or pays them.
  select
    'orphan_week'::text,
    (array_agg(em.id order by em.id))[1],
    jsonb_build_object(
      'household_id', em.household_id,
      'carer_id', em.carer_id,
      'week_start', em.week_start,
      'entry_count', count(*),
      'derived_minutes', sum(em.minutes)
    )
  from entry_minutes em
  where not exists (
    select 1
    from public.timesheets ts
    where ts.household_id = em.household_id
      and coalesce(ts.carer_id::text, ts.household_member_id::text) = em.carer_key
      and ts.week_start = em.week_start
  )
  group by em.household_id, em.carer_id, em.week_start, em.carer_key
$$;

revoke all on function public.run_integrity_checks() from public;
revoke all on function public.run_integrity_checks() from anon;
revoke all on function public.run_integrity_checks() from authenticated;
grant execute on function public.run_integrity_checks() to service_role;

comment on function public.run_integrity_checks is
  'Read-only data-integrity sweep: eight checks over money-bearing state, one row per violation. Carer-grouped checks key on coalesce(carer_id, household_member_id) so a departed carer stays visible (061). service_role only; called by integrityCheckJob (POST /api/jobs/integrity-checks, scheduled daily by 057). Never repairs anything.';
