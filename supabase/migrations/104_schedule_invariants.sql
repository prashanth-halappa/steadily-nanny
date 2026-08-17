-- 104 Schedule invariants — the two rules the app believed and the schema
--     never agreed to (audit S3, S4a)
--
-- ---------------------------------------------------------------------------
-- S3 — one ACCEPTED pattern per (household, carer)
-- ---------------------------------------------------------------------------
--
-- The whole confirmation model rests on this: a household's "usual week" with
-- one carer is ONE accepted pattern, and accepting a new one supersedes the
-- old. `schedulePatternCommandService` enforces it in application code, and
-- nothing in the schema has ever agreed. 062's header records what that cost:
-- "the project held windows with THREE identical live recurring shifts from
-- three different patterns for one carer." The repair added a unique index —
-- on `shifts`, NOT on `schedule_patterns`. The net underneath holds; the root
-- invariant has been unguarded ever since.
--
-- `carer_id is not null` is load-bearing, not tidiness: a carer-less pattern
-- is a parent sketching a usual week during onboarding before any nanny
-- exists (014's column comment, design flow 1a step 6), and several of those
-- may legitimately sit side by side.
--
-- BEFORE APPLYING TO A LIVE DATABASE: `create unique index` FAILS outright if
-- a duplicate already exists. Check first, and end the surplus patterns
-- (`status = 'ended'`) before running:
--
--   select household_id, carer_id, count(*), array_agg(id)
--     from public.schedule_patterns
--    where status = 'accepted' and carer_id is not null
--    group by 1, 2
--   having count(*) > 1;
--
-- Verified zero on production before this migration was written.
--
-- ---------------------------------------------------------------------------
-- The cover / parent_cover dedupe gap
-- ---------------------------------------------------------------------------
--
-- 059 gave `kind = 'extra'` a window dedupe index and 062 gave `recurring`
-- one. `cover` and `parent_cover` were left out, and both are created by the
-- same check-then-act shape 059's header describes: `createParentCover` reads
-- `findParentCoverInWindow` and inserts when it finds nothing, so two
-- simultaneous "I've got it" taps both read empty and both insert. These two
-- indexes are 059's, character for character, with the `kind` swapped.
--
-- THE NULL TRAP, again: a `parent_cover` row carries `carer_id = NULL` by
-- construction (the parent is covering, there is no carer), and in a plain
-- unique index Postgres treats NULLs as DISTINCT — so two identical parent
-- covers would dedupe against nothing, which is precisely the shape this is
-- for. `nulls not distinct` closes it; PG15 supports it and
-- `supabase/config.toml` pins `major_version = 15`. Same precedent as 053,
-- 059 and 062.
--
--   select household_id, carer_id, starts_at, ends_at, count(*), array_agg(id)
--     from public.shifts
--    where kind in ('cover', 'parent_cover') and status <> 'cancelled'
--    group by 1, 2, 3, 4
--   having count(*) > 1;
--
-- ---------------------------------------------------------------------------
-- S4a — same carer, same household, OVERLAPPING windows
-- ---------------------------------------------------------------------------
--
-- 015's header says there is deliberately no overlap constraint, because
-- "conflicts WARN and never block: a nanny may accept a shift that clashes
-- with another family." That rule is about ACROSS families, and it still
-- stands: this constraint is keyed on `household_id`, so a clash between two
-- households can never reach it. S4b (cross-household) stays advisory through
-- `v_busy_blocks` and `clashWarning`, unchanged.
--
-- WITHIN one household the rule was never a product decision, it was an
-- omission. The only refusing checks (059, 062) test window EQUALITY, so
-- 09:00–17:00 and 10:00–12:00 for the same carer both insert cleanly, and the
-- family then owes — and the timesheet then bills — the same person for the
-- same hour twice. One family paying twice for one window is the same defect
-- 055 wrote its per-household time-entry constraint for; this is the booking
-- half of it. The owner's decision: refuse, 409.
--
-- HALF-OPEN BOUNDS, [). `tstzrange`'s two-argument form already defaults to
-- `[)`, but it is passed EXPLICITLY here because this constraint's whole
-- subject is boundaries: 09:00–12:00 followed by 12:00–15:00 is a normal
-- split day, not an overlap, and `'[]'` would refuse it. Same reading as
-- 055 and as `spansOverlap`.
--
-- WHAT IS EXEMPT, AND WHY
--   `carer_id is null`   — "Thu, nobody yet" is a real displayable state
--                          (015), and every `parent_cover` row is carer-less
--                          by construction. Two of those overlapping is not
--                          one person in two places; the two indexes above
--                          are what dedupe them.
--   status 'cancelled'   — a called-off booking occupies nobody's day.
--   status 'declined'    — likewise: she said no.
-- Everything else — draft, pending, confirmed, completed — is a claim on that
-- carer's time in that household and participates.
--
-- INDEX CHECK ORDER IS OID ORDER, AND THAT IS WHY THIS IS LAST. Postgres
-- evaluates unique/exclusion constraints in the order their indexes were
-- created. 059's and 062's indexes are older, and the two created above are
-- created earlier in this same file, so an EXACT duplicate still raises their
-- 23505 before this constraint's 23P01 — which is what keeps every
-- adopt-the-winner path working (`scheduleMaterialisationService`'s
-- adopt-on-collision, `insertExtraShift`'s double-tap adoption). This
-- constraint only ever fires on a PARTIAL overlap, the case nothing caught.
--
-- DEPLOY RISK: unlike a CHECK, an exclusion constraint has no NOT VALID form,
-- so any PRE-EXISTING overlapping pair fails this ALTER and blocks the deploy.
-- That is the correct failure — it means somebody is double-booked —
-- but it must be checked before the deploy window, not during it:
--
--   select a.id as keep_id, b.id as fix_id, a.household_id, a.carer_id,
--          a.kind, b.kind, a.starts_at, a.ends_at, b.starts_at, b.ends_at
--     from public.shifts a
--     join public.shifts b
--       on a.household_id = b.household_id
--      and a.carer_id = b.carer_id
--      and a.id < b.id
--    where a.carer_id is not null
--      and a.status not in ('cancelled', 'declined')
--      and b.status not in ('cancelled', 'declined')
--      and tstzrange(a.starts_at, a.ends_at, '[)')
--       && tstzrange(b.starts_at, b.ends_at, '[)');
--
-- MANUAL REPAIR RECIPE, if that returns rows: for each pair decide which
-- booking is real, then either cancel the other
--   (`update public.shifts set status = 'cancelled', cancelled_at = now(),
--     cancelled_by = null where id = '<fix_id>';` — `cancelled_by` null reads
--    as "nobody acted", the same discriminator 088 uses for expiry), or
--   re-time it so the windows abut. Do NOT delete: a shift with hours behind
--   it is somebody's pay. Re-run the SELECT until empty, then apply.
--
-- Verified zero on production before this migration was written (0 live
-- shifts, 0 accepted-pattern duplicates, 0 overlaps).
--
-- The ALTER takes an ACCESS EXCLUSIVE lock while it builds the gist index.
-- `shifts` is small, so this is brief.

-- ---------------------------------------------------------------------------
-- 1. S3 — the root invariant
-- ---------------------------------------------------------------------------

create unique index if not exists schedule_patterns_one_accepted_idx
  on public.schedule_patterns (household_id, carer_id)
  where status = 'accepted' and carer_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The two missing window dedupes, in 059's shape
-- ---------------------------------------------------------------------------

create unique index if not exists shifts_cover_window_unique
  on public.shifts (household_id, carer_id, starts_at, ends_at)
  nulls not distinct
  where kind = 'cover' and status <> 'cancelled';

create unique index if not exists shifts_parent_cover_window_unique
  on public.shifts (household_id, carer_id, starts_at, ends_at)
  nulls not distinct
  where kind = 'parent_cover' and status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- 3. S4a — no overlapping windows for one carer inside one household
-- ---------------------------------------------------------------------------

create extension if not exists btree_gist;

alter table public.shifts
  drop constraint if exists shifts_carer_window_excl;

alter table public.shifts
  add constraint shifts_carer_window_excl
  exclude using gist (
    household_id with =,
    carer_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (
    carer_id is not null
    and status not in ('cancelled', 'declined')
  );

comment on constraint shifts_carer_window_excl on public.shifts is
  'One carer cannot hold two overlapping live windows in ONE household (S4a). Cross-household clashes stay advisory - see v_busy_blocks and domains/me/services/clashWarning.ts. Raised as 23P01 and translated to ShiftOverlapsError (409, SHIFT_OVERLAP).';
