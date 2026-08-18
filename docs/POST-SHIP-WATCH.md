# POST-SHIP-WATCH.md

Armed 2026-08-12 (Phase 6). The playbook's §11 watch, made runnable.

**Read `docs/ROLLBACK-RUNBOOK.md` §10 first if something is actively wrong.**
This file is for *looking*; that one is for *acting*.

## Why this file exists instead of Sentry queries

§11 of `TRUST-AND-TERMS-PLAYBOOK.md` says "Sentry triage checks at +24h, +48h,
+72h". **Sentry reporting is disabled for this release** (D-58, owner, via Expo
secrets), and `EXPO_PUBLIC_SENTRY_DSN` in `apps/mobile/eas.json`'s production
profile is still the literal string `TODO-SET-BEFORE-BUILD`. So every check
below reads a signal that is *actually being collected*. A watch plan naming a
signal nobody collects is worse than one naming only the signals that exist.

Run the whole file at **+24h, +48h, +72h**. It is short on purpose — each
check has a stated "what bad looks like", because a number with no threshold
is not a check.

Project ref: `dylhrlvfkibipdkguptz` · Cloud Run: `nanny-api` in
`northamerica-northeast1`, project `steadily-nanny`.

---

## 2026-08-17 audit sizing

Prod facts as of 2026-08-17:
- 0 payments
- 0 timesheets
- 0 live shifts
- 1 `pay_arrangements` row (the F1 orphan)
- 9 crons all healthy
- `net._http_response` held 132 rows for 7d vs 2400+ `job_runs` (short retention → `job_runs` is the primary signal)

---

## 1. Integrity checks — the money invariants (do this one first)

The nightly `integrity-checks` cron (04:10 UTC) already runs
`run_integrity_checks()`. It is the best automated correctness signal in the
system. Read it before anything else.

```sql
select * from run_integrity_checks();
```

**Good:** zero rows, or every row's count `0`.
**Bad:** any non-zero violation count. That is a money-consistency failure —
go to `ROLLBACK-RUNBOOK.md` §10 step 3 and stop writes before investigating.

Confirm the cron actually ran, rather than assuming — **and the premise below
was itself wrong until this correction. Read it before trusting either query.**

> **CORRECTED 2026-08-17 (S2 audit).** The 2026-08-14 correction above this
> line claimed `integrity-checks` is "a pure SQL cron that calls
> `run_integrity_checks()` directly" and therefore has zero rows in `job_runs`
> "by design, forever". **That claim is false, and `057_integrity_checks_cron.sql:64-75`
> contradicts it in the same repo:** the cron body is
> `SELECT net.http_post(url := … || '/api/jobs/integrity-checks', …)` — the
> exact same shape as every other job cron. `/api/jobs/integrity-checks` is
> wired to `JobController.runIntegrityChecks`, which IS
> `createTrackedJobHandler`, the same factory every other job uses. It writes
> `job_runs` like everything else. The "zero rows" observation on 2026-08-14
> was real, but the explanation for it was wrong — treat any future absence of
> `integrity-checks` rows in `job_runs` as a genuine finding, not an expected
> shape.
>
> **The deeper premise error (S2, `docs/AS-BUILT-SCHEDULE.md` §6 S2):**
> `cron.job_run_details.status = 'succeeded'` — the signal the query below
> reads — proves only that **pg_net accepted the enqueue**. pg_net is
> asynchronous: the actual HTTP call it fires happens out-of-band, and its
> result lands in `net._http_response`, a table **nothing in this repo reads**
> (verified — zero call sites). A rotated Vault key (401), a 500 from the API,
> and a dead Cloud Run revision are all **indistinguishable from success** in
> `cron.job_run_details`. `job_runs` — written by `createTrackedJobHandler` — is
> the only signal that reflects what the job actually did, for every job
> registered through it (all ten, including `integrity-checks` as corrected
> above). Read `job_runs` FIRST; treat `cron.job_run_details` as "did the
> scheduler fire", never as "did the job succeed".

```sql
-- Did the scheduler fire at all — proves enqueue only, NOT job success
-- (see the correction above). Use alongside job_runs, never instead of it.
select j.jobname, j.schedule, j.active,
       max(d.start_time)                                     as last_fire,
       (array_agg(d.status ORDER BY d.start_time DESC))[1]   as last_status,
       (array_agg(d.return_message ORDER BY d.start_time DESC))[1] as last_msg
from cron.job j
left join cron.job_run_details d on d.jobid = j.jobid
group by j.jobid, j.jobname, j.schedule, j.active
order by j.jobname;
```

