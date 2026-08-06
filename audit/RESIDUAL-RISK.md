# Residual risk — what was deliberately left, and what would catch it

Companion to [`00-INDEX.md`](./00-INDEX.md) (what was wrong) and
[`CLOSURE-TABLE.md`](./CLOSURE-TABLE.md) (what closed it, and which test proves
it). This file is the third question: **what is still true after all of it.**

Nothing here is an open task. Every item is either a decision someone made on
purpose, or a limit on what the verification can see. Both are recorded because
an unmarked ceiling is worse than a marked one — the next person to touch this
code will otherwise rediscover the behaviour and reasonably assume it is a bug.

---

## 1. Accepted ceilings

Each was found, understood, and deliberately not fixed. Money impact stated
plainly; the upgrade path is in a `ponytail:` comment at the cited location.

> **All seven — C1 through C7 — were closed in remediation round 2 (2026-08-06).**
> The table below is left exactly as it was written, because it is the record of
> what was accepted and why. What closed each one, and the smaller residual that
> replaced it, is in [§1.1](#11-what-closed-c1c7-and-what-replaced-each). Ceilings
> newly accepted in round 2 are in [§1.2](#12-newly-accepted-ceilings-round-2).
> Line numbers in this table are pre-round-2 and have moved.

| # | Ceiling | Money impact | Trigger | Upgrade path |
|---|---|---|---|---|
| C1 | **Two *departed* carers sharing a display name collapse into one bucket.** The Hours screen shows their combined total under one name, and approve targets one of their timesheets. | Real — a pay record frozen against a total that isn't its own. | Two account deletions, same week, identical `carer_display_name`, parent approving a historical week. | None cheap. Two deleted accounts sharing a name retain no identity to separate them (`carer_id` is NULL by design, migration 033). Would need a stable per-membership id preserved through deletion. `ParentWeekView.tsx` ~:156. |
| C2 | **A crash between an invite claim and the membership insert burns the invite code.** Compensation runs on a thrown error, not on process death. | None directly — but a legitimate user is locked out and a parent must reissue. | Process killed in the window between two auto-committed statements. | A claim-expiry sweep, so an unconsumed claim returns to `pending` after N minutes. `householdCommandService.ts`. |
| C3 | **A hard process kill between a reminder claim and its send loses that reminder.** All five *error* paths (quiet hours, opt-out, no tokens, Expo failure, exception) are covered by the pre-check plus release. | None. A missed reminder, not a missed payment. | `kill -9` / OOM / host loss in a sub-second window. | Make the claim a lease with an expiry rather than a row. Much larger change than the bug warranted. |
| C4 | **A partially-successful approval applier can create one duplicate on its single retry.** Bounded to exactly one — the unbounded loop is closed. | A duplicate shift on a family's calendar; no direct pay effect. | `insertExtraShift` commits the shift row, then `insertChildren` throws, then the approval is retried. | Idempotency key on the applier, or a `source_approval_id` column with a unique index. |
| C5 | **`insertExtraShift` dedupe is an existence-check-then-insert, not a database constraint** — it narrows the window, it does not close it. Chosen because it also covers the ungated `createExtraShift` double-tap, which an approval-id key would have missed. | Duplicate shift under true concurrency. | Two identical extra-shift inserts racing inside the check-to-insert window. | A unique index on the shift's natural key. Needs a migration. |
| C6 | **A Sun→Mon session files all its minutes into the clock-in's week**, and prices them against that day's arrangement. | Small but real: if a rate change or an overtime threshold lands on the Monday, those hours are paid at the Sunday rate and count toward the prior week's overtime. | Any session crossing a week boundary in a non-UTC household. | Teach the roll-up to split across both weeks. `timesheetCommandService.ts:399-408`. Rejecting the clock-out instead is **not** an option — it strands the running row, which is the defect F-B2-4 exists to prevent. |
| C7 | **±1 minute rounding drift on a middle-split cancellation.** Three independently-rounded pieces cannot sum exactly to the booked span. | ~£0.25 per affected shift at £15/h. | Worked time in the middle of a cancelled window, with clock instants carrying real seconds (the normal case). | Round once against the window and give the last fragment the residual. `timesheetCommandService.ts:696`. Deliberately declined: it adds a special case to arithmetic verified correct across 21 shapes. |

**Also unresolved, and product decisions rather than defects:** there is no way
to remove a household member (no service path writes `'removed'`, no route
exists), so every removed-carer guard built in this effort is currently
unreachable except by a manual DB edit; and a previously-removed member cannot
rejoin. See `CLOSURE-TABLE.md` → *Product gaps surfaced*. ~~**Still true**~~, and
round 2 found it has a sibling — see C9 below.

> **CLOSED in round 3 (2026-08-06), along with C9.** All three gaps shipped together,
> which was the right grouping — removal without revoke or without a way back is worse
> product than none of them. Removal is a soft status flip CAS'd on `active`
> (`householdMemberRepository.ts:158`), with the owner un-removable, no self-removal, and
> no removal while clocked in; revoke is the CAS on `pending` that C9 specified
> (`householdInviteRepository.ts:80`); and a rejoin **reactivates the existing row**
> (`:186`) rather than inserting a second one, which is what makes removal reversible.
> Every removed-carer guard this effort built is now reachable by a product path rather
> than a manual DB edit — and the guards that had never run turned out to need company:
> round 3 added the payroll **read** gates that let a removed member's history survive
> her membership, and migration `065`, which end-dates her pay terms so a rejoin cannot
> silently resurrect the rate she left on. Details in
> [`CLOSURE-TABLE.md`](./CLOSURE-TABLE.md) → *Round 3*; the ceilings this created are
> C16–C19 in [§1.3](#13-newly-accepted-ceilings-round-3--audit-closeout).

### 1.1 What closed C1–C7, and what replaced each

A closed ceiling rarely becomes nothing. Six of the seven left a smaller,
differently-shaped residual behind, and those residuals are the honest record —
listing only the closures would overstate where this system now is.

| # | Closed by | The residual that replaced it |
|---|---|---|
| C1 | `058_household_member_identity.sql` — `household_member_id` stamped on `time_entries`, `timesheets`, `pay_arrangements`, `pto_ledger`, `expenses` by INSERT-only triggers (`:110-136`), with a backfill (`:146-179`) and deliberately **no foreign key**, so the identity survives the membership. Wire schemas carry it optionally; mobile keys on `carer_id ?? household_member_id ?? carer_display_name` via the shared `carerKeyOf` (`apps/mobile/src/domains/timesheet/utils/carerKey.ts:43`). | **Forward-only.** Rows written before 058 have no `household_member_id` unless the backfill could reach them, so two carers who departed *before* the migration and shared a display name stay merged. Under-split only — over-split is unreachable, because the backfill is all-or-nothing per carer. Second residual, by design: **identity is per engagement**, so a carer who leaves and is re-invited gets a new bucket and her two stints do not sum. |
| C2 | Self-heal in `householdCommandService.releaseStrandedClaim` (`:282-305`): a claim older than `STRANDED_CLAIM_MS` (15 min, `:58`) with **no membership row in any status** is released and re-claimed. | Two. A window stranded for **less than 15 minutes** still reads as burned until the timer passes — the legitimate user retries and it heals itself. And a claimer who **deletes their account** while stranded nulls `accepted_by` via the FK, which the `!claimedBy` guard (`:289`) reads as "cannot verify the claimer" and refuses to heal: that code is burned permanently. Benign — a parent reissues — and the guard is load-bearing, because healing on a null claimer is exactly how you resurrect a consumed code. |
| C3 | `060_reminder_confirmed_at.sql` + the two-phase ledger: claim → send → confirm (`reminderJob.ts:440`), with a 2-hour stale-claim sweep at job start (`:699`, `STALE_CLAIM_HOURS = 2`). | The confirm is **best-effort** — a failed confirm is logged and swallowed, deliberately, so it can never push a genuinely-delivered reminder back down the release path and double-send it. The hard-kill window is therefore not gone; it is now **bounded by the 2-hour sweep** instead of lasting forever. |
| C4 + C5 | `059_extra_shift_dedupe.sql:51` — `shifts_extra_window_unique` on `(household_id, carer_id, starts_at, ends_at) nulls not distinct where kind = 'extra' and status <> 'cancelled'`. `createShift` maps the 23505 to `ExtraShiftAlreadyExistsError` by constraint name (`shiftRepository.ts:316-322`), `insertExtraShift` adopts the winner (`shiftChangeRequestCommandService.ts:602-631`), and the parent-edit RPC path maps the same 23505 to a 409 instead of a raw 500 (`shiftRepository.ts:433-434`). Production was pre-checked: zero existing duplicates before the index was built. | Three small ones. A **cancel landing mid-race** makes the window bookable again, but the loser still gets a 409 for a window that is now free — a retry fixes it. An **adopted double-tap re-sends the push** (pre-existing shape, not introduced here); live validation found the mechanism behind it — an adopted response is **indistinguishable on the wire** from a genuine create, both returning `data.status: 'created'`, so the client has nothing to branch on. An `adopted: true` field on the response would close the double-push and the ergonomics together. And the 409 message on the parent-edit path is generic — *"An extra shift already exists for this window"* — which is accurate but not the friendliest string a parent could read. |
| C6 | `clockOut` splits a week-crossing session at household-local Monday midnight (`clockOutAcrossWeeks`, `timesheetCommandService.ts:641-729`), boundary from `mondayMidnightInstant` (`utils/mondayMidnight.ts:64`, DST-safe, tested GMT/BST/Chatham/Kolkata). Write order is INSERT B → UPDATE running→A (fragment A keeps the original id) → roll up both weeks. Cancelled windows split at the same boundary (`splitAtWeekBoundaries`, `:341-361`), so the approved-week guard covers every fragment's week. Breaks split via `allocateMinutes(break + drift)`. | **A 1-minute deviation corner** where the drift is −1 and the break is 0. Minute conservation was chosen over per-row exactness, which means a 30-minute break can be **stored as 31 across the two rows** — the sum is right, one row's stored figure is one out. Measured bound: `\|share − span\| ≤ 2` minutes on every fragment. |
| C7 | The window is rounded **once**: budget = booked − presence (break-free, clipped) − already-banked fragments **contained** in the window, containment decided by instant compare (`:1077-1078`, never string compare — see `GOLDEN-FIXES.md` #25). `allocateMinutes` (`:1101`) spreads the residual over remainders instead of dumping it on one row. Conservation is exact. Swept ~30k generated cases and ~30k retry subsets across multiple fresh seeds, including a reviewer's own. | Retry determinism is now **per window total**, not per fragment: a retry always writes the same total, but when several fragments are missing *simultaneously* the split between them can move by 1–2 minutes. And a repair running alongside a fragment written under the **pre-deploy old rule** lands the window exactly right — it self-heals — but the intermediate arithmetic passes through a state the old rule would not have produced. |

### 1.2 Newly accepted ceilings (round 2)

Same rule as §1: each was found, understood, and deliberately not fixed.
Numbering continues from C7.

| # | Ceiling | Money impact | Trigger | Upgrade path |
|---|---|---|---|---|
| C8 | **A settled over-banked cancellation window is invisible to every check we have.** When banked fragments already exceed the booked span, there is nothing left to write — and the over-bank alarm needs remainders to fire, so it stays quiet. **No integrity check compares Σ fragment minutes against the booked span**; 056's `cancellation_unsettled` asks the opposite question (is anything *missing*). | Real if reached — an over-payment nobody is told about. | Unreachable through the post-C7 code path. Requires leftovers written under an older rule, or a manual DB edit. | A ninth integrity check: `Σ fragment scheduled_minutes ≤ booked span`, per shift. Cheap — 056 is already the place to put it, and the shape of the other eight checks is the template. |
| C9 | **There is no way to revoke an invite.** No service path, no route, nothing writes a terminal status onto a `pending` invite. A parent who mis-sends a code cannot take it back; it stands until it expires. | None. | Any mistyped or regretted invite. | A `revoke` command plus a route, CAS'd on `status = 'pending'` in the shape of `claimPending`. Sits alongside the pre-existing member-removal gap (`CLOSURE-TABLE.md` → *Product gaps surfaced*) — both are missing product surface, not defects, and closing removal without closing revoke would be odd. |
| C9b | **Nanny onboarding never collects a name.** The flow is role → code → availability, with no name step anywhere. Before D1 the profile row simply did not exist; **after** the D1 server-side fix it exists with `name = null`, which is a different and more visible failure — the row is there, and empty. | None. | Every nanny who joins by invite code. | Needs a **product answer before a code one**: add a name step to onboarding, fall back to the parent-supplied `carer_display_name`, or render a deliberate placeholder. What currently renders wherever a name is expected is unverified. Sits with C9 and the member-removal gap — all three are missing product surface, and this one was *surfaced* by fixing D1 rather than caused by it. |
| C10 | **`endsAtLocalMidnight` fails open under a spring-forward at Monday midnight.** The mobile helper that suppresses the false "edited" badge and the zero-duration warning on fragment A tests for a local midnight; a zone that skips midnight on the DST transition has no local midnight to match, so the badge returns. | None — cosmetic. | A zone whose DST transition lands exactly at Monday 00:00 local. **No such zone exists in tzdata through 2029.** | If tzdata ever adds one: compare against the same `mondayMidnightInstant` the server uses rather than probing for a local midnight. |
| C11 | **Timezone is not pinned in either test runner.** Several timezone assertions read the host's zone, so the suite is host-dependent. It passes everywhere west of UTC+2 today, which covers CI and every machine in use. | None. | Running the suite from a host at UTC+3 or further east. | `TZ=UTC` in both `test` scripts. Deliberately not done now: it would need every affected fixture re-checked in one pass, and a green suite that silently changed meaning is worse than a documented dependency. Related: `localDateInZone` falls back to the UTC calendar date on an invalid zone string rather than throwing. |
| C12 | **The mobile zero-duration warning has two documented exemptions.** It does not fire on a fragment-A row that ends at local midnight (C10's helper), nor on a `cancellation_paid` row. A genuinely zero-length entry of either shape is therefore unflagged on the client. | None — the server-side figures are unaffected; this is a display warning. | A real zero-length midnight fragment, or a real zero-length cancellation row. | Both exemptions exist because the alternative is a false warning on the *normal* case, which is worse. Narrow them only with a positive signal (a `scheduled_minutes === 0` test) rather than by removing the exemption. |
| C13 | **Rows with `carer_id` AND `household_member_id` both null stay excluded from the carer-grouped integrity checks.** 061 replaced 056's `carer_id is not null` filter with `coalesce(carer_id, household_member_id)`, which recovers post-058 departed carers — but pre-058 departed rows have neither key and cannot be grouped at all. | None directly — those rows are simply unchecked, not miscounted. | A carer who departed before 058 was applied. | The same forward-only limit as C1; it lifts only if those historical rows are given an identity, which the deleted account no longer has. |
| C14 | **The widened reminder window can deliver near 22:00 after an outage.** F-B6-2's fix replaced `hour !== 18` with `18 ≤ hour < 22`, so a job that has been down since 18:00 will send a shift reminder at, say, 21:50 local. | None. | An outage spanning the 18:00 run. | Chosen deliberately over the alternative, which is silence: a late reminder is worse than a prompt one and much better than none. Narrow the window only if late-evening pushes turn out to annoy people more than missed shifts cost them. |

### 1.3 Newly accepted ceilings (round 3 — audit closeout)

Same rule again. Numbering continues from C14.

**One row below is not an accepted ceiling: C26 is an open release blocker**, listed here
only so it sits beside the work that created it. Everything else was found, understood, and
deliberately left. Three of the seventeen — C24, C26 and C30 — were found by *verifying this
round's own output* rather than by the work itself, which is the same lesson as §4 arriving
one layer further out.

| # | Ceiling | Money impact | Trigger | Upgrade path |
|---|---|---|---|---|
| C15 | **The job in-flight guard is check-then-act, so three simultaneous POSTs all execute.** `jobHandlerFactory.ts:83-91` reads for a fresh `running` row and then inserts, with no database reservation between the two — reproduced 5/5 with concurrent requests. A **genuinely in-flight** run *is* refused with 409; only true simultaneity slips through. | Depends on the job. The horizon and reconcile jobs are idempotent by their own arithmetic, so a double run writes nothing twice; a future non-idempotent job would not be so lucky. | Three or more requests hitting one job endpoint inside the same read window. Cron cadence here is hourly or slower, so this needs a manual trigger or a misconfigured scheduler. | **Deliberately accepted rather than fixed with the obvious tool.** A partial unique index on `job_runs(job_name) where status='running'` would close it and introduce something worse: staleness lives in the *read* (`STALE_RUNNING_MS`, 15 min), so a single crashed run would hold the index entry and wedge that job's schedule permanently. `JobRunService.startWithIdempotencyKey` (`jobRunService.ts:254`) is the real upgrade — a CAS reclaim that can time a dead run out. It exists, is tested by nothing, and has **zero callers**; wire it the first time a job cannot tolerate a double run. |
| C16 | **A same-day remove-then-rejoin leaves the old rate live for the rest of that day.** `065`'s `valid_to` is a DATE and is **inclusive** — the removal day still prices at the old terms — so terms re-confirmed the same day cannot take effect until tomorrow. | Real but tiny and bounded: at most one day at the old rate, and only when a removal and a rejoin land on the same household-local date. | Remove and rejoin the same member on the same day, then set a new rate that day. | Self-heals overnight, and terms dated today already win on precedence, so the exposure is the remainder of one day. Closing it means an `ended_at timestamptz` instead of a `valid_to date`, which `065`'s header argues against at length: a date is what a person agrees to and what a payslip is derived from, and future-dated terms are refused by design precisely so nobody can pre-date a rate change. Not worth a timestamptz. |
| C17 | **A rejoin can change a member's ROLE silently, and nothing records who did it.** Reactivation applies the new invite's role (`householdMemberRepository.ts:186`, `.update({ status: 'active', role, can_edit: false })`), so re-inviting a departed nanny as a parent promotes her with no trace. Invite-redeem is now the **only** role-mutation path — 049 removed the client one — which is the good half; the bad half is that there is no household-scoped audit table anywhere, so the change leaves no record at all. | None directly. It is an access-control change with no attribution, which matters after the fact rather than at the time. | Any rejoin issued on a different role than the member left with. | A household-scoped audit table — who changed what, when — which nothing in this system has yet. That is a larger piece of product than this ceiling justifies on its own, but it is the first concrete demand for one, and C22's silent-schema-change class and the role change here would share it. |
| C18 | **A removed member's household vanishes from `GET /households`, so mobile cannot reach the payroll reads the API now serves.** The read gates deliberately keep serving a removed parent or nanny her own historical payroll (`assertPayrollReader`, `timesheetQueryService.ts:392`), but `listActiveHouseholdIds` (`householdMemberRepository.ts:132`) and `listActiveByUser` are both active-only, and every mobile payroll surface takes its household id from `useActiveHousehold`, which only honours a persisted id that appears in the fetched list. No deep link accepts a household or timesheet id either. | None — the data is served correctly and simply cannot be navigated to. | Any removal. | A past-households listing, which the gate names in its own comment (`timesheetQueryService.ts:384-390`: *"API contract only … the upgrade path is a past-households listing"*). Deliberately not built here: the API contract is the part that had to be right at removal time, and shipping a UI for it without a product decision about what a departed nanny should see would have been guessing. |
| C19 | **PTO leftovers vanish at 31 December for everyone.** Balances are year-scoped by construction — `ptoLedgerRepository.listForCarerYear:88` reads one calendar year and the lazy grant refuses any non-current year (`ptoQueryService.ts:245-250`) — so unused entitlement does not carry over and is not surfaced before it disappears. | Potentially real, and it is a **product** question rather than a defect: whether unused PTO should carry, expire, or be paid out is a policy nobody has decided. | Every carer, every 31 December. | **Pre-existing and unrelated to the rejoin work** — surfaced by it, because a rejoiner's carried balance made the year-scoping visible for the first time. It also protects a rejoiner (see §4, round 3), so it is not simply a limitation. Worth its own product decision before the first December, not a code change now. |
| C20 | **`makeOwnershipValidator` caches on `(userId, resourceId)` with no lookup identity — LATENT privilege escalation.** The cache key (`validateResourceOwnership.ts:85` → `cache.ts:45-49`) omits the `lookup` function entirely, and the cache is a process-wide `NodeCache` with a **one-hour** positive TTL (`cache.ts:22`). Pair a wide read lookup and a narrow write lookup on one URL param and the read's positive entry short-circuits the write's check. | None today; potentially total where it bites — reproduced during this round as a **removed parent approving a timesheet** after one permitted GET. | Any *future* route that mounts `makeOwnershipValidator` with two different lookups on the same param. | Latent, not live: the payroll read deliberately carries **no** ownership middleware (`timesheetRoutes.ts:42-53`) and gates inside the service instead, pinned by `a permitted GET followed by approve on the SAME id still 404s`. The real fix is one discriminator argument folded into `getRelationshipKey` plus a value at each call site. Left undone because doing it now means touching every ownership-validated route to close a hazard no shipped route has; do it the moment a second route pair needs the middleware. Now `GOLDEN-FIXES.md` #32. |
| C21 | **A children-only pattern amend rides the next time/note change.** F-B6-4's dirty check (`scheduleMaterialisationService.ts:423-446`) compares times, timezone and note, and deliberately **not** children — so amending only which children a recurring shift covers does not rewrite `shift_children` until the next run that also moves a time or a note. | None — coverage rows lag, no figure is wrong. | A pattern amend that changes children and nothing else. | Documented in place (`:401-409`). Closing it means a second batched read of `shift_children` per run, purely to diff, which is exactly the per-run round trip GOLDEN-FIXES #28 was written to eliminate. Add a batched children read mirroring `findActiveByPattern` if the lag ever needs to close sooner. |
| C22 | **`064`'s status-CHECK drop targets a hardcoded constraint name.** `064:52-53` is `drop constraint if exists shift_change_requests_status_check` — the name Postgres generates for `015`'s inline unnamed check. Verified correct against `015_shifts.sql:161-163`, and the migration admits the assumption in its own header. | None. | A constraint renamed, or a table that already carried another status check, so Postgres autonamed this one `..._check1`. | Reproduced: under a differing name the `drop … if exists` is a silent no-op. It then **fails safe rather than silently** — the subsequent `add constraint` errors on the duplicate name — so the migration refuses to apply rather than leaving two checks live. That is the good failure direction, which is why it was left. Name constraints explicitly in new migrations so their successors have something stable to drop. |
| C23 | **`changeRequestsExpired` under-reports above PostgREST's `max_rows`.** `shiftChangeRequestRepository.ts:282-296` is one `UPDATE … WHERE … .select()`; the UPDATE flips **every** matching row server-side, but the `RETURNING` projection is capped at Supabase's default `db-max-rows` of 1000, and the count is `expired.length` (`scheduleHorizonJob.ts:192`). | None — no code branches on the number, and the next run's `.eq('status','pending')` naturally sees fewer rows. | More than 1000 stale pending requests in one sweep. **This matters exactly once:** `064`'s first production sweep ages out the entire historical backlog in a single run. | Cosmetic by design. If the number ever needs to be exact, take it from a `count` query rather than the returned rows, or page the select. Do not "fix" it by chunking the UPDATE — the single statement is what makes the sweep atomic. |
| C24 | **The pre-existing approvals sweep has the identical `max_rows` shape, and there it is NOT cosmetic.** `coParentApprovalRepository.ts:207-233` uses the same `.update(...).eq(...).lt(...).select()`, but `coParentApprovalQueryService.expirePendingApprovals` (`:61-70`) feeds the **returned rows** into `approvalApplierRegistry.applyAllSettled`. Rows truncated by the 1000-row cap are flipped to `timed_out` in the database while their parked mutation is never applied on that pass. | Real. A timed-out approval whose applier never ran is precisely the F-B5-3 class — a terminal status with nothing behind it. | More than 1000 pending co-parent approvals expiring in one sweep. Not currently reachable at this app's scale. | **Found while verifying C23, not by the work that created it, and it is older than this round.** Genuinely fixable: page the select, or drive the appliers off a separate bounded query rather than the UPDATE's `RETURNING`. Left because it needs its own change to a surface round 3 did not otherwise touch, and the scale that triggers it does not exist yet. It should be the first thing fixed if the approvals surface is reopened. |
| C25 | **Neither expiry count reaches `job_runs`.** `jobController.ts:51-62`'s `mapForJobRun` forwards `totalProcessed`, `successCount` and `errorCount` only, so `changeRequestsExpired` and `coParentApprovalsExpired` are dropped before `JobRunService.complete`. Both still appear in the HTTP response. | None. | Every horizon run. | Symmetric with the pre-existing approvals sweep, which is why it was left: adding one and not the other would be the odd choice. Add both to the summary map together if the expiry rates ever need a history. |
| C26 | **⚠️ NOT A CEILING — AN OPEN RELEASE BLOCKER.** `apps/mobile/eas.json:33` is `"EXPO_PUBLIC_SENTRY_DSN": "TODO-SET-BEFORE-BUILD"`. A production build cut today ships with mobile crash reporting silently off. | None until a crash happens, then total loss of visibility on the surface F-B9-6 just instrumented. | Cutting any production build. | The owner supplies the DSN. Note `SENTRY_ALLOW_FAILURE: "false"` (`:38`) does **not** catch this — it fails a build on a broken source-map *upload*, not on a DSN that was never set, so the build goes green. Listed in this table only so it sits beside F-B9-6's work; it is tracked as a blocker in [`OPEN-ITEMS.md`](./OPEN-ITEMS.md), not as something accepted. |
| C27 | **`063` caps the total but not the rate, so a legal rate can still multiply past the cap.** Per-hour and per-mile rates reuse `MAX_MONEY_MINOR` (99,999,999) — the *total-amount* cap — as their own ceiling, because there is no separate rate bound. A rate well inside its cap, times enough hours or miles, exceeds the amount cap. | None any more: the computed guards (`ExpenseAmountTooLargeError`, `TimesheetGrossTooLargeError`) refuse cleanly before any write, and `063`'s `timesheets_gross_minor_upper` backs them at the database. The outcome is a clean refusal, not a wrong number. | A rate high enough that a plausible week's hours crosses 99,999,999 minor units. | **An open product question, recorded rather than answered:** what a sane maximum hourly rate actually is. Until someone decides, the total-amount cap is doing double duty and the failure is loud rather than unreachable. Pick real rate bounds when the answer exists; the schema and the migration are both one line each at that point. |
| C28 | **Four mobile fixtures now model a wire shape the API cannot produce.** They omit `valid_to`, which `065` made a required member of the pay-arrangement wire type, and they mock **above** the schema layer so nothing validates them. | None — test-only. | Reading those fixtures as documentation of the wire format. | The general shape is the risk, not these four rows: a fixture that mocks above its own schema is a second, unversioned definition of the contract. Fix them the next time that file is opened; better, move the mock below the schema boundary so the shared type enforces it. |
| C29 | **Two mobile test-coverage nits on the manage-household UI.** The revoke-disabled state is unpinned (nothing fails if the button becomes pressable when it should not be), and the reset-both-flags fix is pinned by source inspection rather than by an interaction test. | None. | A refactor of the manage screen. | Both are cheap and both were deliberately skipped in favour of the runtime probe, which found more. Worth noting the second is the weaker of the two: "verified by reading" is the exact standard this audit exists to distrust, and it is recorded here rather than counted as coverage. |
| C30 | **The app-version "gate" is advisory, and its platform header is never sent.** F-B11-5's headers exist, but nothing rejects an under-version request — `appStatusRoutes` returns an `updateRequired` flag the client chooses to honour (`client.ts:39-40` says so outright). Separately, the server reads `x-app-platform` (`:50`) which **no mobile code sends**, so `platform` always defaults to `'ios'`. | None directly. The visible consequence is that an Android user on a forced update is shown the **iOS** store URL and cannot act on it. | Any Android force-update. | The platform default is a genuine bug with a one-line fix on the client, left only because it belongs with whoever decides whether the advisory should become a real gate. Server-side minimum-version rejection is the named upgrade path; do both at once. No test covers the header-reading route today, only `compareVersions`. |
| C31 | **Two session-drop paths clear Sentry and store state but keep the API bearer token.** The refresh-failure branches (`auth.ts:329-340`) call `clearUserContext()` and reset the store, but unlike `signOut()` (`:147,150`) and the revoked-user path (`:364,366`) they do not call `clearAuthToken()` or null `previousSignedInUserId`. | None known — the token is already expired, which is why the refresh failed. | A session whose refresh fails rather than being explicitly signed out. | Found while verifying F-B9-6's cleanup, outside that finding's scope. The asymmetry is the concern more than the token: five drop paths do one thing and two do another, and the next person to add a path will copy whichever they read first. Fold the whole teardown into one function every path calls. |

---

## 2. The verification gap — and why QA only closes half of it

**Migration tests in this repo assert on SQL *text*, not behaviour.** Every
`migration0NN*.test.ts` reads the `.sql` off disk and asserts the parsed text
says what it should.

> **Narrowed 2026-08-06.** Migrations now **execute**. CI's `DB - Migrations + RLS`
> job (`.github/workflows/ci.yml:263`) pins the Supabase CLI at `2.95.4`, runs
> `supabase start`, then `supabase db reset --local` — which applies all 61
> migrations to a fresh PG15 on every push. A migration that parses but does not
> *run* now fails CI. And the RLS layer is probed live: twelve assertions with real
> parent and nanny JWTs (`apps/api/tests/integration/rls.integration.test.ts`),
> proven discriminating against weakened copies of the policies.
>
> **What that does not do** is assert a constraint's *semantics*. `db reset`
> proves the DDL is valid and applies in order; it does not seed a row that
> *should* be rejected and check that it was. The permissive half of the problem
> below is therefore still real for anything the RLS test does not name — and the
> `manual_adjustment` worked example that follows would still have survived it.

That bound must be understood precisely, because it is what "green" means for
every migration in this repo.

### Constraint bugs fail in two directions, and only one is loud

- **Too restrictive** — the constraint blocks something legitimate. A user hits
  an error immediately. QA sees it. **Loud.**
- **Too permissive** — the constraint fails to block something it should.
  Nothing visibly breaks. No error, no crash, no failing flow. **Silent.**

**A worked example from this effort.** During the review of migration 055, the
orchestrator proposed an exclusion-constraint predicate of `kind = 'worked'`.
The `kind` enum is three-valued, and `manual_adjustment` **is** worked time —
`earningsService.ts:382` computes worked minutes as `worked + manual_adjustment`.
Under that predicate, a `manual_adjustment` row for one household overlapping a
`worked` row for another would have participated in **neither** constraint:
a carer recorded as present in two households at once, both counted as worked
minutes by the pricing engine.

It was caught by an agent reading the enum and refusing to implement what it
was told. It would **not** have been caught by:

- the migration contract test — the text would have asserted true against itself;
- any amount of manual QA — every normal flow would have passed green, because
  the failure is a *permission*, not a rejection.

The shipped predicate is `kind <> 'cancellation_paid'`, which names the one kind
that is not presence, so any kind added later fails **closed**.

### What this means practically

QA is worth running and will catch the restrictive half. It will not reliably
catch the permissive half — and on a payroll system the permissive half is the
one that quietly produces a wrong number.

---

## 3. What would actually close it

Items 1–3 shipped in remediation round 2 (2026-08-06). The order below is the
order they were argued in and the order they were done in; each now says what
exists and what is left of it.

1. **Production data-integrity monitoring — ✅ DONE, and it found things.**
   `056_integrity_checks.sql`'s `run_integrity_checks()` runs eight read-only
   checks derived from [`INVARIANTS.md`](./INVARIANTS.md) —
   `timesheet_total_mismatch`, `approved_snapshot_mismatch`, `pto_net_negative`,
   `expense_pending_dup`, `cancellation_unsettled`, `entry_overlap`,
   `stuck_runner`, `orphan_week` — returning one row per violation.
   `057_integrity_checks_cron.sql` schedules it daily at 04:10 UTC;
   `061_integrity_checks_departed_carers.sql` rekeys the carer-grouped checks on
   `coalesce(carer_id, household_member_id)` so 058's departed carers are still
   seen. `integrityCheckJob.ts` logs one error per class (max five sample ids)
   and returns `errorCount`, which fails the run and pages via Sentry (F-B9-9).
   It is **report-only by design** — `reads only — an integrity sweep must never
   repair anything`.
   Behaviourally proven, not just tested: a deliberately seeded mismatch fires
   `timesheet_total_mismatch` on the local stack, and the **first production run
   found three genuine violations** (two orphan-total January timesheets, one
   3-minute drift). Those are pre-launch data artifacts, left for the owner —
   see `OPEN-ITEMS.md` → *2026-08-06 remediation round 2*.
   **What is left:** eight checks is not the whole invariant register. C8 above
   names the specific gap that matters most — nothing compares Σ cancellation
   fragment minutes against the booked span.

2. **Integration tests against a real Postgres — ✅ PARTLY DONE.** CI now applies
   every migration to a fresh PG15 (`ci.yml:263`, `supabase db reset --local`),
   so a migration that does not run can no longer merge, and `qa-smoke.ts`'s
   `|| true` no-op — which had been quietly passing regardless of outcome — is
   fixed. **What is left is the harder half:** nothing yet seeds a row that a
   constraint *should* reject and asserts the rejection. `db reset` would not have
   caught the `manual_adjustment` hole; only a behavioural assertion would.

3. **RLS probes with a real authenticated JWT — ✅ DONE.**
   `apps/api/tests/integration/rls.integration.test.ts`, twelve assertions with
   real parent and nanny JWTs, run in CI against the local stack
   (`ci.yml:296-300`). It probes exactly what 049/052 rewrote: role escalation
   through PostgREST, shift and pattern writes, cross-household reads of
   `time_entries` / `pto_ledger` / `expenses`, the children soft-delete
   invariant, and `carer_time_off`. Proven discriminating — weakened copies of
   the policies make it fail — and it refuses to run against a non-localhost
   `SUPABASE_URL`, a guard that exists because an early run hit production.
   This converts [Caveat ①](./CLOSURE-TABLE.md#caveats-on-direct) from reasoning
   into evidence. **What is left:** the twelve assertions cover the policies this
   audit touched, not the whole policy surface.

4. **Manual QA — ✅ LARGELY DONE, by machine rather than by hand.** Every
   remediation item was driven against the **running API** with real JWTs and
   direct database assertions, which is the thing this item was asking for. It
   did what this section predicted: it found the loud failures, and it found
   them in the surface *around* the fixes rather than in the fixes themselves —
   five API-ergonomics observations and one real pre-existing defect (**D1**,
   onboarding 500s for a caller with no `user_profiles` row, the nanny redeem
   path unguarded anywhere). Both lists are in
   [`OPEN-ITEMS.md`](./OPEN-ITEMS.md) → *2026-08-06*.
   **✅ The co-parent gap is now closed too (round 3).** It was the one surface both
   prior passes skipped, and this section called it the most valuable remaining
   probe on that basis. It has been driven: **7 probes, all OK, the state machine
   sound.** F-B4-8 and F-B5-3 both held. The findings were peripheral rather than
   structural — a missing nanny push on the approved-cancel path, a boot trap, and
   silent terminal failures — all three fixed in the same round. A third live API
   run then covered the whole new removal/rejoin surface, ~150 checks, ending in a
   `run_integrity_checks()` over everything it created that returned zero
   violations.
   **What is left:** nothing named. Every surface this audit touched has now been
   exercised at runtime by something other than its own unit tests. That is not the
   same as saying the system is probed — it says the *audited* surface is, and the
   value of each pass has been in what it found **around** the fixes rather than in
   them, which argues for keeping the habit rather than declaring it finished.

Beyond those four, the named gaps that remain are C8–C14 in [§1.2](#12-newly-accepted-ceilings-round-2),
C15–C31 in [§1.3](#13-newly-accepted-ceilings-round-3--audit-closeout), and the untouched
rows in [`OPEN-ITEMS.md`](./OPEN-ITEMS.md) — **2 of the original 35 findings are still open**
(F-B10-1's controller layer and F-B8-7's client-derived surfaces), one is stale, one is
closed as infeasible, and none has ever regressed. The ledger being nearly empty is not the
same as the system being nearly safe: C15–C31 are seventeen things that are *known* and
accepted, and the count of what is unknown has not moved.

---

## 4. Corrections and near-misses, on the record

### Round 1 — two corrections

Both were mistakes by the orchestrator, caught by the agents they were given to.
Recorded because a review process that never corrects the reviewer is not
actually reviewing.

- **"A failed account deletion is silent."** Wrong. `useDeleteAccount.ts:23-25`
  already carries an `onError` toast, and TanStack Query's lifecycle callbacks
  fire on any rejection regardless of the caller's `try/catch`. The agent wrote
  the specified red test, ran it against unchanged code, found it **green**, and
  said so instead of manufacturing a fix.
- **The `kind = 'worked'` predicate**, above. The agent did not implement what it
  was told.

### Round 2 — two near-misses, both caught by adversarial review

These are different in kind from the round-1 corrections. Both were **fixes that
had been written, reviewed once, and were about to ship**, and both would have
been net-negative. Neither was caught by a test; both were caught by someone
re-reading a green fix and asking what it actually did.

- **The C2 fix would have resurrected single-use invite codes.** Round 1's
  self-heal released a stranded claim via a CAS that did not pin the observed
  `accepted_at`. A *fresh* claim by the same user — one made microseconds
  earlier, entirely legitimate, still mid-insert — matched the release predicate.
  Freeing it lets a second user claim the same code, which is the
  double-redemption defect F-B4-3 exists to prevent: **strictly worse than the
  burned code it was fixing**, and a security regression rather than an
  inconvenience. Round 2 pins the CAS on the observed `accepted_at`
  (`householdCommandService.ts:304`), checks expiry before healing, and documents
  the `!claimedBy` null guard (`:289`) as load-bearing rather than defensive.
  Ten tests now pin it, including `does not resurrect a code that was re-claimed
  between the read and the release`.

- **The C6 adoption path was dead code.** The crash-safe adoption that lets a
  retried clock-out pick up a fragment a previous attempt already wrote compared
  two timestamp *strings*. PostgREST returns `+00:00`; our own writes are
  `.000Z`. Same instant, different string, so the lookup matched nothing —
  ever. The consequence was not a cosmetic miss: every retry re-split the
  session, hit the overlap guard, and left the carer **permanently unable to
  clock out**, which is precisely the F-B2-4 stranding class this audit spent
  most of its time removing. The fix is one instant compare
  (`timesheetCommandService.ts:795`). The reason it survived the first review is
  that its test fixtures were all written in one serialisation — the test proved
  the code agreed with the test. Now `GOLDEN-FIXES.md` #25.

Both belong to the same family as the round-1 `manual_adjustment` catch: the
defect is invisible to the test that was written for it, because the test and the
code share the author's assumption. The only thing that found any of the four was
a second reader with permission to disagree.

### Round 3 — a refused instruction, and two claims that did not survive

**The instruction that was refused, and should have been.** The orchestrator specified a
gate on carried-over PTO at rejoin, to fix a "stacking bug" where a returning member would
inherit her old balance on top of a new annual grant. **There is no such bug.** Balances are
year-scoped: `ptoLedgerRepository.listForCarerYear:88` reads exactly one
`${year}-01-01` … `${year}-12-31` window, and the lazy grant refuses any year that is not
the current one (`ptoQueryService.ts:245-250`). Nothing stacks, because nothing crosses a
year boundary. Building the gate as specified would have denied a member who rejoins in
January the annual grant she is entitled to — a fix whose only effect is the harm it was
written to prevent, on a real person's leave. The implementer said so instead of building
it. What shipped instead is the modest true thing: the leftover balance is **named** in the
rejoin push (`householdCommandService.ts:441`), zero suppressed, the whole lookup wrapped so
a failure cannot cost the rejoin.

This is the **fourth** correction in this effort's record, and the pattern is now specific
enough to state: all four came from the *implementer*, not the reviewer. The person told
what to do had the most context on the change, and in every case the objection was
available only to someone reading the actual code rather than the specification of it. A
process that treats the implementer as the party to be checked, rather than a party that
checks, loses precisely these.

**Two claims handed to this ledger did not survive being checked**, and are recorded
because the alternative is a ledger that launders its own reports:

- **"F-B3b-3 re-verified across 36 call sites."** No 36 exists anywhere in the tree.
  `findActiveMembership` (`householdMemberRepository.ts:28`) has **28** direct call sites,
  one of which is itself called at 19 more — 46 distinct authorization points. The claim's
  *substance* held, and is what matters: exactly three services gate on any-status
  membership, all three are payroll reads, and every write resolves through an active-only
  helper. A precise-sounding number nobody can reproduce is worse than "every write path",
  which is checkable.
- **"The new week renders hours-only with gross NULL, not 0."** Right behaviour, wrong
  names, in a way that matters for anyone implementing against it. The status is
  `no_arrangement`, a distinct member of `WEEK_EARNINGS_STATES` from `hours_only`, and
  `WeekEarningsSchema` (`timesheet.schema.ts:365-400`) is a discriminated union whose
  non-`ok` arms carry **no money fields at all**. The gross is structurally absent. A client
  written to check `gross_minor === null` would be checking for a state this wire format
  cannot express.

**And one stale comment created by this round's own work**, left visible rather than tidied
away in prose: `effectiveOnParity.test.ts:38-50` still says the sibling repository test
compares as strings. It did, which is why the parity test found the bug; it now
`Date.parse`es both sides (`payArrangementRepository.test.ts:63-79`). The comment would send
the next reader to "fix" a file that is already correct — the same class as the five stale
comments in [`CLOSURE-TABLE.md`](./CLOSURE-TABLE.md) → *Stale documentation*, and evidence
that a fix reliably outruns the prose describing it.

The general lesson matches the effort's central finding: **a passing test is not
evidence that a defect is closed.** Several fixes here passed their own tests
while leaving the original defect reachable by a path the test did not cover.
Where a claim cannot be traced to the defect's stated trigger, it is marked as
such rather than inferred from a green suite.
