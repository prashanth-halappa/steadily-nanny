# ROLLBACK-RUNBOOK.md

Written 2026-08-12 during Phase 5 (integration freeze) of
`TRUST-AND-TERMS-PLAYBOOK.md`, per §0.9 and §10 item 8.

**Migrations in this repo are forward-only.** There is no `down` step and no
schema rollback. "Rollback" therefore means: *stop the new behavior from
running*, using a switch that exists **before** the risky change ships. This
document is that list.

---

## §1 What switches actually exist

Read this first — it is shorter than you would like.

| Switch | Where | Scope | Notes |
|---|---|---|---|
| `cron.unschedule('<job>')` | Supabase SQL (MCP) | One scheduled job | **The strongest switch we have.** Every background behavior in this build is reachable only via a cron job, so unscheduling it stops that behavior dead without a deploy. |
| `app_config.status` → `'maintenance'` / `'killed'` | `app_config` row (id=1) | **Whole app** | Blunt instrument. Read by `appStatusService.getAppStatus`. Use only for a genuine emergency. |
| `app_config.min_supported_version` | `app_config` row | Whole fleet | Forces an update. See §4. |
| Term columns left `NULL` | `pay_arrangements` | Per household | Every new pricing rule is **null-gated** — see §3. This is the real per-household "flag" for money behavior. |
| Server deploy revert | Fly/host | Whole API | Always available, but **read §5 first** — the deploy order is not symmetric with the migration order. |

**There is no generic feature-flag table.** `app_config` carries exactly
`min_supported_version`, `latest_version`, `ios_store_url`,
`android_store_url`, `status`, `maintenance_message`, `announcements`,
`beta_all_pro`. Nothing else. Do not write a runbook step that assumes a flag
that does not exist.

---

## §2 Scheduled jobs — the primary kill switches

Live in prod today (verified 2026-08-12 after Phase 6 apply of 088/089/090):

```
cancellation-pay-reconcile   25 * * * *
cover-ask-expiry             3-58/5 * * * *
integrity-checks             10 4 * * *
no-show-digest               50 * * * *
no-show-sweep                */10 * * * *
reminders-hourly             5 * * * *
schedule-horizon             0 3 * * *
shift-completion             40 3 * * *
uncovered-digest             35 * * * *
```

**New in this build** (migrations 088, 089, 090 — now applied):

| Job | Migration | Schedule | Risk it carries | Kill switch |
|---|---|---|---|---|
| `cover-ask-expiry` | 088 | `3-58/5 * * * *` | D-22/D-47. Expires unanswered cover asks by writing `status='cancelled'`, `cancelled_by=null`. A bug here **mass-cancels shifts**. Highest-blast-radius new job. | `select cron.unschedule('cover-ask-expiry');` |
| `shift-completion` | 089 | nightly 03:40 | D-24/S2. Batch-writes `completed` on past confirmed shifts. Wrong window = wrong statuses at scale. | `select cron.unschedule('shift-completion');` |
| `no-show-digest` | 090 | `50 * * * *` (job window still `[07:00,10:00)`) | D-26/A1. Morning "you may have missed this" digest. Worst case is push noise, not data damage. | `select cron.unschedule('no-show-digest');` |

**Not yet applied — repo-only as of this section (migration 105, WP-J1/J2):**

| Job | Migration | Schedule | Risk it carries | Kill switch |
|---|---|---|---|---|
| `job-health` | 105 | daily 06:15 | J1-b/S2. Read-only — reads `job_runs` and `net._http_response` (via `public.job_http_failures()`), writes nothing. Worst case is a noisy or missing alert, never data damage. **Two switches, softest first:** unset both `OPS_ALERT_EMAILS` and `OPS_ALERT_USER_IDS` (env; needs a redeploy to take effect) to silence alerting while the job keeps recording its findings in `job_runs.summary` — only unschedule it outright if the job itself is the problem (e.g. `job_http_failures()` running expensive against a large `net._http_response`). | `select cron.unschedule('job-health');` |

Verify names against reality before trusting this table — migration 054's
header records that 047/048 once sat in-repo unapplied:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

**Re-enable** by re-running the migration's `cron.schedule(...)` block, not by
hand-editing `cron.job`.

### A note on `shift_events` retention (S8)

Migration 088 also introduces a **90-day windowed DELETE** over an allowlist
(`uncovered_care`, `pattern_conflict`). This is the one irreversible data
operation in the build — deleted rows do not come back.

