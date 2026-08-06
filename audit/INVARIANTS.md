I have what I need from the inventory, defect reports, verifications, and enforcement sites. Assembling the register as falsifiable properties only.

# Steadily Nanny — Invariant Register

Derived from A2, B1/B2/B4/B5 (+ verify), B10’s untested skeleton, `docs/11-MONEY.md`, and the live code/migrations. “Violated?” cites **confirmed** findings only; refuted claims (e.g. F-B2-2, F-B2-3, F-B4-4/5/9) are not treated as violations.

## Register

| # | Invariant (falsifiable statement) | Domain | Enforced where (code path:line / DB constraint / NOWHERE) | Test covering it (path:line or NONE) | Currently violated? (finding id) |
|---|---|---|---|---|---|
| I-01 | For any completed non-running `time_entries` row with both clocks set, `computeWorkedMinutes(clock_in, clock_out, break) = max(0, round((out−in)/60s) − break)`. | Hours | `workedMinutes.ts:28-31` | `timesheetCommandService.test.ts:173-192` (whole-hour only) | No |
| I-02 | After every successful roll-up for `(household, carer, week_start)`, `timesheets.total_minutes` equals `sumWorkedMinutes` over every completed entry whose `local_date` is in that week window as returned by `listForCarerWeek`. | Hours | `timesheetCommandService.ts:1166-1172` (derive-on-write); **NOWHERE** as a cross-table DB constraint | `timesheetCommandService.test.ts:195-241` (`sumWorkedMinutes` unit); no assert that persisted `total_minutes` = engine `worked_minutes` | No (logic intended); drift undetectable — B10#1 |
| I-03 | `WeekEarnings.worked_minutes` for a week equals `sumWorkedMinutes` of the same completed worked/`manual_adjustment` entries the engine received (same formula as roll-up). | Hours / Pay | Shared `workedMinutes.ts` imported by roll-up + `weekEarningsService`; **no** co-assertion | NONE (comment at `workedMinutes.ts:14-16`; never co-asserted — B10#1) | No known defect; **untested bridge** |
| I-04 | Running entries (`clock_out_at` null) contribute **0** to `timesheets.total_minutes` and to frozen/live `worked_minutes` / gross. | Hours / Pay | `workedMinutes.ts:44-46`; engine skips incomplete | `timesheetCommandService.test.ts` running→0 cases; engine empty/zero fixtures | No |
| I-05 | No two completed entries for the same carer have overlapping half-open clock intervals `[in,out)`. | Hours | App: `assertNoOverlap` `timesheetCommandService.ts:732-762` (same-week `local_date` only); **NOWHERE** in DB (no EXCLUDE/`btree_gist`) | Partial overlap tests in same week; **no** cross-Monday span test | **Yes — F-B1-1** |
| I-06 | Every minute of unique wall-clock work appears in at most one `(carer, week_start)` timesheet total. | Hours / Week filing | **NOWHERE** (relies on I-05 + week bucketing) | NONE | **Yes — F-B1-1** (60 min in two weeks) |
| I-07 | An entry’s `local_date` is always `coalesce(clock_in, clock_out, now) AT TIME ZONE entry.timezone` (DB trigger), and for clock-in / paid facts that feed payroll, `entry.timezone` equals **household.timezone** at write time. | Timezone | Trigger `017_time_tracking.sql:108-110`; clock-in stamps household `timesheetCommandService.ts:290`; **cancel path stamps `shift.timezone` at `:546`** | Cancel path only tests approved-week guard (`:1946-1990`), not week inclusion | **Yes — F-B1-2 / F-B2-1** |
| I-08 | `timesheets.week_start` for a roll-up equals Monday of the household-local calendar date of the triggering entry’s clock-in, and `listForCarerWeek` includes every payable entry that roll-up intended for that week. | Week filing | `weekStartOf` + `listForCarerWeek` `timesheetCommandService.ts:1160-1172`; filter `timeEntryRepository.ts:205-217` | Week-boundary reject tests exist; cancel orphan / TZ-change cases missing | **Yes — F-B1-2, F-B1-4** |
| I-09 | After a household timezone PATCH, every existing entry still appears in exactly one week total consistent with its frozen `local_date` (or entries are rewritten). | Timezone / Week | **NOWHERE** (roll-up re-derives week from current household TZ; `local_date` stays frozen) | NONE | **Yes — F-B1-4** |
| I-10 | Parent Hours / Nanny Hours week header minutes for carer C equal `sum` of C’s entries for that week, and the bound timesheet/earnings row is the unique `(household_id, carer_id, week_start)` row — never another carer’s. | Hours / UI | Schema unique `timesheets_household_carer_week_idx`; **UI/API week list unbound by carer** `timesheetQueryService.ts:87-99`, mobile `.find(week_start)` only | NONE for multi-carer binding | **Yes — F-B1-3** |
| I-11 | Mobile `computeWorkedMinutesFromInstants(in, outMs, break)` equals API `computeWorkedMinutes(in, outIso, break)` for every shared golden `(in, out, break)`. | Hours | **NOWHERE** (two formulas; order of round differs: API `round(elapsed)−break`, mobile `round(elapsed−break)`) | Separate unit tests; no shared golden — B10#6 | No confirmed cent bug; **parity unenforced** |
| I-12 | All stored wage/expense/rate amounts are integers (minor units); no SQL `real`/`double`/`numeric` money total columns. | Money storage | DB: `041`/`042`/`044` integer columns + `gross_minor >= 0`; Zod `z.int()` on wire | Migration string tests; schema tests | No (multiplier/miles are non-money numerics by design) |
| I-13 | Every amount-bearing row carries `currency char(3)` matching `^[A-Z]{3}$`. | Money storage | DB checks `041:82-83`, `042:94-95`, `044:114-115`; Zod regex | Migration + schema tests | No |
| I-14 | The only mobile `*100` / `/100` money conversions live in `apps/mobile/src/lib/money.ts`. | Money display | Guardrail test scans source | `noHandRolledMoneyDivision.test.ts:26+` | No |
| I-15 | `priceMinutes(m, r) = floor((2·m·r + 60) / 120)` (half-up per line); `gross_minor` = sum of rounded non-reimbursement line `amount_minor`s. | Rounding / Pay | `earningsService.ts:228-232`, `:747-758` | `earningsService.test.ts:1058-1070`, `:1176-1177` | No |
| I-16 | Overtime hourly rate = `floor((rate_minor · round(multiplier·100) + 50) / 100)` — never `rate * multiplier` in float. | Rounding / Pay | `earningsService.ts:264-266` | `earningsService.test.ts:1223+` (exhaustive table) | No |
| I-17 | Mileage: `priceMileage(miles, rate) = floor((2·round(miles·10)·rate + 10) / 20)`; 1.1 mi × 45p → 50p. | Expenses | `expenseCommandService.ts:143-146`, applied at approve `:315` | `expenseCommandService.test.ts:632+` | No |
| I-18 | Arrangement effective on date D = row with greatest `valid_from ≤ D`, ties `created_at desc`; **repo and in-engine implementations always return the same id**. | Rate resolution | Repo `payArrangementRepository.ts:44-67`; engine twin `earningsService.ts:284-305`; **NOWHERE** that they must agree | Repo tests `payArrangementRepository.test.ts:136-204`; engine mid-week tests; **no cross-impl vector** — B10#7 | No confirmed drift; **duplication hazard** |
| I-19 | `valid_from` on create is household-local today or earlier (never future). | Rate resolution | `payArrangementCommandService.ts:105-106` | Command service tests for future reject | No |
| I-20 | Pay arrangements are append-only: no UPDATE/DELETE path and no RLS write policy. | Rate resolution | Absence of update API + select-only RLS `041`; no `updated_at` | Migration policy greps | No (service-role can still UPDATE if someone adds code) |
| I-21 | Live weeks (`open`/`submitted`/`queried`) never serve frozen snapshot money; `approved` weeks serve snapshot only (or `hours_only`), never live recompute under an Approved label. | Freeze | `timesheetQueryService.ts:185-198` | Query service freeze vs live tests | No |
| I-22 | Approve CAS: `UPDATE … WHERE status='submitted' AND updated_at=:read_version` freezes `gross_minor`/`currency`/`earnings`/`earnings_computed_at` from `computeForWeek` at that instant. | Freeze / Idempotency | `timesheetRepository.ts:167-188`; `timesheetCommandService.ts:807-821` | CAS refusal tests in `timesheetCommandService.test.ts` / repo; **approve always mocks engine** — F-B10-4 | No for CAS; **end-to-end freeze≠engine untested** |
| I-23 | Every roll-up and every deliberate reopen nulls all four snapshot columns and approval fields in the same write that sets `status='submitted'`. | Reopen | `timesheetCommandService.ts:1245-1251`, `:960-966` (`CLEARED_EARNINGS_SNAPSHOT`) | Reopen + roll-up clear tests; `timesheetRepository.test.ts:206+` snapshot shape | No |
| I-24 | After reopen (or D1 roll-up reopen), a later approve freezes a newly computed gross reflecting current entries/PTO/expenses — not the prior snapshot. | Reopen / Freeze | Implied by I-21–I-23; **NOWHERE** co-tested with real engine | Reopen+approve with **mocked** earnings only — B10#13 | Untested E2E |
| I-25 | Engine `status=no_arrangement` (or non-ok) ⇒ approve writes `gross_minor=null` and `currency=null` — never `0`. | Pay UX | `timesheetCommandService.ts:876-882` | `timesheetCommandService.test.ts:2186+` | No |
| I-26 | Departed / null `carer_id` week ⇒ wire `hours_only` reason `carer_removed`, no rate nudge, no live £. | Membership / Pay | `timesheetQueryService.ts:182-183` | Schema + mobile `WeekEarningsLine` hours_only cases | No (partial: mid-week remove Mon–Tue still priced not pinned — B10 matrix) |
| I-27 | `reimbursements_minor` = sum of reimbursement lines; those pennies never enter `gross_minor` or OT thresholds. | Pay | `earningsService.ts:639-660`, `:747-758` | `earningsService.test.ts:960` (NOT 19800), wage≠reimburse cases | No |
| I-28 | `payable_minutes = worked + cancellation_paid + netted PTO usage`; `guaranteed_topup = min(closure lost minutes, max(0, guarantee − payable))`; zero closure days ⇒ top-up = 0. | Closure top-up | `earningsService.ts:662-696` | `earningsService.test.ts:417+`; `weekEarningsService.test.ts:1222+` | No |
| I-29 | Closure-day shift with `became_payable=true` contributes 0 lost minutes (no double pay with cancel/work). | Closure top-up | `earningsService.ts:679-685` | `earningsService.test.ts:454+`; `weekEarningsService.test.ts:390+` | No |
| I-30 | Netted PTO for pricing = per-`time_off_id` (and per date) `−sum(usage+adjustment)` clamped ≥0; cancelled-then-worked does not price both unreverted usage and work as double PTO+regular from the **same** marking. | PTO ledger | `weekEarningsService.ts:179+` (`netPtoUsage`) | `weekEarningsService.test.ts:514-805` | No (I-30 is cancel-netting; same-day PTO+work **additive by product rule** — F-B2-2 refuted) |
| I-31 | `allocateMinutes(total, weights)` returns parts whose sum equals `total` exactly (largest remainder). | PTO ledger | `allocateMinutes.ts:47-94` | `allocateMinutes.test.ts:17-97` (includes property loop) | No |
| I-32 | First PTO usage: at most one `kind=usage` row per `(household, time_off, effective_date)`; corrections are delta `adjustment` inserts; identical re-submit writes nothing. | PTO ledger | DB `045` unique index; service delta path `ptoCommandService.ts:245-298` | PTO command tests for idempotent same-hours | No for first usage unique |
| I-33 | Concurrent or sequential delta writes for one `(household, time_off)` never leave net paid minutes ≠ last intended total (serialization / single-writer). | PTO / Idempotency | **NOWHERE** (read-then-insert; unlimited adjustments) | NONE for concurrency | **Yes — F-B4-2** |
| I-34 | Approving an expense/mileage when the claim’s week timesheet is already `approved` fails with week-locked; no approved claim exists outside the freeze that priced it. | Expenses / Freeze | Pre-read `assertWeekNotFrozen` `expenseCommandService.ts:517-538`; CAS only on `expenses.status` | `expenseCommandService.test.ts:893` (lock); **no concurrent race test** | **Yes — F-B4-1** (TOCTOU) |
| I-35 | Mileage `amount_minor` is null until approve; approve sets it via I-17 in the same status flip. | Expenses | `expenseCommandService.ts:315` + docs/`044` | Approve pricing tests incl. half-up boundary | No |
| I-36 | Expense create is idempotent under retry: at most one pending claim for the same client intent (or unique idempotency key). | Expenses / Idempotency | **NOWHERE** (plain insert `expenseCommandService.ts:165-204`; no DB unique) | NONE | **Yes — F-B4-6** |
| I-37 | Wire `rate_minor` / `amount_minor` rejected above `99_999_999` (same cap as `parseMajorToMinor`). | Money | Mobile parse only `money.ts:168-183`; API Zod `z.int().min(0)` **no max** | Mobile parse tests; API accepts unbounded | Soft — F-B2-6 (med; malicious client) |
| I-38 | `shifts.cancellation_paid = true` if and only if a `time_entries` row `kind=cancellation_paid` for that shift exists and is included in the household-tz week total/earnings. | State / Pay | Unique index `039` prevents duplicate entries; **accept path sets flag then swallows recorder failure** `shiftChangeRequestCommandService.ts:777-790` | Test **pins swallow success** (`pushes.test.ts:408-427`) — encodes violation | **Yes — F-B2-5 / F-B5-1 / F-B9-1** |
| I-39 | Clock-in is refused when the prospective span would overlap an existing completed entry (incl. `cancellation_paid`); carer is never left with a permanent un-clock-outable runner. | Hours / State | Overlap checked on clock-**out** only `:350-357`; clock-in `:245-293` has no overlap check; DB one-running unique `017:63-65` | NONE for cancel+clock-in deadlock | **Yes — F-B2-4** |
| I-40 | Parent cannot change shift start/end while any `time_entries` reference that shift (immutability). | State / Hours meta | Change-request path `assertMutable`; **parent PATCH bypasses** `shiftCommandService.ts:138-179` | NONE asserting parent edit blocked with entries | **Yes — F-B5-2** |
| I-41 | Every money write asserts caller + client-supplied foreign ids belong to the intended household/role (active nanny / write member); collapses “missing” and “not yours”. | Authz | Command services e.g. `payArrangementCommandService` assertActiveNanny; expense/pto gates | Many unit tests for wrong role / inactive | Partial — see I-42–I-44 |
| I-42 | A carer with `household_members.status='removed'` cannot mutate prior `time_entries` or pending `expenses` for that household. | Membership lifecycle | create/clock-in check active membership; **getOwnedTimeEntry / loadOwnedPending are carer_id-only** | NONE for removed-carer update | **Yes — F-B3b-3** |
| I-43 | `household_members.role` cannot be escalated via PostgREST client writes; API money gates that trust `role` therefore cannot be self-granted. | Authz | **NOWHERE** (RLS allows parent UPDATE of members including `role`; no column trigger) | NONE | **Yes — F-B3-1** |
| I-44 | One invite code creates at most one membership (single redeemer under concurrency). | Membership | **NOWHERE** (unguarded accept update; unique only on `(user_id, household_id)`) | Sequential double-redeem tested; concurrent not | **Yes — F-B4-3 / F-B3b-2** |
| I-45 | Money tables `pay_arrangements` / `pto_ledger` / `expenses` have select-only RLS; helpers and other carers cannot SELECT another carer’s rows via PostgREST. | Authz / RLS | SQL policies in `041`/`043`/`044`; API uses service role (bypasses RLS) | Migration **string greps only** — F-B10-2; no live JWT RLS test | Untested at runtime |
| I-46 | At most one `cancellation_paid` time entry per shift. | Idempotency | DB `time_entries_one_cancellation_paid_per_shift` (`039`) | Insert conflict handling in repo | No |
| I-47 | At most one running time entry per carer. | Idempotency | DB `time_entries_one_running_per_carer` (`017:63-65`) | Service maps 23505 → AlreadyClockedIn; **no live concurrent DB race test** — B10#11 | No (constraint exists) |
| I-48 | Displayed amounts on Hours always carry an explicit Estimated vs Approved state word matching `timesheets.status` / earnings arm. | UX / Freeze | Client `WeekEarningsLine` (convention); **NOWHERE** server-enforced | Component tests for labels | Product rule; not a DB invariant |
| I-49 | Expense `local_date` is treated as household-local calendar; week membership = `weekStartOfLocalDate(local_date)` with no re-zone. | Timezone / Expenses | `expenseCommandService.ts:525` | Indirect week-lock tests | No (client must send household-local date — trust boundary) |
| I-50 | Time-off paid marking days = `localDatesCovered(starts, ends, household.timezone)`; allocated day minutes sum to marked total (I-31). | PTO / Timezone | `localDateSpan` + `allocateMinutes` in PTO command path | allocateMinutes tests; span tests elsewhere | Device-authored midnights reinterpreted in household TZ — A2 footgun; no confirmed finding id |

---

## Enforced nowhere

These rows have **NOWHERE** (or only a partial/pre-read) as the durable enforcement. Prefer a **database constraint / RPC** because the API uses the service role and bypasses RLS.

1. **I-05 / I-06 — no overlapping completed clock spans; unique minutes across weeks**  
   Cheapest: Postgres `EXCLUDE USING gist` on `(carer_id, tstzrange(clock_in_at, clock_out_at, '[)'))` for completed rows (or widen `assertNoOverlap` to ±1 day and filter by interval — app-only is weaker).

2. **I-07 / I-08 — cancel (and all payroll) entries use household timezone; week list includes them**  
   Cheapest: CHECK/trigger requiring `time_entries.timezone = households.timezone`, or write `timezone: household.timezone` in `recordCancellationPaidEntry` (app fix); optional generated `week_start` column from `local_date` so roll-up never re-zones.

3. **I-09 — TZ change vs frozen `local_date`**  
   Cheapest: persist `week_start` on the entry at insert; roll-up by that column (DB generated column from `local_date` beats re-deriving from live household TZ).

4. **I-10 — one carer’s hours UI ↔ that carer’s timesheet**  
   Cheapest: API require `carer_id` on household week entry list; mobile bind `(household, carer, week_start)` — app; unique index already exists.

5. **I-11 — mobile/API worked-minutes parity**  
   Cheapest: shared golden fixture in both test files (or one shared package function) — not a DB constraint.

6. **I-03 — `total_minutes` ↔ `worked_minutes`**  
   Cheapest: one pure co-assertion test; optional deferred CHECK via integrity job (API service role).

7. **I-18 — single `effectiveOn` implementation**  
   Cheapest: delete engine copy and pass pre-resolved maps; or one twin-test vector — app. DB cannot express “greatest valid_from + created_at” easily for the pure engine.

8. **I-33 — PTO adjustment serialization**  
   Cheapest: `pg_advisory_xact_lock(hashtext(household_id\|\|time_off_id))` inside a single RPC that reads net + inserts delta (024/027 pattern).

9. **I-34 — expense approve vs timesheet freeze atomicity**  
   Cheapest: one RPC/`UPDATE expenses … FROM timesheets WHERE timesheets.status <> 'approved'` so freeze and claim approve cannot both win.

10. **I-36 — expense create idempotency**  
    Cheapest: unique `(household_id, carer_id, client_idempotency_key)` or soft unique on pending identity columns.

11. **I-37 — API amount max**  
    Cheapest: Zod `.max(99_999_999)` + matching DB `CHECK (rate_minor <= 99999999)` (and amount).

12. **I-38 — `cancellation_paid` flag ↔ payable entry**  
    Cheapest: same transaction/RPC: set flag and insert entry, or fail accept; compensating clear of flag on recorder throw. Optional: defer flag until entry insert succeeds.

13. **I-39 — clock-in overlap with completed entries**  
    Cheapest: same EXCLUDE as I-05, or assertNoOverlap on clock-in before insert.

14. **I-40 — shift immutable with time entries**  
    Cheapest: extend `apply_parent_shift_edit` RPC with `NOT EXISTS (SELECT 1 FROM time_entries WHERE shift_id = …)`.

15. **I-42 — removed carer cannot mutate owned rows**  
    Cheapest: every write path `findActiveMembership`; optionally RLS/trigger rejecting writes when member not active (PostgREST still relevant for money select-only tables; timesheet writes are API-only).

16. **I-43 — `role` not client-writable**  
    Cheapest: column privilege / `BEFORE UPDATE` trigger rejecting `role` changes except service_role, or revoke UPDATE of `role` from `authenticated`.

17. **I-44 — invite single-use**  
    Cheapest: `UPDATE invites SET status='accepted' WHERE status='pending' RETURNING *` then insert membership only if row returned (CAS in one RPC).

18. **I-45 — live RLS with real JWTs**  
    Cheapest: one integration test (not a new constraint) — policies already intended in SQL.

19. **I-22 E2E — approve freeze equals real engine**  
    Cheapest: one service test with real `WeekEarningsService` (not a DB constraint) — F-B10-4.

---

## The five that matter most

1. **I-38 — `cancellation_paid` flag ↔ entry (F-B2-5 / F-B5-1)**  
   Accept returns success with pay owed on the shift flag but **£0** on the timesheet; underpay is silent until someone diffs the calendar.

2. **I-06 / I-05 — no double-counted minutes across weeks (F-B1-1)**  
   Overlapping overnight spans across Monday put the same hour in two weekly totals → **overpay** if both weeks are approved.

3. **I-07 / I-08 — cancel entries in the household week (F-B1-2 / F-B2-1)**  
   Paid-cancel minutes exist as rows but vanish from `total_minutes` and `gross_minor` when shift TZ ≠ household TZ → **full-shift underpay**.

4. **I-33 — PTO ledger net under concurrency (F-B4-2)**  
   Two concurrent corrections both apply → wrong net minutes → wrong PTO lines on the next open-week approve (or wrong balance forever).

5. **I-34 — expense cannot land after freeze (F-B4-1)**  
   Claim becomes `approved` while the frozen statement omits it → money **owed and invisible** on the authoritative pay record (`docs/11-MONEY.md` §3).

---

## How to check these in CI

Minimal `bun:test` checks (one file per process per `docs/09-TESTING.md`). No new framework — smallest assertion that goes red if the property breaks.

### 1. I-38 — cancellation_paid ↔ entry  
**File:** `apps/api/tests/unit/domains/shift/services/shiftChangeRequestCommandService.test.ts`  
**Assert:** When `cancellationPaidEntryRecorder` throws `TimeEntryNotEditableError` / any error after accept RPC, `respond` **rejects** (or clears `cancellation_paid`) — invert the current pin at `pushes.test.ts:408-427` that expects success-on-swallow. Optionally assert no success path leaves `cancellation_paid=true` with zero `kind='cancellation_paid'` inserts.

### 2. I-05 / I-06 — cross-week overlap  
**File:** `apps/api/tests/unit/domains/timesheet/services/timesheetCommandService.test.ts`  
**Assert:** Seed completed entry A spanning Sunday→Monday; attempt clock-out/retro B overlapping A’s Monday hours; expect `TimeEntryOverlapError` **or** if both exist, `sumWorkedMinutes(week1)+sumWorkedMinutes(week2) ≤ unique covered minutes` (fail on 720 vs 660). Reproduce V-B1’s London scenario.

### 3. I-07 / I-08 — cancel entry week inclusion  
**File:** same `timesheetCommandService.test.ts` (or `weekEarningsService.test.ts`)  
**Assert:** Household `Pacific/Auckland`, create `cancellation_paid` entry with `timezone: 'Europe/London'` and `starts_at=2026-08-02T14:00:00Z` (480 min); after `rollUpIntoTimesheet` / `computeForWeek` for Auckland `week_start=2026-08-03`, **expect** those 480 minutes in `total_minutes` / engine input (today fails — that is the test).

### 4. I-33 — PTO concurrent deltas  
**File:** `apps/api/tests/unit/domains/pay/services/ptoCommandService.test.ts`  
**Assert:** Ledger usage −480; run two overlapping `markTimeOffPaid(…, 360)` with a fake repo that delays between read and insert; final `sum(minutes)` for that `time_off_id` equals −360 (not −240). Until advisory lock exists, this documents the race; once fixed, it stays green.

### 5. I-34 — expense vs approve race  
**File:** `apps/api/tests/unit/domains/pay/services/expenseCommandService.test.ts`  
**Assert:** Thread A passes `assertWeekNotFrozen` then pauses; thread B `approveSubmittedWithEarnings`; thread A `reviewPending` must fail (or leave expense pending). One deterministic fake sequencing test is enough.

**Runner note:** add these under existing colocated `*.test.ts` files and keep `bun run test` / one-file-per-process; do not rely on controller mocks alone (F-B10-1/4).
