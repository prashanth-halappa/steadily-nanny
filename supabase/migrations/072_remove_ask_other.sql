-- 072 Remove ask_other co-parent approval gate (product decision 2026-08-09)
--
-- The two-parent consent gate is removed. Any single parent's action applies
-- IMMEDIATELY. The acting parent is recorded for audit (shift_events.actor_id,
-- approved_by, recorded_by, reviewed_by, created_by). The OTHER parent(s) get
-- an FYI push. `owner_only` mode survives — only `ask_other` dies.
--
-- `co_parent_approvals` and its RLS policy are kept as an audit record.

-- In-flight rows close; their parked actions were never applied — a parent
-- just redoes them ungated.
update public.co_parent_approvals
  set status = 'withdrawn', updated_at = now()
  where status = 'pending';

-- Households on ask_other behave as either from here on.
update public.households
  set approval_mode = 'either'
  where approval_mode = 'ask_other';

-- MATCHED PAIR: households.approval_mode CHECK and HOUSEHOLD_APPROVAL_MODES in
-- packages/shared-types/src/schemas/household.schema.ts.
alter table public.households
  drop constraint if exists households_approval_mode_check;

alter table public.households
  add constraint households_approval_mode_check
  check (approval_mode in ('either', 'owner_only'));

-- Only used by the removed ask_other timeout / auto-approve sweep.
alter table public.households
  drop column approval_timeout_minutes;
