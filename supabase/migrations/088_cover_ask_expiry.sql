-- 088 cover-ask expiry (S1 · D-22 + D-47) + the one-cancellation-window note (D-48)
--
-- APPLIED TO PROD 2026-08-12 (Phase 6) via Supabase MCP `apply_migration`,
-- in order with the rest of the 074→096 chain — never `supabase db push`
-- (version-scheme mismatch). Live tip after apply:
-- `redeem_draft_invite_week_starts_on`. Do not re-apply.

-- ---------------------------------------------------------------------------
-- WHY A STORED COLUMN AND NOT A DERIVED ONE
-- ---------------------------------------------------------------------------
-- D-22 said "expire after 48h". Taken literally, with a nightly sweep doing
-- the arithmetic, that produces this: a parent asks at 21:00 Thursday for a
-- 07:00 Friday shift. 48h lands Saturday, so the ask is still `pending` at
-- 07:00 Friday. The evening reminder window has closed for the day, nobody is
-- told anything, and the first signal is `shift_no_show` at 07:20 — twenty
-- minutes into a shift where a two-year-old has nobody.
--
-- D-47 therefore fixes the deadline AT ASK TIME:
--
--     cover_ask_expires_at = min(created_at + 48h, starts_at − 4h)
--                            with a 1h floor, and never after starts_at
--
-- The 4h lead answers "if she says nothing, how long do I need to find someone
-- else?". Under ~5h of lead time the ask is a genuine same-morning scramble
-- and the lead collapses to a 1h floor rather than going negative — an ask
-- that expires before it is read is worse than one with a short fuse.
--
-- Because the deadline is a KNOWN INSTANT, the expiry notice can be sent AT
-- it (`coverAskExpiryJob`, every 5 minutes) rather than swept for. The nightly
-- `scheduleHorizonJob` sweep is a BACKSTOP ONLY — it closes asks whose
-- scheduled send was missed, and it must never become the primary path. Near a
-- shift start, sweep latency is the entire failure mode.
--
-- The column is nullable and only ever set on an outstanding ask (a `pending`
-- shift of kind `extra`/`cover` with a carer on it). It is deliberately NOT
-- populated for `recurring` shifts: a materialised week awaiting a carer's
-- acceptance is a standing arrangement, not a question with a fuse on it.
--
-- Both surfaces render the deadline sentence from this one column (M21), so
-- the carer's inbox item and her shift detail can never quote two deadlines.

alter table public.shifts
  add column if not exists cover_ask_expires_at timestamptz;

comment on column public.shifts.cover_ask_expires_at is
  'D-47: when an unanswered ask stops being answerable. Computed and stored at '
  'ask time as min(created_at + 48h, starts_at - 4h), 1h floor, never after '
  'starts_at. NULL on anything that is not an outstanding cover-ask. Sent at, '
  'never swept for — see apps/api/src/jobs/coverAskExpiryJob.ts.';

-- The expiry job''s only query: due asks, oldest first. Partial so the index
-- stays the size of the outstanding-ask set rather than the shifts table —
-- rows drop out of it the moment they are answered or expired.
create index if not exists shifts_cover_ask_expiry_idx
  on public.shifts (cover_ask_expires_at)
  where status = 'pending' and cover_ask_expires_at is not null;