**Good:** every job `active = true`, `last_fire` within its own schedule's
period, `last_status = 'succeeded'`.
**Bad:** `last_status = 'failed'`, or a `last_fire` older than the schedule
implies. **Not sufficient on its own either way** — see the two queries below.

`job_runs` is the right table for every job registered through
`createTrackedJobHandler` — `schedule-horizon`, `reminders`,
`integrity-checks`, `no-show-sweep`, `cover-ask-expiry`, `shift-completion`,
`uncovered-digest`, `cancellation-pay-reconcile`, `no-show-digest`, and
`job-health` (below) — which as corrected above is all ten registered jobs,
not a subset. That is where §2's volume query gets its counts.

`docs/AS-BUILT-SCHEDULE.md` §6 S2's two settling queries, run together:

```sql
-- 1. What job_runs itself says, per job, over the last week.
select job_name, max(started_at), count(*) from job_runs
where started_at > now() - interval '7 days' group by job_name;

-- 2. What pg_net itself saw at the HTTP layer, independent of job_runs —
-- this is the ONLY way to catch a call that never reached the API at all
-- (rotated key, network failure, dead deploy), because that case never
-- creates a job_runs row in the first place.
select status_code, count(*) from net._http_response
where created > now() - interval '7 days' group by status_code;
```

### The automated version of this check: `job-health`

As of migration `105_job_health_cron.sql` (J1-b), a tenth job —
`job-health` — runs this same comparison daily at 06:15 UTC so it does not
depend on a human running this file. It reads (i) `job_runs` for every
registered job's own recorded outcome, keyed to that job's expected cadence,
and (ii) `net._http_response` via `public.job_http_failures()`, for exactly
the "never reached the API" case query 2 above exists to catch. When either
signal is unhealthy it sends one email to `OPS_ALERT_EMAILS` and one push per
id in `OPS_ALERT_USER_IDS` (both optional env vars — unconfigured means the
finding is still recorded in `job_runs.summary`, just not alerted on; see
`apps/api/.env.example`). This does not replace this file — a human doing the
+24h/+48h/+72h read still catches things a fixed cadence table cannot (a
cron that fires on schedule but does obviously wrong work, for instance) —
but it means a fully dead job is no longer silent between watches.

---

## 2. The three NEW cron jobs actually ran (the 054 lesson)

Migrations 088/089/090 add three jobs. Migration 054's header records that
047/048 once sat in-repo unapplied — so verify live state, never assume.

```sql
select jobid, jobname, schedule, active
from cron.job
order by jobid;
```

**Good:** ten jobs active — the six that predate this release
(`schedule-horizon`, `reminders-hourly`, `cancellation-pay-reconcile`,
`integrity-checks`, `no-show-sweep`, `uncovered-digest`) plus
`cover-ask-expiry` (*/5), `shift-completion` (03:40) and `no-show-digest`,
plus `job-health` (06:15, migration 105 — J1-b).
**Bad:** fewer than ten, or any `active = false`.
**Verified live 2026-08-14:** all nine jobs registered at that time present
and `active`, every one `succeeded` on its last fire. `job-health` is new
since and has not yet had its own live watch entry — confirm it the same way
the first time this file is run after 105 is applied.

> **Name mismatch between the two tables — do not read it as a missing job.**
> `cron.job` calls it **`reminders-hourly`**; `job_runs` records it as
> **`reminders`**. They are the same job. Match on intent, not on string
> equality, when comparing the two queries below.

Then their volumes — this is where a runaway shows up:

```sql
select job_name,
       count(*)                     as runs,
       max(started_at)              as last_run,
       sum(total_processed)         as processed,
       sum(error_count)             as errors,
       max(duration_ms)             as slowest_ms
from job_runs
where started_at > now() - interval '24 hours'
group by job_name
order by job_name;
```

**Bad, specifically:**
- `cover-ask-expiry` cancelling an implausible number of shifts. It runs every
  5 minutes (288×/day), so `runs` near 288 with `processed` near 0 is the
  HEALTHY shape. A large `processed` means it is expiring asks in bulk —
  highest blast radius in the release. Kill switch:
  `select cron.unschedule('cover-ask-expiry');`
- `shift-completion` processing far more than the day's confirmed past shifts.
- any `errors > 0`.