- The allowlist is load-bearing: it must stay an allowlist so thread and
  dispute rows are structurally undeletable.
- **Mitigation is preventive, not corrective.** If the allowlist is ever
  widened, that change needs its own review. There is no undo.
- If you suspect over-deletion, unschedule the owning job first, then assess.

---

## §3 Money behavior — null-gated, per household

Every new pricing rule was built so that **absent terms reproduce the old
engine exactly**. That is the rollback: clear the term, and the household
prices as it did before this build. Verified by the engine's own case table
(nulls reproduce pre-078 behavior byte-identically).

| Behavior | Gate | To disable for a household |
|---|---|---|
| Daily overtime | `overtime_daily_threshold_minutes` null | New arrangement row with the column null |
| Double time | `doubletime_multiplier` null | Same |
| Seventh-day rules | seventh-day multiplier null | Same |
| Worked-holiday premium | `worked_holiday_multiplier` — emission gates on `> 1` | Set to null / 1 |
| Unworked paid-holiday credit | `holiday_hours_minutes` null (D-53) | Set null |
| Pay frequency / pay day | Presentation only (T7/D-17) | Cosmetic; engine ignores it entirely |

**Because arrangements are append-only, "clearing" a term is a NEW row, never
an edit.** That is the house discipline and it is also what makes this
reversible without a migration.

**Caveat — frozen weeks do not un-freeze.** A week already approved carries a
frozen `earnings` snapshot. Changing terms afterwards does not, and must not,
retroactively change it. Rolling a term back only affects weeks not yet
approved.

---

## §4 Client compatibility / `min_supported_version`

`min_supported_version` is **NULL in prod today**, and
`appStatusService.getAppStatus` reads it as `?? '0.0.0'` — so no client is
ever forced to update.

**Posture (recommended): pin `min_supported_version` to the first store
build's version at release.**

This is safe here in a way it normally would not be, because **the app has
never launched — the shipped fleet is the empty set** (owner-confirmed
2026-08-12; the 7 households in prod are the owner's own test data, and D-9
wipes them before release). Pinning at release closes, in one move, every
wire change this build makes that an older client could not parse:

- signed `amount_minor` (payment correction rows, 085)
- open `kind` string on earnings lines (1-A)
- nullable `households.name` (draft households, 093)
- `candidate` membership status (D-49, 093)
- widened notification-prefs enum
- new push types (registry is now 55)

**The rule that must not be broken:** a `v: 2` snapshot WRITER may not ship
until the tolerant reader is in the fleet. 1-A shipped the reader
(`v` absent = 1, literal `1` accepted, `v: 2` refused loudly). Nothing in this
build writes `v: 2`. Keep it that way until a release that pins
`min_supported_version` at or above the reader's version.

---

## §5 Deploy ordering — asymmetric, get it right

**This is the one ordering that will take the API down if reversed.**

Migration 088 carries DDL, and `shiftRepository.ts` writes
`cover_ask_expires_at` **unconditionally** on shift creation. So:

> Deploy the server BEFORE applying 088 and **every shift creation 500s** —
> not just cover asks.

**Correct order:**

1. Apply migrations `074 → 096` in order, via the Supabase MCP (never
   `supabase db push` — the version-scheme mismatch makes it dangerous here).
2. Verify applied-migrations list **and** `cron.job` contents.
3. Then deploy the server.

Also apply `077` before deploying the payment service — it calls that RPC.

### Migration 101 — multi-block pattern days — APPLIED 2026-08-17

`101_schedule_pattern_multi_block_days.sql` dropped
`schedule_pattern_days_pattern_weekday_idx` (unique on `pattern_id, weekday`)
and replaced it with a unique index on `(pattern_id, weekday, start_time)`, so
a "usual week" can hold two blocks on one day (Mon 07:00-13:00 **and**
15:00-17:00).

**Applied to prod 2026-08-17**, recorded as `20260817180427`, via the Supabase
MCP. Verified after applying: the old index is gone, the new one exists with
the three-column definition.

**The DB is now ahead of the deployed API, which is the safe direction.** An
old server against the new schema simply never writes a second block — its Zod
rule (`ReplaceSchedulePatternDaysSchema`) is *stricter* than the index. The
dangerous pairing is the reverse: deploying the new API against the OLD schema
would 500 on the old unique index the moment a parent sends a two-block week.
Since the migration is already in, that window is closed — **just don't roll
the database back under a deployed new API.**

