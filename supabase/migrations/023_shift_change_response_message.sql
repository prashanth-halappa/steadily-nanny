-- 023 Shift change response message
--
-- Wave 5: shift_change_requests had one `message` column; respond() overwrote
-- the requester's text with the responder's. Persist the reply in
-- `response_message` (kept separate from `message`, which is the request note).

alter table public.shift_change_requests
  add column if not exists response_message text;
