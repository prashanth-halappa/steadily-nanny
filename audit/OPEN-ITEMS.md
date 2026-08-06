# Open Items — status of the 35 out-of-scope findings

Companion to `00-INDEX.md`. Those 35 findings (15 unverified S2/S3, 20 observational)
were never in scope for the fix work and were never revisited. This ledger records
their status **as verified against current code**, in `00-INDEX.md`'s order.

Every row was checked by opening the cited file, not by reading a fix report.
Status is one of **RESOLVED** / **STILL OPEN** / **STALE** / **UNVERIFIABLE**.

Counts: **7 RESOLVED**, **1 STALE**, **27 STILL OPEN**, 0 UNVERIFIABLE.
Nothing here regressed. The original fix work moved exactly two; remediation round 2
(2026-08-06) closed six more — the whole recommended batch. See the dated section at
the bottom.

## Unverified (S2/S3)

| id | sev | claim | status | evidence |
|---|---|---|---|---|
| F-B2-6 | S3 | Wire schemas accept unbounded `amount_minor`/`rate_minor` | STILL OPEN | `expense.schema.ts:93` is `z.int().min(0).nullable()`, `payArrangement.schema.ts:49,51` are `z.int().min(0)` — no `.max()` on any of them. Mobile still caps at 99,999,999, so the two disagree. |
| F-B4-10 | S3 | Tracked jobs have no idempotency key; overlapping cron runs both execute | STILL OPEN | `jobHandlerFactory.ts:48` calls `JobRunService.start(jobName)` with no in-flight check, then runs the body unconditionally. Neither U5's approval work nor 054 changed this. Practical risk narrowed though: the new reconcile job is idempotent by its own arithmetic, so a double run writes nothing twice. |
| F-B5-5 | S2 | Pending `shift_change_requests` never expire | STILL OPEN | No `expires_at` column or expiry sweep anywhere in `015_shifts.sql`. |
| F-B6-2 | S2 | Shift reminders only fire at local hour 18; missed window never retries | RESOLVED | `reminderJob.ts:482-488` is now a window — `clock.hour < SHIFT_REMINDER_HOUR \|\| clock.hour >= SHIFT_REMINDER_WINDOW_END` (18/22, `:77-78`). Safe against duplicates because the shift claim key is dateless: `does not double-send across the widened window — the claim is dateless`. The timesheet nudge deliberately keeps `!==` (`:570`) — its key is date-segmented, so a window there would re-send. |
| F-B6-4 | S2 | Horizon run bumps `sequence` on unchanged shifts | STILL OPEN | `scheduleMaterialisationService.ts` update path still writes `sequence: existing.sequence + 1` with no dirty check. |
| F-B6-5 | S2 | Coverage-gap push fires after `ignoreDuplicates` upsert without checking new rows | STILL OPEN, now documented | `coverageGapService.ts:441-447` — the comment now states plainly that `insertMany` does not return which rows were created and the push covers everything past the pre-insert key filter. Behaviour unchanged; the ceiling is at least written down. |
| F-B7-3 | S2 | Range schemas use lexicographic `>` not instant compare | STILL OPEN | `shift/schemas.ts:75` is `.refine(data => data.to > data.from)` — a string compare over `z.iso.datetime({ offset: true })`, so two instants written with different offsets can compare wrongly. |
| F-B7-4 | S2 | `BusyBlocksQuerySchema` does not validate `from < to` | STILL OPEN | `availability/schemas.ts:81-84` is a bare `z.object({ from, to })` with no `.refine` at all — not even the flawed lexicographic one its sibling has. |
| F-B8-6 | S2 | Optimistic clock-in stamps device timezone, not household | RESOLVED | `buildOptimisticRunningEntry(input, householdTimezone?)` (`timeEntryMutationUtils.ts:131`, zone resolved `:137-138`) writes the household zone into both `local_date` (`:158`) and `timezone` (`:159`); the device zone survives only as the fallback when no household zone is known. Threaded `ClockInCard.tsx:79` → `useClockIn.ts:80`. Tests: `stamps the household zone and its calendar date, not the device zone`; `falls back to the device zone when no household zone is known`; `files the unconfirmed row under the household zone the card renders in`. |
| F-B8-7 | S2 | Inventory of client-derived figures on hours/money surfaces | STILL OPEN, partly narrowed | `entryMinutes.ts:14-17` now documents that it mirrors `computeWorkedMinutes` bit for bit, with the algebraic argument for why. The other cited surfaces (`ParentWeekView`, `MarkTimeOffPaidSheet`) still derive client-side. |
| F-B9-6 | S2 | Mobile Sentry omits `environment`/`release`; `setUserContext` never called | STILL OPEN | `_layout.tsx:38-46` passes `dsn`, `sendDefaultPii`, replay rates and integrations — no `environment`, no `release`. No `Sentry.setUser` anywhere. |
| F-B9-7 | S2 | API PostHog client initialised but never `capture()`s | STILL OPEN | No `capture` call in `config/posthog.ts` or `index.ts`. |
| F-B9-8 | S2 | Corrupt frozen `earnings` JSON served as `hours_only` with no alert | RESOLVED | `timesheetQueryService.ts:236` — `logger.error('Frozen earnings snapshot unreadable', …)` fires before the `hoursOnly(row, UNREADABLE_SNAPSHOT)` return at `:245`, so it reaches Sentry via the transport. Test: `LOGS the corrupt snapshot — a silently degraded week is one nobody fixes`. |
| F-B9-9 | S2 | Jobs return HTTP 200 / `job_runs` success when `errorCount > 0` | RESOLVED | `jobHandlerFactory.ts:81-93` — `JobRunService.complete` still runs **first** (`:81`, so the counts are never lost), then `errorCount > 0` logs at `error` (`:87-91`) and forwards `JobCompletedWithErrorsError` (`:92`), failing the response. The reconcile summary folds `needsHumanCount` into `errorCount` (`jobController.ts:36`); `stillUnpaidCount` is deliberately **excluded** — it pages ~16×/overnight on a transient self-healing state that 056's `cancellation_unsettled` check catches in its durable form. Tests: `logs at error level, fails the response, and still completes the run`; `reads errorCount off the mapped summary, not the raw result`; `folds needsHuman into errorCount, but not stillUnpaid`; `a clocked-in carer does not fail the run`. |
| F-B9-10 | S3 | Morgan logs every request at `info`, burying payroll errors | STILL OPEN | `middlewares/logger.ts:70` still `level: process.env.LOG_LEVEL \|\| 'info'` with morgan mounted at that level. |