**Rollback status — safe today, lossy later.** At apply time
`schedule_pattern_days` held **zero rows** (0 patterns, 0 recurring shifts), so
restoring the old unique index right now costs nothing. That stops being true
the moment the first two-block week is sent: from then on, recreating
`(pattern_id, weekday)` as UNIQUE fails with a duplicate-key error unless you
first delete every block after the earliest on each weekday — which cascades
away its `schedule_pattern_day_children` rows, and strands the shifts already
materialised from the deleted blocks (the next `scheduleHorizonJob` run sees
them as orphans and cancels/deletes them: a second, separate blast radius).

**So the real rollback remains "revert the app code and leave the index
alone."** 101's own header carries the full two-step SQL and the same warning.

### Migration 102 — paid-week guards — NOT YET APPLIED

`102_paid_week_guards.sql` closes `docs/AS-BUILT-PAYMENT.md` §7 P1/P2/P8 in
one file: an `idempotency_key` on `payments` with a PARTIAL unique index,
`record_timesheet_payment` re-issued with a sixth defaulted parameter,
`timesheets.hours_changed_after_payment_at`, the new
`roll_up_timesheet_hours` RPC, the `timesheets_refuse_reopen_when_paid`
trigger, and the `timesheets_approved_has_snapshot` CHECK.

**Deploy order: MIGRATION FIRST, then the API.** The API's roll-up calls
`roll_up_timesheet_hours`, so deploying the server against the old schema
makes **every clock-out 500** — the same shape as 088's trap, and worse,
because a clock-out is the one write this codebase has said repeatedly must
never fail. Everything else in 102 is invisible to the old server: a defaulted
sixth parameter it does not send, two nullable columns it does not read, a
trigger that only fires on a reopen of a week with payments (which the old
server should have been refused on anyway), and a CHECK the old approve path
already satisfies.

**PRE-FLIGHT, and it is not optional.** Both constraints are added WITHOUT
`not valid`, so they validate every existing row:

```sql
select count(*) from public.timesheets where status = 'approved'
  and (gross_minor is null or currency is null
       or earnings is null or earnings_computed_at is null);   -- must be 0
select count(*) from public.payments;                          -- 0 at time of writing
```

If the first is ever non-zero the migration FAILS at apply time. Add the
constraint `not valid`, repair the rows, then `validate constraint`. **Do not
relax the CHECK to fit the data** — an approved week without its frozen
snapshot is a number somebody gets paid against.

**Rollback — safe today, and the ORDER matters.** Revert the API first (it is
the only caller of `roll_up_timesheet_hours`), then, per 102's header:

```sql
drop trigger if exists timesheets_refuse_reopen_when_paid on public.timesheets;
drop function if exists public.timesheets_refuse_reopen_when_paid();
alter table public.timesheets drop constraint if exists timesheets_approved_has_snapshot;
drop function if exists public.roll_up_timesheet_hours(uuid, integer);
drop index if exists public.payments_idempotency_key_uidx;
alter table public.payments drop column if exists idempotency_key;
alter table public.timesheets drop column if exists hours_changed_after_payment_at;
drop function if exists public.record_timesheet_payment(uuid, integer, date, text, uuid, text);
-- then re-run 085's record_timesheet_payment block verbatim.
```

That last pair is the D46 trap in reverse: 102 **dropped** 077/085's five-arg
signature before re-issuing, so rolling back means dropping the SIX-arg
function and restoring the five-arg one. Skipping the drop leaves two live
overloads, and PostgREST will pick whichever matches the body it is sent.

**Dropping `hours_changed_after_payment_at` is lossy** the moment any week has
worn it: the flag is the ONLY record that a paid week's approved total stopped
covering every hour worked (the append-only `shift_events` thread does not
carry it). Today that is zero weeks. Older clients tolerate both new fields
because `TimesheetSchema.hours_changed_after_payment_at` and
`CreatePaymentSchema.idempotency_key` are both optional.

### Migrations 103 / 104 — shift read scope + schedule invariants — NOT YET APPLIED

Two migrations, two very different rollback profiles. **Read this before
applying either.**

#### 103 — `shift_read_scope.sql` — cheap to roll back, but ORDER MATTERS

Replaces the SELECT policies on `shifts`, `shift_children`,
`shift_change_requests` and `shift_events` so parents read household-wide and
a carer reads only her own rows. No data is touched; every statement is
idempotent.

