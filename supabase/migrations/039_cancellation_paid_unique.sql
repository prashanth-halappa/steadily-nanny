-- 039 At most one cancellation_paid time entry per shift
--
-- `recordCancellationPaidEntry` is idempotent on shift_id. The service-level
-- find-first is an optimisation; this partial unique index is the source of
-- truth under concurrent paid-cancel accepts. A second insert racing past
-- find-first raises 23505, which the repository translates to
-- CancellationPaidAlreadyRecordedError so the loser can re-fetch the winner.

create unique index if not exists time_entries_one_cancellation_paid_per_shift
  on public.time_entries (shift_id)
  where kind = 'cancellation_paid' and shift_id is not null;
