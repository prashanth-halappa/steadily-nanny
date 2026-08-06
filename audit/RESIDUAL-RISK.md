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
rejoin. See `CLOSURE-TABLE.md` → *Product gaps surfaced*.

---

## 2. The verification gap — and why QA only closes half of it

**Migration tests in this repo assert on SQL *text*, not behaviour.** Every
`migration0NN*.test.ts` reads the `.sql` off disk and asserts the parsed text
says what it should. Nothing executes a migration against a real Postgres.

That is a reasonable limit for a repo with no DB test harness, but it must be
understood precisely, because it bounds what "green" means for all nine
migrations applied in this effort.

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

In order of value per unit of effort:

1. **Production data-integrity monitoring.** The audit found there is *none*
   (F-B9-4): nothing today would notice a timesheet total diverging from its
   entries, a negative PTO balance, or a duplicate paid row. A scheduled check
   asserting the properties in [`INVARIANTS.md`](./INVARIANTS.md) still hold
   would catch the entire permissive class in production, regardless of whether
   the bug came from application code, a constraint, or a migration. This is the
   highest-value item on the list and the cheapest to start — the invariants are
   already written down.

2. **Integration tests against a real Postgres.** The genuinely missing
   capability. `apps/api/scripts/qa-smoke.ts` hits a running API with a real JWT
   but is manual/CI-gated and does not execute migrations. A harness that
   applies a migration to a scratch database and asserts the constraint's
   *behaviour* — that it permits the cases it should and rejects the cases it
   should — would have caught the `manual_adjustment` hole directly.

3. **RLS probes with a real authenticated JWT.** `CLOSURE-TABLE.md` flags that
   F-B3-1 and F-B3-2 are pinned by static SQL contract tests, not by a live
   probe. Nine migrations have now materially changed the client-facing write
   surface (25 → 15 policies); a test that authenticates as a non-member and
   asserts zero rows would convert that from reasoning into evidence.

4. **Manual QA.** Useful, and it will find the loud failures. Listed last
   deliberately — not because it has no value, but because the failures it
   catches are the ones you would have found anyway.

---

## 4. Two corrections, on the record

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

The general lesson matches the effort's central finding: **a passing test is not
evidence that a defect is closed.** Several fixes here passed their own tests
while leaving the original defect reachable by a path the test did not cover.
Where a claim cannot be traced to the defect's stated trigger, it is marked as
such rather than inferred from a green suite.
