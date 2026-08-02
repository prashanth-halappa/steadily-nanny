-- 020 Schedule pattern decline message
--
-- Wave 4 CX: when a nanny declines a proposed usual week, parents need to
-- see WHY. The respond endpoint already accepts an optional `message` body
-- field but previously discarded it. Persist it here as `decline_message`
-- (kept separate from `note`, which is the parent's proposal note).

alter table public.schedule_patterns
  add column if not exists decline_message text;
