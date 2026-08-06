-- 056 Data-integrity checks — the sweep that reads what is ALREADY written
--
-- WHY THIS EXISTS
-- Every other guard in this schema prevents a bad write: check constraints,
-- partial unique indexes, 055's exclusion constraints, the serialising RPCs.
-- Not one of them can tell you about a wrong number that is already in the
-- table — a `timesheets.total_minutes` that stopped matching its entries, an
-- approved week whose frozen earnings snapshot is half missing, a shift
-- flagged `cancellation_paid` that nobody ever paid. On a payroll app those
-- states are silent until a human notices their pay is wrong, and by then the
-- money has moved. This function asks the eight questions; `integrityCheckJob`
-- (POSTed daily by 057) turns the answers into error-level logs and a failed
-- job run, which is what makes them visible.
--
-- IT NEVER REPAIRS. Every branch is a SELECT. A sweep that writes can corrupt
-- on a bad predicate and destroys the evidence a human needs to understand
-- what happened; repairs belong in a job someone chose to run
-- (`cancellationPayReconcileJob` is the model). Report, never repair.
--
-- THE MINUTES FORMULA IS A CONTRACT WITH TYPESCRIPT
-- Check #1 recomputes a week's minutes here and compares it against a total
-- that `sumWorkedMinutes` wrote. The expression below therefore mirrors
-- `computeWorkedMinutes` in apps/api/src/domains/timesheet/utils/
-- workedMinutes.ts EXACTLY —
--   Math.max(0, Math.round((out - in) / 60_000) - break_minutes)
-- plus C7's promotion of `scheduled_minutes` to the authoritative figure for
-- `kind = 'cancellation_paid'` (the round-once residual is carried there, so
-- recomputing it from the span would report every residual-bearing fragment
-- as a one-minute mismatch). If either side changes, BOTH move together: the
-- TS side has a pointing comment, and this side's contract test greps for the
-- formula text. A drifting formula does not fail loudly — it reports every
-- timesheet in the database as broken, which is how a monitoring system
-- becomes noise nobody reads.
--
-- `extract(epoch from interval)` returns numeric on PG14+, so `round()` here
-- is numeric rounding — half away from zero, which is what JS `Math.round`
-- does for the positive values a span always produces. On PG13 it would be
-- double precision and round half-to-even; Supabase is PG15.
--
-- SECURITY: public schema (the only one PostgREST exposes). SECURITY INVOKER,
-- like 019/024/050 — the API calls this with the service-role client, which
-- already bypasses RLS, so definer rights would buy nothing and add an
-- escalation surface. Revoked from PUBLIC/anon/authenticated; service_role
-- EXECUTE only.
--
-- ROWS WITH A DEPARTED CARER (`carer_id is null`, migration 033) are excluded
-- from the checks that group by carer: their memberships are gone, so the
-- entry-to-timesheet join can only be made on a display name, and two carers
-- called Emma would report as a permanent mismatch. 058's
-- `household_member_id` is the forward fix; until enough history carries it,
-- silence beats a false alarm on rows nobody can act on anyway.

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
      date_trunc('week', te.local_date)::date as week_start,
      case
        when te.kind = 'cancellation_paid'
          then coalesce(te.scheduled_minutes, greatest(0, round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60) - te.break_minutes))
        else greatest(0, round(extract(epoch from (te.clock_out_at - te.clock_in_at)) / 60) - te.break_minutes)
      end as minutes
    from public.time_entries te
    where te.clock_in_at is not null
      and te.clock_out_at is not null
      and te.carer_id is not null
  ),
  week_minutes as (
    select
      em.household_id,
      em.carer_id,
      em.week_start,
      sum(em.minutes) as total
    from entry_minutes em
    group by em.household_id, em.carer_id, em.week_start
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
   and wm.carer_id = ts.carer_id
   and wm.week_start = ts.week_start
  where ts.carer_id is not null
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
  --    overlap anything. Half-open ranges, matching `spansOverlap`.
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
      and ts.carer_id = em.carer_id
      and ts.week_start = em.week_start
  )
  group by em.household_id, em.carer_id, em.week_start
$$;

revoke all on function public.run_integrity_checks() from public;
revoke all on function public.run_integrity_checks() from anon;
revoke all on function public.run_integrity_checks() from authenticated;
grant execute on function public.run_integrity_checks() to service_role;

comment on function public.run_integrity_checks is
  'Read-only data-integrity sweep: eight checks over money-bearing state, one row per violation. service_role only; called by integrityCheckJob (POST /api/jobs/integrity-checks, scheduled daily by 057). Never repairs anything.';