## Observational — tests, CI, config, monitoring

| id | claim | status | evidence |
|---|---|---|---|
| F-B10-1 | Money-path controller/repo tests assert mocks, not computed figures | STILL OPEN | `timesheetController.test.ts` has 12 `toHaveBeenCalledWith` assertions and no arithmetic. |
| F-B10-2 | No integration test exercises RLS with an authenticated JWT | RESOLVED | `apps/api/tests/integration/rls.integration.test.ts` — 12 assertions across three describes, driven by real parent and nanny JWTs against the local stack, run in CI at `ci.yml:296-300`. Covers exactly the surface 049/052 rewrote: `P1 cannot escalate a membership role (F-B3-1 / I-43)`, `P1 cannot INSERT a shift`, `N1 cannot SELECT household 2's time entries`, `children cannot be hard-deleted (soft-delete invariant)`, and eight more. Proven discriminating (weakened copies of the policies fail it), and it refuses to run against a non-localhost `SUPABASE_URL`. Lives outside `qc`'s glob — it needs a database, so `bun run qc` stays offline. |
| F-B10-3 | Aside from `payArrangementRoutes`, no money-path route tested through real Express middleware | STALE | The claim as written no longer holds: `apps/api/tests/unit/domains/timesheet/routes/householdTimesheetRoutes.test.ts` now mounts both household-nested timesheet routers with the real `validate`/`errorHandler`. The underlying gap is narrower, not closed — expense and PTO routes still have no route-level test. |
| F-B10-4 | Every `approve` test mocks `computeForWeek`; freeze path never runs real arithmetic | STILL OPEN | 10 `computeForWeek` references in `timesheetCommandService.test.ts`, all injected stubs. None of the tests added this round exercise the real engine. |
| F-B10-5 | No test for worked hours + unreverted PTO on the same `local_date` | STILL OPEN | No such case in `earningsService.test.ts`. |
| F-B10-6 | API and mobile break-rounding differ; no shared golden vectors | STILL OPEN, premise softened | The formulas are now reconciled in prose (`entryMinutes.ts:14-17` argues `round(a)-b` and `round(a-b)` coincide for integer breaks). There is still no shared vector file asserting it, so the two can drift again silently. |
| F-B10-7 | `effectiveOn` duplicated in SQL repo and in-memory engine, no cross-assert | STILL OPEN | `payArrangementRepository.ts:44` and the engine's own resolution remain separate; `:74-75` only *comments* that the orderings match. |
| F-B10-8 | Child-commitment fixtures use `'09:00'` not wire `'09:00:00'` | STILL OPEN | `childCommitmentCommandService.test.ts:80,86,105` still `'09:00'`. |
| F-B10-9 / F-B11-8 | `bun run qc` runs neither the coverage script nor thresholds | STILL OPEN | `scripts/qc.sh:52` — `CHECKS=("test" "lint" "format:check" "typecheck")`. |
| F-B10-10 | CI reimplements the one-file loop instead of calling the script | STILL OPEN | `ci.yml:80` — `for f in $(find tests/unit -name '*.test.ts' \| sort); do`. |
| F-B11-1 | Migrations `047`/`048` in repo but unapplied in prod; `048` before `047` breaks reminders | RESOLVED | All of 047–055 applied to production per the team lead's report. Ordering concern is moot once both are applied in filename order. **Caveat: not verifiable from this repo**, which holds no production state — this row rests on that report, not on a check I ran. |
| F-B11-2 | CI never applies/validates migrations against a fresh DB | RESOLVED | `ci.yml:263` — a `DB - Migrations + RLS` job pins the Supabase CLI at `2.95.4` (`:278`), runs `supabase start` (`:279-284`), then `supabase db reset --local` (`:285-286`, step name `Apply every migration to a fresh database`). All 61 migrations now **execute** against a fresh PG15 on every push, not just parse. Verified locally too: `supabase db reset --local` runs 001–061 clean. |
| F-B11-3 | CI has no `shared-types` lint/format jobs | STILL OPEN | `ci.yml` has `shared-types-typecheck` (`:194`) and `shared-types-test` (`:213`) only. |
| F-B11-4 | Production EAS inlines only `EXPO_PUBLIC_API_URL`; Supabase vars default empty | STILL OPEN | `eas.json` production `env` block carries `EXPO_PUBLIC_API_URL`, `SENTRY_ALLOW_FAILURE`, `EXPO_USE_PRECOMPILED_MODULES` — no Supabase URL or anon key. |
| F-B11-5 | No API/mobile contract version gate while OTA is enabled | STILL OPEN | No version or `X-App-*` header in `apps/mobile/src/api/client.ts`. |
| F-B11-6 | Bootstrap `ChildrenScreen` shows an infinite spinner on create failure | STILL OPEN | `ChildrenScreen.tsx:70-72` — `catch { bootstrapStartedRef.current = false; }`. The ref reset permits a retry, but the failure is never surfaced to the user; same bare-catch shape as the account-delete bug. |
| F-B11-7 | API requires `GOOGLE_VERTEX_PROJECT` at boot in all non-test envs | STILL OPEN | `env.core.ts:39` — `z.string().min(1, 'GOOGLE_VERTEX_PROJECT is required')`, no `.optional()`. No domain calls `llmGenerate`, so this blocks boot for a feature nothing uses. |
| F-B11-9 | `BaseRepository` uses `as any` at every write boundary | STILL OPEN | `baseRepository.ts:57` `.insert(data as any)`, `:78` `.update(data as any)`. |
| F-B11-10 | `apps/mobile/assets/_staging/` untracked and not gitignored | STILL OPEN | `_staging` absent from `.gitignore`; `git status` still shows `?? apps/mobile/assets/_staging/`. |
| F-B11-11 | Root `package.json` documents missing `patchedDependencies` | STILL OPEN | `package.json:40` — the `TODO(porting)` note is still the only record. |

