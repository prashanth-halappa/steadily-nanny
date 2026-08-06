# Prompt for the next Claude Code session

Copy everything below the line into a fresh session in this repo.

---

I want you to plan and then resolve the remaining work from a completed audit and
remediation effort on this codebase. This is a childcare scheduling and payroll app —
wrong hours or wrong cents means a wrong paycheck, so correctness matters more than
speed throughout.

## Read these first, in this order

- `audit/README.md` — how the audit was produced and what each file is.
- `audit/OPEN-ITEMS.md` — **your main worklist.** 35 findings with verified status: 33
  STILL OPEN, 1 RESOLVED, 1 STALE. It ends with a ranked "Recommended next batch".
- `audit/RESIDUAL-RISK.md` — 7 deliberately accepted ceilings (with money impact and
  upgrade path each), plus §2 on why the verification has a blind spot and §3 on what
  would close it.
- `audit/INVARIANTS.md` — the properties that must always hold for hours and pay. Roughly
  40 invariants, ~15 marked enforced NOWHERE. This is the reference for any monitoring work.
- `audit/CLOSURE-TABLE.md` — what was already fixed and which test proves it. Read before
  touching any area so you don't re-litigate settled work.
- `audit/00-INDEX.md` — the original findings, for background on anything unclear.

Then the repo's own docs: `CLAUDE.md`, `docs/08-CONVENTIONS.md`, `docs/09-TESTING.md`,
`docs/11-MONEY.md`, and `GOLDEN-FIXES.md`.

## Current state

- `bun run qc` is **green**: API 1876 pass, mobile 1848, shared-types 319, scripts 24,
  zero typecheck errors. Keep it that way — a red gate means the task isn't done.
- Migrations **047 through 055 are applied to production** (project `dylhrlvfkibipdkguptz`).
  The next migration number is **056**.
- Production is small: ~18 time entries, 108 shifts, 4 timesheets, 4 households.
- Three pg_cron jobs are live: `schedule-horizon`, `reminders-hourly`,
  `cancellation-pay-reconcile`.
- Nothing is committed. The working tree carries all of this work.

## What I want

**First plan, then execute.** Start in plan mode. Before you write the plan, ask me about
scope — I need to choose between at least these, and the answers change the work
materially:

1. **Which of the 33 open items to fix.** They are 15 unverified S2/S3 leads and 18
   observational (test/CI/config) items. None is a known wrong number in production.
   Note that of the 40 findings previously put through adversarial verification, **13 were
   refuted** — so some of the 15 unverified leads may not be real defects. Consider
   proposing that they be verified before being fixed.
2. **Whether to build production data-integrity monitoring.** `audit/RESIDUAL-RISK.md` §3
   argues this is the single highest-value item — above everything in `OPEN-ITEMS.md` —
   because nothing today would notice a timesheet total diverging from its entries, a
   negative PTO balance, or a duplicate paid row. The invariants are already written down.
3. **Whether to close any of the 7 accepted ceilings** in `RESIDUAL-RISK.md`. Each has a
   stated upgrade path. C1 (two departed carers sharing a display name) and C6 (Sun→Mon
   week filing and pricing) are the two with real money attached.
4. **The two product gaps**, which are decisions rather than defects: there is currently
   **no way to remove a household member** — every removed-carer guard built in the last
   effort is unreachable except by a manual DB edit — and a removed member cannot rejoin.
5. **Whether to commit.** Nothing from the previous effort is committed yet.

If I don't express a preference, default to this order, which the previous session's
reviewer argued for and I agree with: production monitoring first; then CI migration
validation (F-B11-2) and an RLS test with a real JWT (F-B10-2), since those two convert
55 migrations from text-asserted to actually executed; then F-B9-9, F-B6-2, F-B8-6.

## How to work

Parallelise with subagents where the work is genuinely independent, and give each one an
**exclusive, disjoint file set** it may write. Everything else is read-only to it. That
discipline is what kept the previous effort from corrupting itself, and the one time two
agents overlapped, only the fact that one stopped and asked prevented lost work.

**Strict TDD, no exceptions:** write the failing test first, run it, confirm it fails *for
the stated reason* and not a setup error, then write the smallest change that passes. A
test that passes before the fix means the wrong thing was reproduced.

**Then have the fixes adversarially reviewed by a different agent than wrote them**, and
tell the reviewer to prove the original defect is *still reachable* rather than to confirm
it's fixed. In the previous effort this found that three fixes had traded one failure for a
worse one, two were still fully reachable, and it surfaced roughly fifteen defects the
original audit never saw. Every single review round found something real. Budget for it.

## Non-negotiables learned the hard way

- **A passing test is not evidence a defect is closed.** Several fixes passed their own
  tests while leaving the original defect reachable by a path the test didn't cover. Trace
  the fix to the finding's stated trigger, or say you couldn't.
- **Verify, don't infer.** Open the file. Don't take a status from a report — including
  from `audit/*.md`, which documents a working tree that has since moved.
- **For anything algorithmic, execute it — don't read it.** Transcribing selection logic
  into a scratch script and running it is what exposed a live S0 that four rounds of
  reading had missed. Write scratch scripts outside the repo.
- **Tests run one file per process** (`bash scripts/run-tests-one-file.sh <dir>`). A bare
  multi-file `bun test` leaks `mock.module()` between files and produces false failures.
- **Watch for fixture traps.** Two were found: an ISO string built as `T11:00.000Z`
  (missing seconds) yields `NaN` from `new Date()`, making every comparison silently false;
  and a fixture omitting a field a new rule reads silently stopped enforcing it. Both make a
  test look like it passed for the right reason when it didn't.
- **Migration tests assert SQL *text*, not behaviour.** Nothing here executes a migration
  against a real Postgres. That blind spot let a proposed constraint predicate through that
  would have permitted a carer to be recorded present in two households at once — caught by
  a human-style read, not by any test. See `RESIDUAL-RISK.md` §2.
- **`bun run format` before `bun run qc`** — qc is read-only and goes red on format drift.
- Production code: no `any`, no `!` non-null assertions (Biome errors on both).

## Definition of done

- `bun run qc` green across all four packages.
- Every item you fix has a named test that failed before the fix and passes after.
- `audit/OPEN-ITEMS.md` updated with new statuses — don't leave it describing a stale tree.
- Anything you deliberately don't fix is recorded in `audit/RESIDUAL-RISK.md` with its money
  impact and upgrade path. An unmarked ceiling is worse than a marked one.
- Any new migration gets a red-first contract test, and you tell me before applying anything
  to production.