**Rollback is a policy re-issue from 040**, and 040's text is the source:

```sql
drop policy if exists "Parents and the assigned carer can view shifts" on public.shifts;
create policy "Members can view shifts" on public.shifts
  for select using (private.can_read_household(household_id));

drop policy if exists "Parents and the assigned carer can view shift children" on public.shift_children;
create policy "Members can view shift children" on public.shift_children
  for select using (
    exists (select 1 from public.shifts s
             where s.id = shift_id and private.can_read_household(s.household_id))
  );

drop policy if exists "Parents and the assigned carer can view change requests" on public.shift_change_requests;
create policy "Members can view change requests" on public.shift_change_requests
  for select using (
    exists (select 1 from public.shifts s
             where s.id = shift_id and private.can_read_household(s.household_id))
  );

drop policy if exists "Parents, the actor and the carer can view the day thread" on public.shift_events;
create policy "Members can view day thread" on public.shift_events
  for select using (private.can_read_household(household_id));
```

**DEPLOY ORDER, and it is the opposite of §5's usual rule.** The service half
(`shiftQueryService.assertShiftReader`) narrows *identically* to the policy, so
the two are safe in either order — but only because the API runs as the service
role and bypasses RLS entirely. **Apply the migration and deploy the server
together.** Applying 103 alone leaves the hole open for anyone driving
PostgREST with the bundled anon key; deploying the server alone is harmless but
buys nothing at the door.

**Rolling BACK the app without rolling back 103 is the safe direction** — the
policy is stricter than the old service, and nothing in the app reads shifts
through PostgREST.

#### 104 — `schedule_invariants.sql` — the ALTER can BLOCK the deploy

One unique index on `schedule_patterns`, two on `shifts`, and one exclusion
constraint. **An exclusion constraint has no `NOT VALID` form**, so a
pre-existing overlapping pair fails the ALTER outright and stops the deploy
mid-migration. Run 104's header pre-flight SELECTs *before* the deploy window,
not during it. Prod was verified at **0 live shifts, 0 accepted-pattern
duplicates, 0 overlaps** when this was written — re-verify, that number is a
snapshot.

**Rollback is four drops, and it is completely lossless** (no rows are
rewritten, only refused):

```sql
alter table public.shifts drop constraint if exists shifts_carer_window_excl;
drop index if exists public.shifts_parent_cover_window_unique;
drop index if exists public.shifts_cover_window_unique;
drop index if exists public.schedule_patterns_one_accepted_idx;
```

Leave `btree_gist` alone — 055 installed it and `time_entries`' two exclusion
constraints depend on it.

**The kill switch, if 104 turns out to refuse legitimate bookings**, is the
exclusion constraint alone: dropping `shifts_carer_window_excl` restores the
old permissive behaviour without touching the three dedupe indexes, which are
strictly narrower guards of the shape 059/062 already shipped. Drop it first
and ask questions after — the app degrades to "warns, never blocks", which is
where it was.

**A server rollback under 104 is SAFE but noisier.** An old server does not
know `ShiftOverlapsError`, so a refused write surfaces as a 500 instead of a
409 and `scheduleMaterialisationService` fails the horizon run for that pattern
rather than recording a `pattern_conflict` and continuing. Prefer dropping the
constraint to rolling the server back.

### Migration 106 — invite pay-offer promotion outcome — NOT YET APPLIED

`106_invite_pay_offer_promotion.sql` adds a nullable `pay_offer_promotion` text
column to `household_invites`, CHECKed against
`promoted | skipped_open_round | skipped_stale | skipped_no_inviter | failed`.
It records the outcome of the best-effort offer-to-proposal promotion that
already runs on invite redemption (`householdCommandService.
promoteOfferToProposal`, §5 of `AS-BUILT-PAY-TERMS.md`) — no behavior change,
the promotion still swallows every failure and lets the join stand. This is
observability catching up to a write path that already existed.

Alongside it, a new push notification type, `PAY_OFFER_NOT_PROMOTED`, fires to
the inviting parent when the outcome is `failed` or `skipped_stale`.