## Now higher priority than when filed

> **CLOSED 2026-08-06.** Both are done — see the rows above and the dated section at the
> bottom. The argument below is kept because it is the reasoning that got them prioritised,
> and because the *shape* of the gap it describes still applies to anything new: a
> constraint or policy that is only asserted by `toContain` over its own SQL text is
> verified by reading, not by running.

**F-B11-2 (CI never applies migrations) and F-B10-2 (no RLS test with a real JWT)** — these two
were routine gaps when filed and are now the largest unprobed surface in the system.

Nine migrations shipped in this effort. Between them they rewrote the client write
surface (049 and 052 together leave **zero** write policies live on any table), added
three RPCs that money flows through (`apply_pto_correction`, `review_pending_expense`,
plus 024's), changed a unique index that governs payable rows (053), and added two
exclusion constraints that decide which time entries may coexist (055). **Every one of
those is asserted only by `readFileSync` + `toContain` tests that check the SQL says what
it says.** Nothing executes them against a database, and nothing connects as a real user
to confirm the policies behave as the migration headers claim.

The specific exposure: 055's two constraints encode a six-row permission table. A
predicate that is subtly wrong in the permissive direction is invisible — no test fails,
no error is raised, and the first symptom is a wrong payable row. In the restrictive
direction it is loud but breaks production writes. Neither direction is currently
detectable before deploy.

F-B9-9 is a smaller relative on the same theme: `cancellationPayReconcileJob` now returns
`needsHumanCount` for cancellation pay owed on an approved week — a case that by
construction needs a person — and the job factory reports HTTP 200 and a successful
`job_runs` row regardless. The signal exists and nothing reads it.

## Recommended next batch — **EXECUTED IN FULL, 2026-08-06**

Ranked by (risk of a wrong number or a wrong access) × (cheapness of fix), not severity.
All five, plus the monitoring item argued above them, shipped in remediation round 2.
The ranking is left exactly as written — it was the plan, and it turned out to be the
right order: (1) is what made (2) possible, and the monitoring item found real production
violations on its first run, which none of 1–5 would have surfaced.

1. **F-B11-2 — apply migrations against a fresh DB in CI.** ✅ `ci.yml:263`, `supabase db reset --local`. A `supabase db reset` step
   against a throwaway Postgres. Highest value per hour of work in this list: it converts
   every one of the 55 migrations from text-asserted to executed, and it is the only thing
   that would catch a malformed constraint before production.
2. **F-B10-2 — one RLS test with a real anon-key JWT.** ✅ 12 assertions, `tests/integration/rls.integration.test.ts`. Needs (1) first. A handful of
   assertions — a parent cannot `UPDATE household_members`, a nanny cannot read another
   household's `time_entries` — would probe the surface 049/052 rewrote. Currently zero
   coverage of the security posture those two migrations exist to create.
3. **F-B9-9 — fail the job when `errorCount > 0`.** ✅ `jobHandlerFactory.ts:81-93`. A few lines in `jobHandlerFactory.ts`
   to inspect the result and choose `JobRunService.fail`. Cheap, and it turns three
   already-computed counters (including `needsHumanCount`, which means a carer is unpaid)
   into an alert instead of a log line nobody greps.
4. **F-B6-2 — reminders miss their window permanently.** ✅ `reminderJob.ts:482-488`, window 18–22 — the fix shipped is the one predicted here, and it spends exactly the duplicate-safety U8's claim ledger bought. A carer silently gets no shift
   reminder if the 18:00 run is missed. The fix is a window rather than an equality check
   (`clock.hour >= 18 && clock.hour < 20`); the claim ledger already makes a wider window
   safe against duplicates, which is exactly what U8's work bought and nothing yet spends.
5. **F-B8-6 — optimistic clock-in stamps device timezone.** ✅ `timeEntryMutationUtils.ts:131`. The last live instance of the
   timezone class this effort spent most of its time on. Server-side is fixed; the mobile
   optimistic row still guesses. Small, self-contained, and it removes a "why did my hours
   move?" report that would look exactly like the bugs we just closed.

**On `RESIDUAL-RISK.md` §3.** Agreed, and it sits *above* all five. §3 argues that
production data-integrity monitoring is the top item overall, and this ledger is evidence
for it rather than against: items 1 and 2 make defects catchable *before* deploy, but
nothing here detects a wrong number that has already been written. Two findings above
(F-B9-8's silent snapshot corruption, F-B9-9's swallowed `needsHumanCount`) are precisely
cases where the system already knows something is wrong and tells nobody. Monitoring first,
then 1–2 to stop new instances, then 3–5.

---

## 2026-08-06 — remediation round 2

The batch above ran in that order and completed. Branch `audit-remediation-round2`;
`bun run qc` green (mobile 1881, API 2094, shared-types 332, scripts 24).

**Closed from this ledger (6):** F-B11-2, F-B10-2, F-B9-9, F-B6-2, F-B8-6, F-B9-8.
Evidence is in each row above. Also closed, from `RESIDUAL-RISK.md` §1 rather than here:
all seven accepted ceilings C1–C7.

**Migrations 056–061 are applied to production.** Six migrations shipped:

| | What |
|---|---|
| `056_integrity_checks.sql` | `run_integrity_checks()` — eight read-only checks, one row per violation |
| `057_integrity_checks_cron.sql` | daily at `10 4 * * *` → `POST /api/jobs/integrity-checks` |
| `058_household_member_identity.sql` | `household_member_id` on the five payroll tables (C1) |
| `059_extra_shift_dedupe.sql` | `shifts_extra_window_unique` (C4/C5) |
| `060_reminder_confirmed_at.sql` | `confirmed_at` two-phase reminder ledger (C3) |
| `061_integrity_checks_departed_carers.sql` | rekeys the carer-grouped checks on `coalesce(carer_id, household_member_id)`, clamps `scheduled_minutes ≥ 0` |

All four cron jobs are live: horizon 03:00, reminders `:05`, cancellation-pay reconcile
`:25`, integrity checks 04:10.

**The first production integrity run found 3 violations.** They are real, and they are the
point of the exercise — nothing before this would have reported them:

1. & 2. Two **orphan-total timesheets** from January (465 and 480 minutes) with **zero time
   entries behind them**, both in household `5d4b0b70…`. A total that no entry supports.
3. One **3-minute drift** on the week of 2026-08-03 — a timesheet reading 1689 minutes
   against 1692 minutes of entries.

**These are pre-launch data artifacts and were deliberately left alone.** The owner has
said the data may be wiped before launch, and the job is report-only by design (`056`'s
own contract test: `reads only — an integrity sweep must never repair anything`). Repairing
them is the owner's call: wipe the household, or roll up the two January weeks and re-derive
the 3-minute week. Until then the daily run will keep failing, which is correct — a failing
integrity run means the data is wrong, not that the check is.

One incident worth recording: an early RLS-test run hit **production** rather than the local
stack, because `bun` auto-loads `apps/api/.env`. It created and then fully deleted 3 users
and 2 households; cleanup was verified, and RLS passed there too. The localhost guard in
`rls.integration.test.ts` exists because of that run.

### Live API validation

Every remediation item was then exercised against the **running API** with real JWTs and
direct database assertions — an evidence class distinct from the unit suite, and the first
time most of this code has been driven end to end. Details and per-item results are in
[`CLOSURE-TABLE.md`](./CLOSURE-TABLE.md) → *Execution evidence beyond tests*. The headline:
both overnight splits conserved exactly, F-B9-9 proved out composed (seeded violation ⇒ HTTP
500 **and** a `job_runs` row of `failed|1`), and a final `run_integrity_checks()` over
everything the run had created returned **zero violations**.

One area was deliberately **not** exercised at runtime: **co-parent approvals**, which would
have required sitting inside the short-notice window. It is the only remediation-adjacent
surface still resting on unit tests alone.

### Open items found during validation

Not defects in the remediation work — things the run surfaced by driving the API as a client
would. None is filed as a numbered finding yet.

| Observation | Why it matters |
|---|---|
| **Conflict statuses are inconsistent.** A duplicate expense returns `400 VALIDATION_ERROR`; the equivalent conflict elsewhere returns `409 CONFLICT`. | A client cannot branch on "this already exists" uniformly. Cheap to align, and the 409 shape is the right one. |
| **Extra-shift adoption is indistinguishable on the wire.** A request that *adopted* an existing shift after losing the 059 race returns `data.status: 'created'`, exactly as a genuine create does. | This is the **mechanism behind** the adopted-double-tap re-push recorded as a C4/C5 residual (`RESIDUAL-RISK.md` §1.1) — the client cannot tell it should not re-notify. An `adopted: true` flag on the response would close both. |
| **PTO balance/ledger and `/me/change-requests` return a bare 400 on a missing query param**, with no indication which one. | Ordinary API ergonomics; costs an integrator a round of guessing. |
| **The PTO accrued/used split reads oddly after a correction** — the balance itself is correct, the two components it is presented as are not intuitive. | Presentation, not arithmetic. Worth a look before a parent reads it. |
| **There is no timesheet submit route** — a week goes `open` → `approve` directly, with no `submitted` transition exposed. | The `submitted` status exists in the schema and the approve CAS keys on it. **Needs confirming as intended** rather than as a missing route. |

### D1 — onboarding 500s for a caller with no `user_profiles` row — **RESOLVED**

Found during validation; **pre-existing, not caused by the remediation work.** Nothing
creates the `user_profiles` anchor row automatically — there is no trigger on `auth.users` —
so any write whose foreign key points at it (`households.created_by`,
`household_members.user_id`, `user_device_info`) raises 23503 for a user who has never PUT
their profile. The parent path was guarded **client-side only** (commit `2ae309c`); the
**nanny redeem path had no bootstrap anywhere**, and a nanny's first ever API call can be
`redeemInvite`.

**Fixed server-side.** `UserService.ensureProfile` (`userService.ts:29`) upserts with a
payload of **`user_id` only**, `onConflict: 'user_id'`, `ignoreDuplicates: true` — it
creates the anchor row and does nothing at all if one exists. Deliberately **not**
`upsertProfile`, which carries the full profile payload and would clobber a name or city on
every household create. Called at the top of both paths that need it:
`householdCommandService.ts:87` (`create`) and `:163` (`redeemInvite`).

Evidence: `householdCommandService.test.ts` 37/37 and `userService.test.ts` 6/6, plus
**live verification on a fresh API instance** — `defect1.ts` 3/3 (the 500 is gone on both
paths) and `d1-clobber.ts` 2/2 (an existing profile survives a create untouched). The
clobber check is the one that matters: the obvious fix for this defect is the one that
silently destroys data, and it was tested for directly rather than reasoned about.

**Residual — the same 23503 class is still open for device registration.**
`user_device_info.user_id` also references `user_profiles`, and nothing guards that path
server-side either; `deviceRegistrationService.ts:7-10` warns about the ordering in its own
header (*"the profile row MUST exist before the first device registration"*) and relies on
the caller to honour it. **Two paths are fixed, not the class.** Upgrade path: a trigger on
`auth.users` creating the anchor row — one migration, one place, and every FK pointing at
`user_profiles` stops caring about call order. That is the real fix; `ensureProfile` is the
cheap one that unblocked onboarding.
