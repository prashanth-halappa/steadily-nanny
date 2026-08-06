# Open Items — status of the 35 out-of-scope findings

Companion to `00-INDEX.md`. Those 35 findings (15 unverified S2/S3, 20 observational)
were never in scope for the fix work and were never revisited. This ledger records
their status **as verified against current code**, in `00-INDEX.md`'s order.

Every row was checked by opening the cited file, not by reading a fix report.
Status is one of **RESOLVED** / **STILL OPEN** / **STALE** / **UNVERIFIABLE**.

Counts: **1 RESOLVED**, **1 STALE**, **33 STILL OPEN**, 0 UNVERIFIABLE.
Nothing here regressed; the fix work moved exactly two.

## Unverified (S2/S3)

| id | sev | claim | status | evidence |
|---|---|---|---|---|
| F-B2-6 | S3 | Wire schemas accept unbounded `amount_minor`/`rate_minor` | STILL OPEN | `expense.schema.ts:93` is `z.int().min(0).nullable()`, `payArrangement.schema.ts:49,51` are `z.int().min(0)` — no `.max()` on any of them. Mobile still caps at 99,999,999, so the two disagree. |
| F-B4-10 | S3 | Tracked jobs have no idempotency key; overlapping cron runs both execute | STILL OPEN | `jobHandlerFactory.ts:48` calls `JobRunService.start(jobName)` with no in-flight check, then runs the body unconditionally. Neither U5's approval work nor 054 changed this. Practical risk narrowed though: the new reconcile job is idempotent by its own arithmetic, so a double run writes nothing twice. |
| F-B5-5 | S2 | Pending `shift_change_requests` never expire | STILL OPEN | No `expires_at` column or expiry sweep anywhere in `015_shifts.sql`. |
| F-B6-2 | S2 | Shift reminders only fire at local hour 18; missed window never retries | STILL OPEN | `reminderJob.ts:440`: `if (clock.hour !== SHIFT_REMINDER_HOUR) { stats.skipped++; continue; }`. **U8's rework did not touch this** — `canDeliver`/`release` wrap the send, the hour gate sits above them and still drops the candidate outright. A run that misses 18:00 local never revisits that shift. |
| F-B6-4 | S2 | Horizon run bumps `sequence` on unchanged shifts | STILL OPEN | `scheduleMaterialisationService.ts` update path still writes `sequence: existing.sequence + 1` with no dirty check. |
| F-B6-5 | S2 | Coverage-gap push fires after `ignoreDuplicates` upsert without checking new rows | STILL OPEN, now documented | `coverageGapService.ts:441-447` — the comment now states plainly that `insertMany` does not return which rows were created and the push covers everything past the pre-insert key filter. Behaviour unchanged; the ceiling is at least written down. |
| F-B7-3 | S2 | Range schemas use lexicographic `>` not instant compare | STILL OPEN | `shift/schemas.ts:75` is `.refine(data => data.to > data.from)` — a string compare over `z.iso.datetime({ offset: true })`, so two instants written with different offsets can compare wrongly. |
| F-B7-4 | S2 | `BusyBlocksQuerySchema` does not validate `from < to` | STILL OPEN | `availability/schemas.ts:81-84` is a bare `z.object({ from, to })` with no `.refine` at all — not even the flawed lexicographic one its sibling has. |
| F-B8-6 | S2 | Optimistic clock-in stamps device timezone, not household | STILL OPEN | `timeEntryMutationUtils.ts:129` `Intl.DateTimeFormat().resolvedOptions().timeZone`, used at `:149-150` for both `local_date` and `timezone`. **The mobile work did not touch this.** Same class as F-B1-2/F-B1-4, which were fixed server-side — a travelling carer's optimistic row can render in the wrong week until the server row replaces it. |
| F-B8-7 | S2 | Inventory of client-derived figures on hours/money surfaces | STILL OPEN, partly narrowed | `entryMinutes.ts:14-17` now documents that it mirrors `computeWorkedMinutes` bit for bit, with the algebraic argument for why. The other cited surfaces (`ParentWeekView`, `MarkTimeOffPaidSheet`) still derive client-side. |
| F-B9-6 | S2 | Mobile Sentry omits `environment`/`release`; `setUserContext` never called | STILL OPEN | `_layout.tsx:38-46` passes `dsn`, `sendDefaultPii`, replay rates and integrations — no `environment`, no `release`. No `Sentry.setUser` anywhere. |
| F-B9-7 | S2 | API PostHog client initialised but never `capture()`s | STILL OPEN | No `capture` call in `config/posthog.ts` or `index.ts`. |
| F-B9-8 | S2 | Corrupt frozen `earnings` JSON served as `hours_only` with no alert | STILL OPEN | `timesheetQueryService.ts:227-229` returns `hoursOnly(row, UNREADABLE_SNAPSHOT)` with no `logger`/`Sentry` call on the failure branch. A corrupted money snapshot is silently degraded. |
| F-B9-9 | S2 | Jobs return HTTP 200 / `job_runs` success when `errorCount > 0` | STILL OPEN | `jobHandlerFactory.ts:48-65` — `JobRunService.complete(runId, …)` then `sendSuccessResponse` run unconditionally; nothing inspects the result body. The new reconcile job returns `errorCount` and `needsHumanCount`, and **the factory ignores both**, so a sweep that failed on every shift still reports success. |
| F-B9-10 | S3 | Morgan logs every request at `info`, burying payroll errors | STILL OPEN | `middlewares/logger.ts:70` still `level: process.env.LOG_LEVEL \|\| 'info'` with morgan mounted at that level. |