---

## 3. Cover-ask expiry volumes (S1 / D-22 / D-47)

The behavior change with the widest reach: a `pending` cover ask no longer
counts as covering, and asks now expire at `min(48h, start − 4h)`, 1h floor.
Expiry writes `status='cancelled'` with `cancelled_by = null` — **null actor on
a cancelled shift is the expired discriminator** (no new enum value was added,
deliberately, to avoid the §2.5 wire-enum fleet risk).

```sql
select date_trunc('day', updated_at) as day,
       count(*) as expired_asks
from shifts
where status = 'cancelled'
  and cancelled_by is null
  and updated_at > now() - interval '7 days'
group by 1
order by 1 desc;
```

**Expected at launch scale:** single digits per day, or zero.
**Bad:** a spike, or expiries clustered within minutes of each other (suggests
the sweep is expiring asks whose `cover_ask_expires_at` was computed wrong at
ask time rather than one-at-a-time as deadlines pass).

Sanity-check that the column is being populated at all — `shiftRepository`
writes it **unconditionally** on shift creation:

```sql
select count(*) filter (where cover_ask_expires_at is not null) as with_expiry,
       count(*)                                                as total
from shifts
where created_at > now() - interval '24 hours';
```

**Bad:** `with_expiry = 0` while `total > 0` on cover asks — and if EVERY
shift creation is failing, see §5's 500 check: that is the runbook §5
deploy-ordering signature.

---

## 4. `unreadable_snapshot` degradations (T3 / §2.5)

A frozen `earnings` jsonb that fails `WeekEarningsSchema` degrades the week to
hours-only **silently and permanently**. The server logs it at `error` level
with the message `Frozen earnings snapshot unreadable`
(`timesheetQueryService.ts`). That log line's own comment says it
"auto-forwards to Sentry via the transport" — **which D-58 disabled**, so the
only place it surfaces now is Cloud Run logs:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="nanny-api"
   AND jsonPayload.message="Frozen earnings snapshot unreadable"' \
  --project steadily-nanny --freshness=24h --limit=50
```

**Good:** no entries. **Bad:** any entry — each one is a week a nanny opened
to see what she is owed and got no figure. The payload carries `timesheetId`,
`householdId`, `weekStart` and the failing schema paths.

Direct DB cross-check, because a log you are not sure was emitted is not
evidence of absence:

```sql
select count(*)                                              as approved,
       count(*) filter (where earnings is null)              as null_snapshot,
       count(*) filter (where earnings ? 'v')                as has_version,
       count(*) filter (where not (earnings ? 'lines'))      as missing_lines
from timesheets
where status = 'approved';
```

**Good:** `missing_lines = 0`. Post-wipe, every newly approved week should have
`has_version` = the approved count (1-A stamps `v: 1`). `null_snapshot > 0`
would mean a pre-042 legacy week — impossible after the D-9 wipe, so a non-zero
value here is a real finding.

---

## 5. 4xx spikes on the new endpoints, and any 500 on shift creation

The 500 check is the one that matters most: per `ROLLBACK-RUNBOOK.md` §5,
deploying the server *before* migration 088 makes **every** shift creation 500,
not just cover asks.

```bash
# Any 5xx at all, newest first.
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="nanny-api"
   AND httpRequest.status>=500' \
  --project steadily-nanny --freshness=24h --limit=50
