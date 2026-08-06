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
rejoin. See `CLOSURE-TABLE.md` → *Product gaps surfaced*. **Still true**, and
round 2 found it has a sibling — see C9 below.

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
| C10 | **`endsAtLocalMidnight` fails open under a spring-forward at Monday midnight.** The mobile helper that suppresses the false "edited" badge and the zero-duration warning on fragment A tests for a local midnight; a zone that skips midnight on the DST transition has no local midnight to match, so the badge returns. | None — cosmetic. | A zone whose DST transition lands exactly at Monday 00:00 local. **No such zone exists in tzdata through 2029.** | If tzdata ever adds one: compare against the same `mondayMidnightInstant` the server uses rather than probing for a local midnight. |
| C11 | **Timezone is not pinned in either test runner.** Several timezone assertions read the host's zone, so the suite is host-dependent. It passes everywhere west of UTC+2 today, which covers CI and every machine in use. | None. | Running the suite from a host at UTC+3 or further east. | `TZ=UTC` in both `test` scripts. Deliberately not done now: it would need every affected fixture re-checked in one pass, and a green suite that silently changed meaning is worse than a documented dependency. Related: `localDateInZone` falls back to the UTC calendar date on an invalid zone string rather than throwing. |
| C12 | **The mobile zero-duration warning has two documented exemptions.** It does not fire on a fragment-A row that ends at local midnight (C10's helper), nor on a `cancellation_paid` row. A genuinely zero-length entry of either shape is therefore unflagged on the client. | None — the server-side figures are unaffected; this is a display warning. | A real zero-length midnight fragment, or a real zero-length cancellation row. | Both exemptions exist because the alternative is a false warning on the *normal* case, which is worse. Narrow them only with a positive signal (a `scheduled_minutes === 0` test) rather than by removing the exemption. |
| C13 | **Rows with `carer_id` AND `household_member_id` both null stay excluded from the carer-grouped integrity checks.** 061 replaced 056's `carer_id is not null` filter with `coalesce(carer_id, household_member_id)`, which recovers post-058 departed carers — but pre-058 departed rows have neither key and cannot be grouped at all. | None directly — those rows are simply unchecked, not miscounted. | A carer who departed before 058 was applied. | The same forward-only limit as C1; it lifts only if those historical rows are given an identity, which the deleted account no longer has. |
| C14 | **The widened reminder window can deliver near 22:00 after an outage.** F-B6-2's fix replaced `hour !== 18` with `18 ≤ hour < 22`, so a job that has been down since 18:00 will send a shift reminder at, say, 21:50 local. | None. | An outage spanning the 18:00 run. | Chosen deliberately over the alternative, which is silence: a late reminder is worse than a prompt one and much better than none. Narrow the window only if late-evening pushes turn out to annoy people more than missed shifts cost them. |

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
   **What is left:** **co-parent approvals** were deliberately not exercised —
   doing so means sitting inside the short-notice window — so that surface still
   rests on unit tests alone. Given that F-B4-8 and F-B5-3 both live there, and
   that both were round-2 reopens in the first pass, it is the most valuable
   remaining runtime probe on this list.

Beyond those four, the named gaps that remain are C8–C14 in [§1.2](#12-newly-accepted-ceilings-round-2)
and the untouched rows in [`OPEN-ITEMS.md`](./OPEN-ITEMS.md) — 27 of the original
35 findings are still open, none of them regressions.

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

The general lesson matches the effort's central finding: **a passing test is not
evidence that a defect is closed.** Several fixes here passed their own tests
while leaving the original defect reachable by a path the test did not cover.
Where a claim cannot be traced to the defect's stated trigger, it is marked as
such rather than inferred from a green suite.