-- ---------------------------------------------------------------------------
-- D-48 — ONE cancellation window
-- ---------------------------------------------------------------------------
-- `households.cancellation_paid_within_hours` (009:57) was flagged for
-- deprecation by 041:107 and kept as "the fallback for a carer with no
-- arrangement at all". D-48 removes that fallback: the arrangement''s
-- `cancellation_paid_within_hours` is now the ONLY cancellation window in the
-- product, and a carer with NO arrangement gets NO cancellation pay.
--
-- That is STRICTER than the behaviour it replaces — a household whose column
-- said 24 used to pay a no-arrangement cancellation and now does not. It is
-- recorded here because it is a money-behaviour change with no schema diff to
-- point at, and because the honest reason is that two homes for one number
-- eventually print two contradictory sentences on one screen: the dialog
-- saying "outside your 24-hour window, so it isn''t paid" beside a pill
-- reading "Short notice", which every nanny reads as "this one is paid".
--
-- THE COLUMN STAYS, its readers go. Dropping it would be a destructive change
-- for a value some households have deliberately set, and it costs nothing to
-- leave in place while the surfaces that write it are rebuilt (3-U1 owns the
-- Pay & terms presentation, per docs/design/attention-and-notifications.md
-- §6.1). `households.short_notice_hours` is a DIFFERENT column answering a
-- different question ("does this change need the owner''s sign-off?") and is
-- deliberately untouched here.
comment on column public.households.cancellation_paid_within_hours is
  'DEPRECATED (D-48, was already flagged by 041). No readers as of 3-T3: the '
  'pay arrangement''s cancellation_paid_within_hours is the only cancellation '
  'window, and no arrangement now means no cancellation pay. Column retained '
  'rather than dropped — see this migration''s header.';

-- ---------------------------------------------------------------------------
-- S9 / D-25 — where uncovered retraction would have gone, and why it does not
-- ---------------------------------------------------------------------------
-- `uncovered_care` rows in `shift_events` are never retracted when a gap is
-- filled, and this migration deliberately adds no mechanism for doing so.
-- The log is EVIDENCE, not state: a row proves a window WAS uncovered when it
-- was written, and every UI surface recomputes current truth from live shifts,
-- commitments and closures via `computeUncovered` (docs/12-NEED-COVERAGE.md
-- §4). Booking cover clears the card on the next refetch; nothing waits for a
-- compensating event. A retraction event would be a second, lagging source of
-- truth for a question already answered correctly — and the original defect
-- this feature was born from was exactly a banner that read the event log
-- instead of recomputing.

-- ---------------------------------------------------------------------------
-- Cover-ask expiry cron — every 5 minutes
-- ---------------------------------------------------------------------------
-- WHY 5 MINUTES AND NOT HOURLY. The deadline is already stored, so this tick
-- only decides latency between the deadline and the parent hearing about it.
-- An ask expiring at 05:40 for an 07:00 shift is the case the whole decision
-- exists for; an hourly tick could hand the parent that news at 06:40, with
-- twenty minutes to find childcare. Five minutes costs one indexed query
-- against a partial index that is empty for most households.
--
-- Minute offset ':3,8,13…' avoids colliding with the other jobs on the
-- schedule (026/032 horizon 0 3 * * *, 048 reminders :05, 054 reconcile :25,
-- 057 integrity 04:10, 066 no-show */10, 073 uncovered-digest :35, 090
-- no-show-digest :50).
--
-- SHAPE COPIED FROM 090/073/066, including 032''s correction: `create
-- extension if not exists pg_net` goes INSIDE the pg_cron-exists check, never
-- before it. Put it before and a database without pg_net hard-fails the
-- migration before the graceful-degradation guard is ever reached.
--
-- Prerequisites (one-time, see 007_pg_cron_vault_and_example_cron.sql): the
-- vault secrets cron_api_base_url and cron_job_api_key must exist.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE 'pg_cron extension not installed; skipping cover-ask-expiry cron job';
    RETURN;
  END IF;

  create extension if not exists pg_net;

  -- Idempotent: drop any prior registration before re-scheduling
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cover-ask-expiry'
  ) THEN
    PERFORM cron.unschedule('cover-ask-expiry');
  END IF;

  PERFORM cron.schedule(
    'cover-ask-expiry',
    '3-58/5 * * * *',
    $cmd$SELECT net.http_post(
        url := private.cron_api_base_url() || '/api/jobs/cover-ask-expiry',
        headers := jsonb_build_object(
          'X-Job-Api-Key', private.cron_job_api_key(),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
    )$cmd$
  );
END
$do$;
