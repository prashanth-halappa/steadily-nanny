-- 063 Money upper bounds — a ceiling on every money column, not just a floor
--
-- Closes audit finding F-B2-6. 041 and 044 gave every money column a floor
-- (`>= 0`) but no ceiling — nothing in the schema disagreed with a pay rate
-- or an expense of a billion pounds. Only client-side validation did
-- (mobile's `parseMajorToMinor`), and client-side validation is not a
-- backstop against a direct write. This adds the missing ceiling to the
-- four columns the Zod schema caps land on in the same wave, plus one more.
--
-- THE FIFTH COLUMN, AND WHY CAPPING THE OTHER FOUR WASN'T ENOUGH
-- (adversarial review REOPEN — the caps-don't-bound-products class.)
-- Every constraint the first four add bounds an INPUT. Nothing bounds what
-- inputs MULTIPLY into. `timesheets.gross_minor` (042) is computed —
-- 40 hours at the schema-legal maximum rate is 40 x 99_999_999 =
-- 3_999_999_960, which is not merely over-cap, it is over int4 — so approving
-- such a week died on a raw Postgres "value out of range" with no typed error
-- and no clean message. Capping the product is the backstop; the service-layer
-- pre-flight guards in `timesheetCommandService.approve` and
-- `expenseCommandService.review` are what turn hitting it into a readable 400
-- instead of a database error surfacing mid-approval.
--
-- OPEN PRODUCT QUESTION FOR THE OWNER (recorded, not decided here)
-- The per-hour (`rate_minor`) and per-mile (`mileage_rate_per_mile_minor`)
-- RATE caps reuse the TOTAL-amount cap, MAX_MONEY_MINOR — which is exactly
-- why a legal rate can still multiply into an illegal total. Materially
-- tighter DOMAIN caps (a realistic maximum £/hour, a realistic maximum
-- £/mile) would make the overflow UNREACHABLE rather than merely
-- cleanly-failing. Choosing those numbers is a product judgement about what a
-- real family pays, not an engineering one, so it is deliberately left as an
-- owner decision. Until it is made, the guards above are the whole answer.
--
-- THE BOUND: 99_999_999 minor units = £999,999.99. Matches
-- `parseMajorToMinor`'s cap exactly, so a value the mobile app will accept
-- and one the database will accept are the same set.
--
-- THE NULL TRAP, AND WHY THERE ISN'T ONE HERE
-- `bill_rate_minor`, `mileage_rate_per_mile_minor` (041), `amount_minor`
-- (044) and `gross_minor` (042 — added as bare `integer`, never NOT NULL)
-- are nullable columns with a real null meaning each — "dormant", "no
-- mileage rate", "not priced yet", "week not approved, or approved but
-- unpriceable". A CHECK constraint only
-- fails when its expression evaluates to FALSE; `null <= 99999999`
-- evaluates to NULL, not FALSE, so the plain form below already lets every
-- one of those NULLs through with no `is null or` guard needed. Adding one
-- would be width the column's own semantics already cover.
--
-- DEPLOY RISK: unlike an index created `if not exists`, a CHECK added to a
-- table that already holds an over-cap row FAILS the ALTER and blocks the
-- deploy. That is the correct failure — a pre-existing nine-hundred-
-- thousand-pound rate wants a human, not a silent constraint that never
-- takes effect — but it should be caught before the deploy window, not
-- during it. Same discipline as 059's pre-existing-duplicates note:
--   select id, rate_minor from public.pay_arrangements
--     where rate_minor > 99999999;
--   select id, bill_rate_minor from public.pay_arrangements
--     where bill_rate_minor > 99999999;
--   select id, mileage_rate_per_mile_minor from public.pay_arrangements
--     where mileage_rate_per_mile_minor > 99999999;
--   select id, amount_minor from public.expenses
--     where amount_minor > 99999999;
--   select id, gross_minor from public.timesheets
--     where gross_minor > 99999999;
-- Each ADD below fails loudly, and is meant to, if any of these return rows.
-- The last query is the one most likely to return something: a frozen gross
-- is the only one of the five nothing has ever bounded, and unlike a rate,
-- nobody typed it — so an over-cap row there is a computation to investigate,
-- not a typo to correct.

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_rate_minor_upper;

alter table public.pay_arrangements
  add constraint pay_arrangements_rate_minor_upper
  check (rate_minor <= 99999999);

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_bill_rate_minor_upper;

alter table public.pay_arrangements
  add constraint pay_arrangements_bill_rate_minor_upper
  check (bill_rate_minor <= 99999999);

alter table public.pay_arrangements
  drop constraint if exists pay_arrangements_mileage_rate_per_mile_minor_upper;

alter table public.pay_arrangements
  add constraint pay_arrangements_mileage_rate_per_mile_minor_upper
  check (mileage_rate_per_mile_minor <= 99999999);

alter table public.expenses
  drop constraint if exists expenses_amount_minor_upper;

alter table public.expenses
  add constraint expenses_amount_minor_upper
  check (amount_minor <= 99999999);

-- The computed one. See "THE FIFTH COLUMN" above.
alter table public.timesheets
  drop constraint if exists timesheets_gross_minor_upper;

alter table public.timesheets
  add constraint timesheets_gross_minor_upper
  check (gross_minor <= 99999999);