## Observational — tests, CI, config, monitoring

| id | claim | status | evidence |
|---|---|---|---|
| F-B10-1 | Money-path controller/repo tests assert mocks, not computed figures | STILL OPEN | `timesheetController.test.ts` has 12 `toHaveBeenCalledWith` assertions and no arithmetic. |
| F-B10-2 | No integration test exercises RLS with an authenticated JWT | STILL OPEN — **higher priority than when filed** | Nothing in `apps/api/tests` creates an anon-key client or signs a JWT. See below. |
| F-B10-3 | Aside from `payArrangementRoutes`, no money-path route tested through real Express middleware | STALE | The claim as written no longer holds: `apps/api/tests/unit/domains/timesheet/routes/householdTimesheetRoutes.test.ts` now mounts both household-nested timesheet routers with the real `validate`/`errorHandler`. The underlying gap is narrower, not closed — expense and PTO routes still have no route-level test. |
| F-B10-4 | Every `approve` test mocks `computeForWeek`; freeze path never runs real arithmetic | STILL OPEN | 10 `computeForWeek` references in `timesheetCommandService.test.ts`, all injected stubs. None of the tests added this round exercise the real engine. |
| F-B10-5 | No test for worked hours + unreverted PTO on the same `local_date` | STILL OPEN | No such case in `earningsService.test.ts`. |
| F-B10-6 | API and mobile break-rounding differ; no shared golden vectors | STILL OPEN, premise softened | The formulas are now reconciled in prose (`entryMinutes.ts:14-17` argues `round(a)-b` and `round(a-b)` coincide for integer breaks). There is still no shared vector file asserting it, so the two can drift again silently. |
| F-B10-7 | `effectiveOn` duplicated in SQL repo and in-memory engine, no cross-assert | STILL OPEN | `payArrangementRepository.ts:44` and the engine's own resolution remain separate; `:74-75` only *comments* that the orderings match. |
| F-B10-8 | Child-commitment fixtures use `'09:00'` not wire `'09:00:00'` | STILL OPEN | `childCommitmentCommandService.test.ts:80,86,105` still `'09:00'`. |
| F-B10-9 / F-B11-8 | `bun run qc` runs neither the coverage script nor thresholds | STILL OPEN | `scripts/qc.sh:52` — `CHECKS=("test" "lint" "format:check" "typecheck")`. |
| F-B10-10 | CI reimplements the one-file loop instead of calling the script | STILL OPEN | `ci.yml:80` — `for f in $(find tests/unit -name '*.test.ts' | sort); do`. |
| F-B11-1 | Migrations `047`/`048` in repo but unapplied in prod; `048` before `047` breaks reminders | RESOLVED | All of 047–055 applied to production per the team lead's report. Ordering concern is moot once both are applied in filename order. **Caveat: not verifiable from this repo**, which holds no production state — this row rests on that report, not on a check I ran. |
| F-B11-2 | CI never applies/validates migrations against a fresh DB | STILL OPEN — **higher priority than when filed** | No `db-migrate`, `supabase db`, or migration step anywhere in `ci.yml`. Nine migrations shipped since this was filed. |
| F-B11-3 | CI has no `shared-types` lint/format jobs | STILL OPEN | `ci.yml` has `shared-types-typecheck` (`:194`) and `shared-types-test` (`:213`) only. |
| F-B11-4 | Production EAS inlines only `EXPO_PUBLIC_API_URL`; Supabase vars default empty | STILL OPEN | `eas.json` production `env` block carries `EXPO_PUBLIC_API_URL`, `SENTRY_ALLOW_FAILURE`, `EXPO_USE_PRECOMPILED_MODULES` — no Supabase URL or anon key. |
| F-B11-5 | No API/mobile contract version gate while OTA is enabled | STILL OPEN | No version or `X-App-*` header in `apps/mobile/src/api/client.ts`. |
| F-B11-6 | Bootstrap `ChildrenScreen` shows an infinite spinner on create failure | STILL OPEN | `ChildrenScreen.tsx:70-72` — `catch { bootstrapStartedRef.current = false; }`. The ref reset permits a retry, but the failure is never surfaced to the user; same bare-catch shape as the account-delete bug. |
| F-B11-7 | API requires `GOOGLE_VERTEX_PROJECT` at boot in all non-test envs | STILL OPEN | `env.core.ts:39` — `z.string().min(1, 'GOOGLE_VERTEX_PROJECT is required')`, no `.optional()`. No domain calls `llmGenerate`, so this blocks boot for a feature nothing uses. |
| F-B11-9 | `BaseRepository` uses `as any` at every write boundary | STILL OPEN | `baseRepository.ts:57` `.insert(data as any)`, `:78` `.update(data as any)`. |
| F-B11-10 | `apps/mobile/assets/_staging/` untracked and not gitignored | STILL OPEN | `_staging` absent from `.gitignore`; `git status` still shows `?? apps/mobile/assets/_staging/`. |
| F-B11-11 | Root `package.json` documents missing `patchedDependencies` | STILL OPEN | `package.json:40` — the `TODO(porting)` note is still the only record. |

