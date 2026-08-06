-- 062 One live RECURRING shift per (household, carer, window)
--
-- THE BUG. A household could hold several simultaneously-`accepted`
-- schedule_patterns for the SAME (household_id, carer_id).
-- `schedulePatternCommandService.respond`'s accept branch flipped a pattern to
-- `accepted` and materialised it, but never ended the prior one — 014's header
-- has always defined `ended` as "superseded or past its `until` date", and only
-- the second half was ever implemented. Each accepted pattern then materialised
-- the same week independently: `scheduleShiftRepository.findByPatternAndDate`
-- dedupes on `source_pattern_id`, so it cannot see another pattern's row at the
-- identical instant. The result is byte-identical duplicate `shifts` rows
-- (kind='recurring', origin='system_generated', same household, carer,
-- starts_at and ends_at) that the family sees, the carer sees, and payroll can
-- eventually pay twice for. The app-side fix lands in the same change
-- (supersede-on-accept plus a shared end-a-pattern helper that withdraws the
-- ended pattern's future shifts); this migration brings existing data in line
-- with the new invariant and stops the shape coming back.
--
-- SCOPE: IDENTICAL WINDOWS ONLY. OVERLAPPING shifts stay legal, deliberately —
-- see 015's "NO OVERLAP CONSTRAINT, DELIBERATELY" and `clashWarning.ts`: the
-- product rule is that clashes WARN and never block, and a nanny may genuinely
-- be double-booked while a family sorts cover out. Nothing here is an exclusion
-- constraint; 08:00-16:00 and 08:00-16:01 remain two perfectly good rows. Only
-- the exact same window for the exact same carer is refused.
--
-- THE IDENTITY and THE NULL TRAP mirror 059 exactly: (household_id, carer_id,
-- starts_at, ends_at) with `nulls not distinct`, because `carer_id` is nullable
-- and "Thu — nobody yet" is a real, supported shape (015). `nulls not distinct`
-- needs PG15+; `supabase/config.toml` pins `major_version = 15` locally and the
-- hosted project runs 17.
--
-- THE SHAPE IS LIVE: before this ran, the project held windows with THREE
-- identical live recurring shifts from three different patterns for one carer.
--
-- ---------------------------------------------------------------------------
-- 1. Bring the patterns in line: at most ONE accepted pattern per
--    (household, carer). Newest wins, by when the carer actually responded
--    (`responded_at`, falling back to `created_at` for rows that predate it).
--    GROUP BY / PARTITION BY treat NULL carer_id as one group, which is what we
--    want here. Idempotent: a second run finds nothing ranked > 1.
-- ---------------------------------------------------------------------------

with ranked_patterns as (
  select id,
         row_number() over (
           partition by household_id, carer_id
           order by coalesce(responded_at, created_at) desc,
                    created_at desc,
                    id desc
         ) as rn
    from public.schedule_patterns
   where status = 'accepted'
)
update public.schedule_patterns p
   set status = 'ended',
       updated_at = now()
  from ranked_patterns r
 where p.id = r.id
   and r.rn > 1;

-- ---------------------------------------------------------------------------
-- 2. Collapse the duplicate shifts the missing supersede already produced.
--    Within each (household, carer, starts_at, ends_at) group of live
--    `recurring` rows, KEEP the one whose pattern is still `accepted` after
--    step 1 (most recently accepted first), and if none of the group's patterns
--    is still accepted, keep the newest shift. Everything else is cancelled.
--
--    NEVER cancelled, whatever the ranking says: a `completed` shift, or one
--    somebody has clocked into (`time_entries`, 017) — that is settled,
--    paid-for reality and this migration does not rewrite it. Those rows sort
--    FIRST so they are the ones kept.
--
--    Idempotent: cancelled rows drop out of the candidate set on a re-run.
-- ---------------------------------------------------------------------------

with candidates as (
  select s.id,
         s.household_id,
         s.carer_id,
         s.starts_at,
         s.ends_at,
         s.created_at,
         (s.status = 'completed') as is_completed,
         exists (select 1
                   from public.time_entries te
                  where te.shift_id = s.id) as has_time_entries,
         (p.status = 'accepted') as pattern_accepted,
         coalesce(p.responded_at, p.created_at) as pattern_accepted_at
    from public.shifts s
    left join public.schedule_patterns p on p.id = s.source_pattern_id
   where s.kind = 'recurring'
     and s.status <> 'cancelled'
),
ranked_shifts as (
  select id,
         is_completed,
         has_time_entries,
         row_number() over (
           partition by household_id, carer_id, starts_at, ends_at
           order by is_completed desc,
                    has_time_entries desc,
                    pattern_accepted desc nulls last,
                    pattern_accepted_at desc nulls last,
                    created_at desc,
                    id desc
         ) as rn
    from candidates
)
update public.shifts s
   set status = 'cancelled',
       reason = coalesce(s.reason, 'duplicate_recurring'),
       cancelled_at = coalesce(s.cancelled_at, now()),
       updated_at = now()
  from ranked_shifts r
 where s.id = r.id
   and r.rn > 1
   and not r.is_completed
   and not r.has_time_entries;

-- ---------------------------------------------------------------------------
-- 3. The guard itself. `create unique index` FAILS outright if any duplicate
--    survives step 2 — which can only happen if a group holds two completed or
--    two clocked-into rows, i.e. two shifts somebody was actually paid for.
--    That needs a human, not a migration. Check before applying:
--
--      select household_id, carer_id, starts_at, ends_at, count(*), array_agg(id)
--        from public.shifts
--       where kind = 'recurring' and status <> 'cancelled'
--       group by 1, 2, 3, 4
--      having count(*) > 1;
--
--    `scheduleShiftRepository.create` translates this index's 23505 into
--    `RecurringShiftAlreadyExistsError`, and
--    `scheduleMaterialisationService` ADOPTS the existing row (re-points it at
--    the accepting pattern) instead of failing the run — the same
--    adopt-the-winner path 059 gave extra shifts.
-- ---------------------------------------------------------------------------

create unique index if not exists shifts_recurring_window_unique
  on public.shifts (household_id, carer_id, starts_at, ends_at)
  nulls not distinct
  where kind = 'recurring' and status <> 'cancelled';