```

**Bad:** any 5xx on `POST /api/v1/households/*/shifts`. That is the ordering
failure — check `cover_ask_expires_at` exists on `shifts` before anything else.

```bash
# 4xx grouped by endpoint.
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="nanny-api"
   AND httpRequest.status>=400 AND httpRequest.status<500' \
  --project steadily-nanny --freshness=24h --limit=200 \
  --format='value(httpRequest.status, httpRequest.requestMethod, httpRequest.requestUrl)' \
  | sort | uniq -c | sort -rn | head -40
```

**Endpoints new in this release** — a 4xx cluster on any of them is a
first-contact bug, not a user error:

| Surface | Endpoint | Shipped by |
|---|---|---|
| Payment corrections | `POST /timesheets/:id/payments/:paymentId/corrections` | 085, D-20 |
| Reimbursement settlement | `GET,POST /households/:hid/reimbursement-settlements`, `GET …/unsettled` | 086, D-14 |
| Terms acknowledgment | `POST …/pay-arrangements/:aid/ack`, `/dissent`, `GET …/acks` | 081, D-31/D-45 |
| Scheduled terms change | `POST …/pay-arrangements/:aid/cancel-scheduled` | D-16 |
| Terms proposals | `GET,POST /terms-proposals`, `/current`, `POST /:id/accept`, `/viewed`, `/withdraw` | 092, D-33…D-39 |
| Nanny + year-end exports | `GET /households/:hid/timesheets/pay-summary.csv`, `/year-end.csv` | D-29, P12 |
| Query lifecycle | `POST /timesheets/:id/withdraw-query`, `GET /timesheets/:id/thread` | D-18/D-19 |

**Expected 403s are not bugs.** D-21 tightened payroll reads: a helper is now
denied payroll outright and a nanny is forced to her own scope. Per the
runbook §6 this **fails closed** — the failure mode is "someone cannot see
data", never "someone sees too much". A helper 403 on a timesheet endpoint is
the feature working.

---

## 6. Correction-row usage (P3 / D-20)

```sql
select kind, count(*), min(created_at) as first_seen, sum(amount_minor) as sum_minor
from payments
where created_at > now() - interval '7 days'
group by kind;
```

Paid-to-date is a **signed** sum, so corrections are negative-effect rows.
**Bad:** a `correction` row with no `corrects_payment_id`, or a correction
chain (D-20 is reversal-only — "correcting a correction is a new payment"):

```sql
select p.id, p.amount_minor, p.corrects_payment_id
from payments p
where p.kind = 'correction'
  and (p.corrects_payment_id is null
       or exists (select 1 from payments o
                  where o.id = p.corrects_payment_id and o.kind = 'correction'));
```

**Good:** zero rows.

---

## 6b. Reimbursement settlement drift (D-57 #2) — the one silent money failure

**Added 2026-08-12 after the David persona gate**, which found that the earlier
"this is not detectable" note was wrong. It is invisible **in the product** but
it is detectable **in SQL**, and those are different claims.

**CORRECTED 2026-08-17:** The premise that this failure is "invisible in the product" is now refuted. `expenses.json` carries `"stateSettled": "Reimbursed {{amount}} on {{date}}"`, and the card DOES render `amount_minor` (see `AS-BUILT-PAYMENT.md` §5). The race still exists and causes permanent, unremediable-in-product money loss, but it is now visible on screen rather than silent. `listUnsettled` still suppresses a week on the **existence** of a settlement row, never on its amount — so a short settlement drops the remainder out of the owed list permanently, and `086` gives that table no correction path.

```sql
-- Any settlement whose amount disagrees with the approved expenses it settled.
-- Dow-agnostic on purpose: bucketing with date_trunc('week', ...) would be
-- WRONG here because Postgres truncates to MONDAY while households.week_starts_on
-- is configurable (Sunday is the US default), so every Sunday-start household
-- would false-positive. Compare against the settlement's own [week_start, +7d).
select s.household_id, s.carer_id, s.week_start,
       s.amount_minor as settled_minor,
       coalesce((
         select sum(e.amount_minor) from expenses e
         where e.household_id = s.household_id
           and e.carer_id     = s.carer_id
           and e.status       = 'approved'
           and e.local_date  >= s.week_start
           and e.local_date   < s.week_start + 7
       ), 0) as approved_minor,
       coalesce((
         select sum(e.amount_minor) from expenses e
         where e.household_id = s.household_id
           and e.carer_id     = s.carer_id
           and e.status       = 'approved'
           and e.local_date  >= s.week_start
           and e.local_date   < s.week_start + 7
       ), 0) - s.amount_minor as unpaid_gap_minor
from reimbursement_settlements s
order by unpaid_gap_minor desc nulls last;
```

**Good:** zero rows. **Bad:** any positive `unpaid_gap_minor` — that is money a
carer is owed which no screen will ever show her again. Settle the remainder
manually and record it; do not hand-edit the settlement row (D-20: corrections
are new rows, always).

A negative gap is not a race — it means an approved expense was later rejected
or deleted after settlement, which is worth understanding but is not money owed.

---

## 7. Onboarding funnel conversion (D-39)

Eight PostHog events, `draft_created` → `first_week_approved`. Names are
authoritative in `apps/mobile/src/lib/analytics/events.ts`:

```
draft_created → terms_shared → link_opened → code_redeemed
  → proposal_viewed → proposal_countered → proposal_accepted
  → first_week_approved
```

`link_opened` is emitted by the **CF worker**, not the app (there is no
server-side PostHog) — it fires when the worker returns 200 for `/t/:code`,
before anyone signs in. If `link_opened` is flat while `terms_shared` is not,
suspect the worker's env vars rather than the app.

**The specific failure mode to look for:** a funnel that dies at
`proposal_accepted`. That is the candidate-activation defect
(`ROLLBACK-RUNBOOK.md` §8) — `TermsProposalCommandService`'s `candidates`
dependency defaulted to `null` in production, making `activateCandidate` a
silent no-op. It was fixed in Phase 5, and this is how we would learn the fix
did not hold.

Cross-check in SQL, independent of PostHog:

```sql
select
  (select count(*) from households where state = 'draft')     as draft_households,
  (select count(*) from terms_proposals)                      as proposals,
  (select count(*) from terms_proposals
     where status = 'accepted')                               as accepted,
  (select count(*) from household_members
     where status = 'candidate')                              as stuck_candidates;
```

Column shapes verified against the applied 092/093 chain:
`households.state ∈ {draft, live}` (093 — there is no `is_draft` boolean),
`terms_proposals.status ∈ {proposed, countered, accepted, withdrawn}` (092),
`household_members.status ∈ {active, removed, candidate}` (093).

**Bad:** `accepted > 0` while `stuck_candidates > 0` — that is precisely the
activation no-op resurfacing. The sharper version, which names the households:

```sql
select tp.household_id, tp.carer_id, tp.status as proposal_status, hm.status as membership
from terms_proposals tp
join household_members hm
  on hm.household_id = tp.household_id and hm.user_id = tp.carer_id
where tp.status = 'accepted' and hm.status = 'candidate';
```

**Good:** zero rows. Any row is a nanny whose terms were accepted but who is
still locked out of the household — D-49's fail-closed candidate visibility
doing its job over a broken activation.

---

## 8. Digest and no-show behavior in prod

Both are quiet-hours-sensitive and both changed:
- `shift_no_show` is now **quiet-hours exempt** (D-28), with a
  `shift_no_show_digest` morning sweep over [07:00, 10:00) that is
  deliberately NOT exempt.
- The timesheet nudge is capped at 3 consecutive daily sends, then weekly
  (D-27) — the row's own age carries the count, there is no new table.

`push_reminder_log`'s real columns are `user_id, reminder_key, sent_at,
confirmed_at` — there is no `type` or `created_at`. The dedupe key IS the
signal: it carries the type and, where date-segmented, the date.

```sql
-- Split the key into its type prefix and count sends per type.
select split_part(reminder_key, ':', 1) as reminder_type,
       count(*)                          as sent,
       count(distinct user_id)           as recipients,
       min(sent_at)                      as first_send,
       max(sent_at)                       as last_send
from push_reminder_log
where sent_at > now() - interval '48 hours'
group by 1
order by sent desc;
```

Then the D-27 nag cap specifically — the same user receiving a timesheet nudge
on more than 3 consecutive days means the cap is leaking:

```sql
select user_id, reminder_key, sent_at
from push_reminder_log
where sent_at > now() - interval '10 days'
  and reminder_key like 'timesheet%'
order by user_id, sent_at;
```

**Bad:** more than 3 consecutive daily rows per user before the weekly cadence
takes over. **Also bad:** any `shift_no_show_digest` key with a `sent_at`
outside 07:00–10:00 household-local (that window is deliberately NOT
quiet-hours exempt, unlike the immediate `shift_no_show`).

---

## 9. What is NOT being watched, and why

Say it plainly so nobody assumes coverage that does not exist:

- **Crash reporting: none.** Sentry is off (D-58). A JS crash on a user's
  device produces no signal anywhere. This is the single largest blind spot.
- **The two accepted concurrency defects (D-57)** — #2 now HAS a detection query (§6b, added after the persona gate); #1 does not. Symptoms are
  in `ROLLBACK-RUNBOOK.md` §9: a duplicate `pay_arrangements` row at the same
  `valid_from`, and a `reimbursement_settlements.amount_minor` that disagrees
  with the expenses it settled. Both need two actors racing within
  milliseconds, which is implausible at single-digit-household scale.
- **`terms_ack → week explainer` is not wired** (Phase 5, SEAM 3, accepted):
  the ack lives only in the pay domain by D-31/D-41 design.
- **Mobile app version adoption** is unmeasurable while
  `min_supported_version` is null and no store build exists.