## Now higher priority than when filed

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

## Recommended next batch

Ranked by (risk of a wrong number or a wrong access) × (cheapness of fix), not severity.

1. **F-B11-2 — apply migrations against a fresh DB in CI.** A `supabase db reset` step
   against a throwaway Postgres. Highest value per hour of work in this list: it converts
   every one of the 55 migrations from text-asserted to executed, and it is the only thing
   that would catch a malformed constraint before production.
2. **F-B10-2 — one RLS test with a real anon-key JWT.** Needs (1) first. A handful of
   assertions — a parent cannot `UPDATE household_members`, a nanny cannot read another
   household's `time_entries` — would probe the surface 049/052 rewrote. Currently zero
   coverage of the security posture those two migrations exist to create.
3. **F-B9-9 — fail the job when `errorCount > 0`.** A few lines in `jobHandlerFactory.ts`
   to inspect the result and choose `JobRunService.fail`. Cheap, and it turns three
   already-computed counters (including `needsHumanCount`, which means a carer is unpaid)
   into an alert instead of a log line nobody greps.
4. **F-B6-2 — reminders miss their window permanently.** A carer silently gets no shift
   reminder if the 18:00 run is missed. The fix is a window rather than an equality check
   (`clock.hour >= 18 && clock.hour < 20`); the claim ledger already makes a wider window
   safe against duplicates, which is exactly what U8's work bought and nothing yet spends.
5. **F-B8-6 — optimistic clock-in stamps device timezone.** The last live instance of the
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