**Deploy order is not load-bearing.** The column is nullable with no default
dependency and no other column reads it; the old server simply never writes it
and never sends the new push. Either order is safe; migration-first is still
the house default (§5's opening rule).

**Rollback is trivial:**

```sql
alter table public.household_invites drop column if exists pay_offer_promotion;
```

Nullable, no backfill, nothing else in the schema references it — dropping it
loses only the promotion-outcome record, not the promotion itself. The push
type is additive to `shared-types` (a new enum member, not a shape change), so
removing `PAY_OFFER_NOT_PROMOTED` from the client is equally low-risk: an old
client that has never heard of it already ignores unknown push types.

---

## §6 Behavior changes with NO switch

Honest list. These cannot be turned off without a corrective migration or a
server revert. Know them before you ship.

| Change | Why there is no switch | If it goes wrong |
|---|---|---|
| Payroll read-scope tightening (D-21, 087) | RLS + service gates, forward-only. Helper loses payroll access; a nanny is forced to own-scope. | Corrective migration. **Fails closed** — the failure mode is "someone cannot see data", never "someone sees too much". That is the right direction to fail. |
| Cover-ask `pending` no longer counts as covering (S1/D-22) | Pure service logic in the uncovered computation. | Server revert. Expect **more** uncovered alarms than before — that is the intended behavior, not a regression. |
| One cancellation window (D-48) | Household short-notice readers removed from the cancellation path. No-arrangement now means NOT paid — **stricter** than the old household fallback. | Server revert. Watch for disputes about unpaid late cancellations in week 1. |
| Sick time-off auto-opens cancel requests (D-23/S10) | Service logic. | Server revert. Worst case is a burst of change requests. |
| `week_below_guarantee` REPLACES `timesheet_approved` | One act, one push (A8 discipline). | Older clients fall back to the route-map default on an unknown type — a silent no-op tap, not a crash. |
| `schedule_not_set` push (parent, group `schedule`, **not** quiet-hours exempt) | Emitted inside `reminderJob` at local 09:00, not by a job of its own. `cron.unschedule('reminders-hourly')` would also kill shift reminders and the timesheet-approval nudge, so §2's strongest switch is unavailable here. Server revert is the only lever. | Worst case is push noise, **once ever** per relationship: `buildScheduleNotSetKey` (`reminderJob.ts:314`) is undated (`schedule_not_set:<householdId>:<carerId>`), so the ledger caps it at one send however many mornings pass. Fires only when the household is live, an active nanny has a current arrangement ≥1 day old, and **no** pattern has ever existed for that carer in any status — an abandoned `draft` suppresses it forever, deliberately. Older clients fall back to the route-map default on an unknown type — a silent no-op tap, not a crash. |
| Query supersede / withdraw-query exit (D-19) | Status machine change. | Server revert. |
| Paid-week guards (migration 102) | Trigger + CHECK + a new RPC on the write path. No job, no push, no flag. A parent whose week has payments simply cannot reopen it. | Revert the API first (sole caller of `roll_up_timesheet_hours`), then run 102's rollback block in §5 — including restoring 085's five-arg `record_timesheet_payment`. Older clients tolerate the two new optional wire fields. |
| Timesheet `parent_viewed_at` receipt (migration 100) | Column + own `updated_at` trigger on `timesheets`. No job, no push, no flag. | Drop the trigger, recreate 017's `set_timesheets_updated_at` using `public.set_updated_at()`, then drop the column. Older clients tolerate the missing field because `TimesheetSchema.parent_viewed_at` is optional. **Never** edit the shared `public.set_updated_at` as a rollback shortcut. |

---

## §7 Post-ship watch — adjusted for no Sentry

§11 of the playbook assumes Sentry triage at +24/48/72h. **Sentry reporting is
disabled via Expo secrets for this release** (owner decision, 2026-08-12), so
that watch cannot be armed as written. Substitute signals, in priority order:

1. **`integrity-checks` cron** (nightly 04:10) — already live, already the
   best automated correctness signal in the system. Read its output first.
   A clean `run_integrity_checks()` covers the money invariants.
2. **API logs** (`apps/api/logs/dev.log` locally; host logs in prod) — watch
   for 4xx spikes on the new endpoints and any 500 on shift creation (the §5
   ordering failure signature).
3. **PostHog funnel events** (D-39): `draft_created` → `terms_shared` →
   `link_opened` → `code_redeemed` → `proposal_viewed` → `proposal_countered`
   → `proposal_accepted` → `first_week_approved`. A funnel that dies at
   `proposal_accepted` is the candidate-activation failure mode (§8).
4. **`cron.job` contents + `job_runs`** — confirm the three new jobs actually
   ran, and how many rows each touched. A cover-ask-expiry run cancelling an
   implausible number of shifts is the alarm to act on.
5. Correction-row usage and cover-ask expiry volumes, per §11.

---

## §8 Defects found during Phase 5 that this runbook assumes are fixed

- **Candidate activation was a no-op in production.**
  `TermsProposalCommandService`'s `candidates` dependency defaulted to `null`
  and the production singleton used the default, so `activateCandidate` never
  ran outside tests. Every nanny-first / absorption acceptance would have
  failed at `assertActiveNanny`. Fixed in Phase 5 (the code's own TODO
  prescribed the fix). **If nanny-first acceptance fails in prod, check this
  first.**
- **Nanny-first onboarding dead-ended** on a route that did not exist
  (`/onboarding/terms`). Fixed in Phase 5.

---

## §9 Open concurrency risks (accepted, not fixed)

Raised by the Phase 5 money-path trace, ranked. Neither is a launch blocker at
current scale (single-digit households, one parent acting at a time), and both
need a DB function or transaction — a change too large to make safely during a
freeze. Recorded here so the first person to see the symptom knows the cause.

1. **Duplicate arrangements on concurrent proposal accept.** Two parents
   accepting the same proposal simultaneously can both pass the answerable
   check and both insert a `pay_arrangements` row — the table deliberately has
   no unique constraint on `(household_id, carer_id, valid_from)`. One
   `resolve` wins; the loser's arrangement is orphaned. **Symptom:** a
   duplicate row in terms history at the same `valid_from`. **Why it is
   survivable:** `effectiveOn`'s `created_at desc` tie-break still returns
   exactly one row, so pricing stays deterministic. **Real fix:** a DB
   function holding the proposal row `FOR UPDATE`, mirroring 077's shape.
2. **Reimbursement settlement sum/insert not atomic.** The approved-expense
   sum and the settlement insert are separate statements with no `FOR UPDATE`
   (unlike the payment ceiling in 077). The unique index still guarantees one
   settlement row, but its `amount_minor` is fixed at read time, so expenses
   approved in the gap are left out of it. **Same class as P5.**

   **CORRECTION (2026-08-12, David persona gate) — the sentence above used to
   read "can disagree with the card", and that materially understated it.**
   The card never shows `amount_minor` at all, so there is nothing for it to
   visibly disagree with. `ParentWeekView.tsx:617-618` reads only
   `?.settled_at` off the settlement row and pairs that DATE with a **live**
   total from `earnings.reimbursements_minor`, then asserts one repaid the
   other. Two different sources, never compared. So the failure is not a
   visible mismatch a parent could question — it is **silent, permanent and
   unremediable**: £30 approved, a settlement that captured only £24.60, a
   card reading "Total to reimburse £30.00 / Reimbursed on 12 August", and the
   £5.40 dropped from the owed list forever, because
   `reimbursementSettlementService.listUnsettled` suppresses on the EXISTENCE
   of a settlement row and never on its amount. `086` deliberately gives that
   table no correction path.

   **The cheap mitigation is a label, not a transaction.** Rendering the
   settled amount beside the date — "Reimbursed £24.60 on 12 August" under
   "Total to reimburse £30.00" — makes the race visible the moment it happens,
   which is all a ledger has to do. That is a far smaller change than the
   `FOR UPDATE` function and is what makes accepting this race defensible
   rather than merely cheap. Until it ships, use the detection query in
   `docs/POST-SHIP-WATCH.md` §6b — the drift is invisible in the product but
   it IS detectable in SQL.

   Related, and pointed the other way: `NannyWeekView.tsx:587` renders
   `ReimbursementsCard` but never passes `settledOn`, so the carer's card reads
   "not reimbursed yet" permanently after she has been paid back. The prop
   exists and the card is built to use it — the "supplied by the PARENT view
   only" note in that file attaches to `onMarkReimbursedPress`, not to
   `settledOn`.

---

## §10 Emergency sequence

If something is actively wrong in prod and you do not yet know what:

1. `select jobname, schedule, active from cron.job;` — unschedule the
   suspect job. This stops most blast radius without a deploy.
2. `select * from run_integrity_checks();` — is the money still consistent?
3. If money is inconsistent, **stop writes before investigating**:
   `app_config.status = 'maintenance'`.
4. Revert the server deploy only after confirming the migrations do not need
   to go with it (§5 — they cannot come back).
5. Never hand-edit a money table. Corrections are new rows (D-20), always.
