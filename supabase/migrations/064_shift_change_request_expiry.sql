-- 064 Pending change requests can age out — `status = 'expired'`
--
-- Closes audit finding F-B5-5. `shift_change_requests` (015) had five statuses
-- and no clock. Four of them are reached by somebody DOING something: the
-- responder accepts or declines, the requester withdraws, a newer request
-- supersedes. Nothing at all is reached by nobody doing anything — so a
-- request the nanny simply never answered stays `pending` forever. It keeps
-- its slot in the `shift_change_requests_pending_idx` partial index, it keeps
-- showing up in `listPendingByShiftIds` (the parent's "waiting on them" list
-- and the nanny's inbox), and it keeps blocking nothing while looking like it
-- blocks everything — months after the shift it was about has been and gone.
--
-- THE 7 DAY DEFAULT
-- The sweep lives in `scheduleHorizonJob` and keys off `created_at`, not off
-- the shift's start: a request about a shift six weeks out is just as stale at
-- day eight as one about tomorrow, and `created_at` is the only column that
-- always exists. Seven days is a PRODUCT default chosen during the audit
-- closeout, not a derived constant — long enough that a family on holiday
-- comes back to a live question, short enough that the list means something.
-- It is a single constant in the job (`EXPIRY_DAYS`) and the owner can tune it
-- without a migration, which is exactly why this migration hard-codes nothing
-- about the interval and only widens the vocabulary.
--
-- WHY A DISTINCT STATUS AND NOT `withdrawn`
-- Reusing `withdrawn` was the smaller diff and is the wrong answer. Withdrawn
-- means the REQUESTER changed their mind and took the ask back. This table is
-- audit-adjacent — the day thread is built from it, and it is what a household
-- scrolls back through when it argues about who agreed to what. Recording that
-- a parent withdrew a request they never touched is the table telling the
-- family something untrue about one of its members, to save a status. It also
-- destroys the only distinction that matters operationally: `withdrawn` is a
-- resolved negotiation, `expired` is an UNANSWERED one, and a household that
-- accumulates the latter has a responsiveness problem worth surfacing.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- No backfill. Rows that are pending today stay pending until the sweep looks
-- at them and decides, against a cutoff computed at run time, whether they are
-- past it. An `update ... set status = 'expired'` here would expire them
-- against deploy time instead, and would do it inside a migration where the
-- interval is unreviewable and unrepeatable.
--
-- Reads need no change: every consumer filters `= 'pending'` or `<> 'pending'`
-- (`listPendingByShiftIds`, the two CAS updates in the repository, the mobile
-- inbox builder), so an expired row drops out of the action lists on its own.
-- The `where status = 'pending'` partial index frees its slot the moment the
-- sweep flips the row, which is the point.

-- The 015 constraint is inline on the column, so it carries Postgres's
-- generated name. Drop-then-add under that same name (house pattern: 053, 055,
-- 063) keeps this migration re-runnable — a bare ADD dies on the second run
-- and takes the whole `supabase db reset` down with it.
alter table public.shift_change_requests
  drop constraint if exists shift_change_requests_status_check;

alter table public.shift_change_requests
  add constraint shift_change_requests_status_check
  check (status in ('pending', 'accepted', 'declined',
                    'withdrawn', 'superseded', 'expired'));

comment on constraint shift_change_requests_status_check
  on public.shift_change_requests is
  'F-B5-5: `expired` is written only by the 7-day sweep in scheduleHorizonJob. '
  'It is deliberately not `withdrawn` — withdrawn means the requester acted.';
