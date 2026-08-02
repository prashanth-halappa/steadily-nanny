-- 022 Co-parent approval queue (design flow 1f)
--
-- When households.approval_mode = 'ask_other', short-notice changes /
-- cancellations (or all mutations when approval_scope = 'all') land here as
-- pending until the other parent responds OR timeout_at passes. The
-- materialisation/maintenance job auto-approves timed-out rows so a silent
-- phone never leaves a day uncovered.

create table if not exists public.co_parent_approvals (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  requested_by  uuid references public.user_profiles(user_id) on delete set null,
  action        text not null
                  check (action in ('short_notice_change', 'cancel',
                                    'extra_shift', 'other')),
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'declined',
                                    'timed_out', 'withdrawn')),
  timeout_at    timestamptz not null,
  responded_by  uuid references public.user_profiles(user_id) on delete set null,
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists co_parent_approvals_household_pending_idx
  on public.co_parent_approvals (household_id, created_at desc)
  where status = 'pending';

create index if not exists co_parent_approvals_timeout_idx
  on public.co_parent_approvals (timeout_at)
  where status = 'pending';

alter table public.co_parent_approvals enable row level security;

drop policy if exists "Parents can view co-parent approvals" on public.co_parent_approvals;
create policy "Parents can view co-parent approvals" on public.co_parent_approvals
  for select using (private.is_household_parent(household_id));

drop trigger if exists set_co_parent_approvals_updated_at on public.co_parent_approvals;
create trigger set_co_parent_approvals_updated_at
  before update on public.co_parent_approvals
  for each row execute function public.set_updated_at();
