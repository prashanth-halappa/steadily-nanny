# Open Items — status of the 35 out-of-scope findings

Companion to `00-INDEX.md`. Those 35 findings (15 unverified S2/S3, 20 observational)
were never in scope for the fix work and were never revisited. This ledger records
their status **as verified against current code**, in `00-INDEX.md`'s order.

Every row was checked by opening the cited file, not by reading a fix report.
Status is one of **RESOLVED** / **STILL OPEN** / **STALE** / **UNVERIFIABLE**.

Counts: **30 RESOLVED**, **1 PARTLY RESOLVED**, **2 STILL OPEN**, **1 STALE**,
**1 CLOSED AS INFEASIBLE**, 0 UNVERIFIABLE.

Nothing here has regressed at any point. The original fix work moved exactly two;
remediation round 2 (2026-08-06) closed six more — the whole recommended batch; the
audit closeout the same day (round 3) closed the remaining twenty-three that could be
closed and states plainly why the rest cannot. **Was 7 / 1 / 27 before round 3.** See
the dated sections at the bottom, newest last.

One row's previous status was simply **wrong**: F-B11-11 was recorded STILL OPEN against
a `package.json` that had already replaced the `TODO(porting)` note with a dated decision.
It is corrected below. Two of the claims round 3 was handed did not survive checking
either, and both are recorded in the rows rather than quietly adjusted.

## Unverified (S2/S3)

| id | sev | claim | status | evidence |
|---|---|---|---|---|
| F-B2-6 | S3 | Wire schemas accept unbounded `amount_minor`/`rate_minor` | RESOLVED | `MAX_MONEY_MINOR = 99_999_999` (`payArrangement.schema.ts:65`) now caps all seven money fields: `expense.schema.ts:104,148`, `payArrangement.schema.ts:116,118,128,164,173`. Mobile's own cap no longer disagrees with the wire. **The finding as filed was too narrow, and closing only what it named would have left the real hole open**: capped *inputs* still multiply into an uncapped *computed* figure, so two typed pre-flight guards check the product before any write — `ExpenseAmountTooLargeError` (`payErrors.ts:128`) thrown at `expenseCommandService.ts:465` on `priceMileage(miles, rate)`, and `TimesheetGrossTooLargeError` (`timesheetErrors.ts:168`) thrown at `timesheetCommandService.ts:1582` on `earnings.gross_minor`, both before the CAS. Both refuse; neither clamps — pinned by `never CLAMPS to the cap — a clamped reimbursement is a wrong paycheck` and `refuses the approval with a typed error and never reaches the CAS write`. DB floor under all of it: `063_money_upper_bounds.sql`, five CHECKs including the computed `timesheets_gross_minor_upper` (`:103-105`). Also bounded here: `overtime_multiplier` to `numeric(3,2)`'s real domain, with a 2dp epsilon refine (`payArrangement.schema.ts:90-100`) mirrored client-side at `payArrangementForm.ts:193-201`. Ceiling recorded as C27. |
| F-B4-10 | S3 | Tracked jobs have no idempotency key; overlapping cron runs both execute | RESOLVED, with a stated ceiling | `jobHandlerFactory.ts:83-91` — `if (await JobRunService.hasFreshRunningRun(jobName))` refuses with `JobAlreadyRunningError` (409, `:54-60`); staleness at 15 min (`jobRunService.ts:58`). A genuinely in-flight run **is** refused. It is a check-then-act read, not a database reservation, and that was chosen deliberately — see C15. Tests: `a fresh running row for the same job blocks the run with 409`; `a stale/no running row lets the job run normally`; `a running row for a different job name does not block this one`. |
| F-B5-5 | S2 | Pending `shift_change_requests` never expire | RESOLVED | `064_shift_change_request_expiry.sql` admits `'expired'` as a sixth status; the sweep is in the horizon job (`scheduleHorizonJob.ts:184-199`, `EXPIRY_DAYS = 7` at `:63`, cutoff off `created_at`), with the CAS in `shiftChangeRequestRepository.ts:279-297`. Errors are logged and swallowed so an expiry failure never costs the horizon run: `reports 0 and still completes the horizon work when the sweep throws`. Also `expires pending change requests older than 7 days and reports how many`; `sweeps globally — no household argument`. Two ceilings came with it, C22 and C23. |
| F-B6-2 | S2 | Shift reminders only fire at local hour 18; missed window never retries | RESOLVED | `reminderJob.ts:482-488` is now a window — `clock.hour < SHIFT_REMINDER_HOUR \|\| clock.hour >= SHIFT_REMINDER_WINDOW_END` (18/22, `:77-78`). Safe against duplicates because the shift claim key is dateless: `does not double-send across the widened window — the claim is dateless`. The timesheet nudge deliberately keeps `!==` (`:570`) — its key is date-segmented, so a window there would re-send. |
| F-B6-4 | S2 | Horizon run bumps `sequence` on unchanged shifts | RESOLVED | `scheduleMaterialisationService.ts:423-446` — a three-part dirty check (`timesMoved` by **instant** compare per GOLDEN-FIXES #25, `timezoneChanged`, `noteChanged`); an all-clean run returns at `:446` **before** `replaceChildrenMany` (`:449`), the update loop, and the `sequence` bump (`:470`), and `result.updated` counts only dirty pairs (`:475`). Children are deliberately outside the diff — see C21. Note the 062-collision adopt branch (`:511`) still bumps unconditionally; that is a different path and out of this finding's scope. |
| F-B6-5 | S2 | Coverage-gap push fires after `ignoreDuplicates` upsert without checking new rows | RESOLVED, and the premise turned out to be worse than filed | `shiftEventRepository.insertMany` (`:177-213`) catches 23505 and retries row by row, skipping only collisions attributable to `shift_events_keyed_unique_idx` (`isKeyedDuplicate`, `:49-58`) and throwing on any other; `coverageGapService.ts:442-462` intersects the returned rows with `toInsert` and pushes nothing when the intersection is empty. **What the fix work found:** `ignoreDuplicates` was not merely failing to *report* the created rows, it was not suppressing the conflict at all — 025's index is an expression index, which PostgREST's `onConflict` cannot name, so a collision 23505-threw and lost the entire batch including its new rows. Verified against local PostgREST 14.15. The prior comment on that function asserted the opposite from an unreproducible manual check. Now `GOLDEN-FIXES.md` #31. |
| F-B7-3 | S2 | Range schemas use lexicographic `>` not instant compare | RESOLVED | All four converted to `Date.parse(...)` instant compares, each carrying `// Instant compare — lexicographic ISO strings break across offsets`: `shift/schemas.ts:78` (`ShiftRangeQuerySchema`), `:106-109` (`ParentEditShiftSchema`), `:132` (`CreateExtraShiftSchema`), `me/schemas.ts:36` (`MeShiftRangeQuerySchema`). Mobile's hand-copy of the parent-edit schema had drifted the same way and now matches its API twin (`apps/mobile/src/api/endpoints/shifts.ts:54-62`), so an inverted edit never leaves the device: `rejects an edit inverted by instant but ordered as text`; `sends an edit that is ordered by instant but inverted as text`. The remaining raw string compares in `schedule.schema.ts` are over `yyyy-mm-dd` dates and `HH:MM` times, which carry no offset — checked, not in scope. |
| F-B7-4 | S2 | `BusyBlocksQuerySchema` does not validate `from < to` | RESOLVED | `availability/schemas.ts:88-101`, refine at `:96` — `Date.parse(data.to) > Date.parse(data.from)`, `message: 'to must be after from'`, `path: ['to']`. It skipped the flawed intermediate state and went straight to the instant compare. Tests include the two cases a lexicographic version would fail: `rejects a range that is inverted by instant but ordered as text`; `accepts a range that is ordered by instant but inverted as text`. |
| F-B8-6 | S2 | Optimistic clock-in stamps device timezone, not household | RESOLVED | `buildOptimisticRunningEntry(input, householdTimezone?)` (`timeEntryMutationUtils.ts:131`, zone resolved `:137-138`) writes the household zone into both `local_date` (`:158`) and `timezone` (`:159`); the device zone survives only as the fallback when no household zone is known. Threaded `ClockInCard.tsx:79` → `useClockIn.ts:80`. Tests: `stamps the household zone and its calendar date, not the device zone`; `falls back to the device zone when no household zone is known`; `files the unconfirmed row under the household zone the card renders in`. |
| F-B8-7 | S2 | Inventory of client-derived figures on hours/money surfaces | **STILL OPEN**, narrowed again | Round 2 documented that `entryMinutes.ts:14-17` mirrors `computeWorkedMinutes`, with the algebraic argument. Round 3 stopped it being an argument: the shared vectors of F-B10-6 make both implementations assert against the same table, so the mirror is now *tested* rather than reasoned about. **The finding itself is unmoved** — `ParentWeekView` and `MarkTimeOffPaidSheet` still derive their figures on the client, and nothing this round touched them. This is one of the two rows deliberately left open at closeout. |
| F-B9-6 | S2 | Mobile Sentry omits `environment`/`release`; `setUserContext` never called | RESOLVED | `_layout.tsx:46` — `environment: Updates.channel ?? (__DEV__ ? 'development' : 'production')`, so the environment is the EAS update channel rather than a guess; `:47` `release: steadilynanny-mobile@${appIdentity.version}`; `dist` omitted deliberately with a comment (`:48-51`). Identity via `sentryBreadcrumbs.ts:33` `setUserContext` → `Sentry.setUser({ id })` — **id only, no email**, pinned by `calls Sentry.setUser with only the id field — no email`. The part that mattered most was the teardown: an identity that outlives the session attributes the next user's crashes to the last one, so `clearUserContext` fires on **every** session-drop path, unconditionally — `signOut()` in a `finally` (`auth.ts:149`, because supabase-js can resolve a signOut *error* with no `SIGNED_OUT` event), the 401 handler in a `finally` (`:311`), both refresh-failure branches (`:330`, `:337`), the revoked-user launch check (`:365`), the no-user branch (`:383`), and the `SIGNED_OUT` event (`:426`); account delete routes through `signOut()`. Eight tests, including `signOut() clears local session and Sentry context even when supabase resolves a non-4xx error`. One unrelated gap found in the same code and recorded as C31. |
| F-B9-7 | S2 | API PostHog client initialised but never `capture()`s | RESOLVED — deleted rather than wired | `apps/api/src/config/posthog.ts` no longer exists, no `posthog` reference remains anywhere in `apps/api/src`, and the dependency is out of `apps/api/package.json`. Deleting beat wiring it up: nothing had asked for API-side product analytics, and an initialised client that captures nothing is a credential and a network dependency in exchange for no signal. Residue, harmless: the untracked local `apps/api/.env:42` still carries a now-dead `POSTHOG_API_KEY`. Mobile PostHog is untouched. |
| F-B9-8 | S2 | Corrupt frozen `earnings` JSON served as `hours_only` with no alert | RESOLVED | `timesheetQueryService.ts:236` — `logger.error('Frozen earnings snapshot unreadable', …)` fires before the `hoursOnly(row, UNREADABLE_SNAPSHOT)` return at `:245`, so it reaches Sentry via the transport. Test: `LOGS the corrupt snapshot — a silently degraded week is one nobody fixes`. |
| F-B9-9 | S2 | Jobs return HTTP 200 / `job_runs` success when `errorCount > 0` | RESOLVED | `jobHandlerFactory.ts:81-93` — `JobRunService.complete` still runs **first** (`:81`, so the counts are never lost), then `errorCount > 0` logs at `error` (`:87-91`) and forwards `JobCompletedWithErrorsError` (`:92`), failing the response. The reconcile summary folds `needsHumanCount` into `errorCount` (`jobController.ts:36`); `stillUnpaidCount` is deliberately **excluded** — it pages ~16×/overnight on a transient self-healing state that 056's `cancellation_unsettled` check catches in its durable form. Tests: `logs at error level, fails the response, and still completes the run`; `reads errorCount off the mapped summary, not the raw result`; `folds needsHuman into errorCount, but not stillUnpaid`; `a clocked-in carer does not fail the run`. |
| F-B9-10 | S3 | Morgan logs every request at `info`, burying payroll errors | RESOLVED | `middlewares/logger.ts:71` — `level: env.LOG_LEVEL` off the validated env object (imported `:5`), and access lines now go through `logHttpAccess` at the `http` level (`:93-95`), below `info`, so a payroll error at `error` is no longer one line among thousands. No `process.env.LOG_LEVEL` remains in `apps/api/src`. Tests: `comes from validated env.LOG_LEVEL, not raw process.env`; `access lines log at http level, not info`. |

## Observational — tests, CI, config, monitoring

| id | claim | status | evidence |
|---|---|---|---|
| F-B10-1 | Money-path controller/repo tests assert mocks, not computed figures | **STILL OPEN at the controller layer**, closed at the service layer | The service half is done and is recorded under F-B10-4 below. The controller half is not: `apps/api/tests/unit/domains/timesheet/controllers/timesheetController.test.ts` still has **12** `toHaveBeenCalledWith` assertions and asserts no arithmetic anywhere. The one money value in the file, `gross_minor: 14_800`, is a stub fixture at `:22` echoed back verbatim by the `toEqual` at `:310` — a literal on both sides of the assertion, which is precisely the shape F-B10-4 was written to kill. Deliberately **not** claimed as closed: the service layer is where the arithmetic lives and where the vectors now bite, but a controller that reshapes a figure on the way out would still not be caught here. This is the second of the two rows left open at closeout. |
| F-B10-2 | No integration test exercises RLS with an authenticated JWT | RESOLVED | `apps/api/tests/integration/rls.integration.test.ts` — 12 assertions across three describes, driven by real parent and nanny JWTs against the local stack, run in CI at `ci.yml:296-300`. Covers exactly the surface 049/052 rewrote: `P1 cannot escalate a membership role (F-B3-1 / I-43)`, `P1 cannot INSERT a shift`, `N1 cannot SELECT household 2's time entries`, `children cannot be hard-deleted (soft-delete invariant)`, and eight more. Proven discriminating (weakened copies of the policies fail it), and it refuses to run against a non-localhost `SUPABASE_URL`. Lives outside `qc`'s glob — it needs a database, so `bun run qc` stays offline. |
| F-B10-3 | Aside from `payArrangementRoutes`, no money-path route tested through real Express middleware | STALE | The claim as written no longer holds: `apps/api/tests/unit/domains/timesheet/routes/householdTimesheetRoutes.test.ts` now mounts both household-nested timesheet routers with the real `validate`/`errorHandler`. The underlying gap is narrower, not closed — expense and PTO routes still have no route-level test. |
| F-B10-4 | Every `approve` test mocks `computeForWeek`; freeze path never runs real arithmetic | RESOLVED | `tests/unit/domains/timesheet/services/timesheetCommandService.test.ts:2528` — describe `TimesheetCommandService.approve — freezes figures computed by the REAL earnings engine (F-B10-4)`, test `freezes a gross the engine derived from the week's actual entries, half-up at the exact .5 boundary`. A real `WeekEarningsService` is constructed at `:2517` over seven in-memory repository fakes and injected as the ninth ctor argument (`:2562`) — no `mock.module` anywhere in the file. It is pinned at a **true** half-up boundary rather than a number that merely looks like one: 543 min × 1850 = 16,742.5 → **16,743**, with the integer derivation spelled out at `:2542-2548` and the decimal cross-checked. The same test also forces a real `valid_from` tie-break and mixes `+00:00` with `.000Z` `created_at` spellings, so it would fail under GOLDEN-FIXES #25's bug. **Scope, stated honestly:** the eight older stubbed approve tests remain — this is an additive real-engine case, not a conversion of the file. |
| F-B10-5 | No test for worked hours + unreverted PTO on the same `local_date` | RESOLVED | `tests/unit/domains/pay/services/earningsService.test.ts:793` — `prices worked minutes AND PTO on the SAME local_date — additively, never one instead of the other (F-B10-5)`, with the purity half at `:846`: `never counts same-date PTO toward the overtime threshold — only worked minutes do (F-B10-5)`. Third at `weekEarningsService.test.ts:503` — `keeps a worked entry and a PTO usage row on the SAME local date BOTH — the netting groups by time_off_id, never by date (F-B10-5)`. The second is the one worth keeping: an additive-but-threshold-polluting implementation passes the first test and overpays overtime. |
| F-B10-6 | API and mobile break-rounding differ; no shared golden vectors | RESOLVED | `packages/shared-types/src/testVectors/minuteVectors.ts` exports `MINUTE_VECTORS` (`:42`) and `CANCELLATION_VECTORS` (`:142`), consumed by **both** implementations: API at `apps/api/tests/unit/domains/timesheet/utils/workedMinutes.test.ts:13` and mobile at `apps/mobile/src/domains/timesheet/__tests__/entryMinutes.test.ts:9`. The prose argument round 2 left behind is now redundant — the two can no longer drift without one suite going red. |
| F-B10-7 | `effectiveOn` duplicated in SQL repo and in-memory engine, no cross-assert | RESOLVED | `tests/unit/domains/pay/services/effectiveOnParity.test.ts` — one vector table run through three describes (`PayArrangementRepository.effectiveOn`, `earningsService.effectiveOn`, and `the two agree, vector for vector`), 15 vectors covering the `valid_from` tie-break, the same-day correction, 065's `valid_to` boundary in both directions, and two explicitly named `GOLDEN-FIXES #25` cases. **The parity test found a real bug while being written**, which is the argument for it: the sibling repository test's PostgREST emulator was ordering by raw string compare — modelling #25's defect rather than Postgres's behaviour — so the emulated repository and the real one disagreed. Fixed at `payArrangementRepository.test.ts:63-79`, which now `Date.parse`es both sides and falls back to string compare only when either is unparseable. **One leftover:** the header comment at `effectiveOnParity.test.ts:38-50` still claims the sibling compares as strings, and is now stale — see the stale-comment note in the round-3 section. |
| F-B10-8 | Child-commitment fixtures use `'09:00'` not wire `'09:00:00'` | RESOLVED | `tests/unit/domains/child/services/childCommitmentCommandService.test.ts` — `'09:00:00'` / `'12:00:00'` at `:20-21`, `:88-89`, `:94-95`, `:113-114`, `:135-136`; zero occurrences of bare `'09:00'` remain. The file header (`:9-10`) records why it matters: the ordering refine is a string compare, so mixed precision passes silently. The schema side was hardened in the same pass — `wallClockMs` (`child.schema.ts:126`) normalises both spellings so `'09:30'` vs `'09:30:00'` cannot read a zero-length commitment as valid, and the refine now exists on **update** (`:150-160`) as well as create (`:133-136`); update previously had none. |
| F-B10-9 / F-B11-8 | `bun run qc` runs neither the coverage script nor thresholds | **CLOSED AS INFEASIBLE** | Thresholds exist and are correct — `apps/api/bunfig.toml:9` (`lines/functions/statements = 30`) and `apps/mobile/bunfig.toml:8` (`= 25`). They cannot be added to `qc`, because coverage is a **whole-suite** measurement and this repo cannot run a whole suite: `bun test` leaks `mock.module()` registrations across files in one process, which is why both apps run one file per process (`docs/09-TESTING.md:32-34`, `CLAUDE.md:34`). Measured, not assumed: `bun test --coverage` over the API suite gives **914/1024** against green-per-file, and the mobile suite hangs. A concrete instance was reproduced while verifying F-B4-10 — `jobRunService.test.ts` and `jobHandlerFactory.test.ts` each pass alone (12 and 3), and together give 11 pass / 1 fail, because the factory file `mock.module`s the whole `jobRunService` module and bun's module mock is process-global. Coverage-in-`qc` therefore requires either abandoning per-file isolation or a merge step across ~600 per-file coverage reports; neither is worth it for a 25–30% floor. `scripts/qc.sh:52` stays `CHECKS=("test" "lint" "format:check" "typecheck")`. Reopen only if the runner gains real module-mock isolation. |
| F-B10-10 | CI reimplements the one-file loop instead of calling the script | RESOLVED | `.github/workflows/ci.yml:80` — `run: bash scripts/run-tests-one-file.sh tests/unit`, under the job-level `working-directory: apps/api` (`:62-63`), with a comment (`:77-79`) citing `docs/09-TESTING.md` and scoping out `tests/integration`. One definition of the loop, not two that can drift. |
| F-B11-1 | Migrations `047`/`048` in repo but unapplied in prod; `048` before `047` breaks reminders | RESOLVED | All of 047–055 applied to production per the team lead's report. Ordering concern is moot once both are applied in filename order. **Caveat: not verifiable from this repo**, which holds no production state — this row rests on that report, not on a check I ran. |
| F-B11-2 | CI never applies/validates migrations against a fresh DB | RESOLVED | `ci.yml:263` — a `DB - Migrations + RLS` job pins the Supabase CLI at `2.95.4` (`:278`), runs `supabase start` (`:279-284`), then `supabase db reset --local` (`:285-286`, step name `Apply every migration to a fresh database`). All 61 migrations now **execute** against a fresh PG15 on every push, not just parse. Verified locally too: `supabase db reset --local` runs 001–061 clean. |
| F-B11-3 | CI has no `shared-types` lint/format jobs | RESOLVED | `ci.yml:232` `shared-types-lint` (`run: bun run lint`, `:249`) and `:251` `shared-types-format` (`run: bun run format:check`, `:268`), both under `working-directory: packages/shared-types`. The header comment at `:6` was updated with them — "2 apps × 4 checks + 4 shared-types + 1 scripts + 1 db = 14 jobs" — and the file has exactly 14. |
| F-B11-4 | Production EAS inlines only `EXPO_PUBLIC_API_URL`; Supabase vars default empty | RESOLVED for Supabase; **opened a release blocker** | `eas.json:31-32` now carry `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in the `production` profile. **`:33` is `"EXPO_PUBLIC_SENTRY_DSN": "TODO-SET-BEFORE-BUILD"`** — a placeholder, not a DSN. A production build made today ships with mobile crash reporting silently off, which is worse than the state F-B9-6 just fixed, because the environment and release tags now exist and go nowhere. Note `SENTRY_ALLOW_FAILURE: "false"` (`:38`) does **not** save you: it fails a build on a broken source-map *upload*, not on an unset DSN. The owner will supply the real value; until then this is a release blocker, and it is listed as such in the round-3 section rather than buried here. |
| F-B11-5 | No API/mobile contract version gate while OTA is enabled | **PARTLY RESOLVED** | Headers exist: `apps/mobile/src/api/client.ts:41-42` sends `X-App-Version` and `X-App-Runtime-Version` on every request, and the server reads `x-app-version` at `appStatusRoutes.ts:49` feeding `appStatusService.ts:162`'s `updateRequired` comparison, which mobile honours through `useAppStatus` → `AppGate` → `ForceUpdateScreen`. **It is not a gate.** It is a client-honoured force-update advisory on one endpoint — no middleware rejects an under-version request on any other route, and the code says so itself (`client.ts:39-40`: *"log-only for now — server-side minimum-version rejection is the upgrade path"*). Two gaps found while checking it: the server reads `x-app-platform` (`:50`) which **the client never sends**, so `platform` always defaults to `'ios'` and an Android user on a forced update is shown the iOS store URL; and no test covers the header-reading route, only `compareVersions`. Recorded as C30. |
| F-B11-6 | Bootstrap `ChildrenScreen` shows an infinite spinner on create failure | RESOLVED | `ChildrenScreen.tsx:88-91` — the catch resets the ref **and** sets `bootstrapFailed`; `:152-158` renders `<ErrorState variant="generic" onRetry={retryBootstrap} />` in place of the spinner. Tests: `shows a retry affordance when household bootstrap fails, instead of spinning forever`; `re-attempts the bootstrap when the retry affordance is pressed`. **The interesting part is why the first version of this fix did not work.** The flag was listed in the dependency array but never read in the effect body, so `biome check --write --unsafe` — which `bun run format` runs — deleted it as an extra dependency, and the retry silently stopped re-running. Author and reviewer were both green; the gate's own format step broke it and the gate's test run caught it. The flag is now read at `:66` (`if (bootstrapFailed) return;`) with the reason in a comment at `:60-65`. Now `GOLDEN-FIXES.md` #30. |
| F-B11-7 | API requires `GOOGLE_VERTEX_PROJECT` at boot in all non-test envs | RESOLVED | `env.core.ts:44-47` — `z.preprocess(val => (val === '' ? undefined : val), z.string().min(1).optional())`, and it is absent from `productionRequiredCoreKeys` (`:77-80`). `llmProvider.ts:31-33` throws a named error only when a model factory is actually invoked, so the failure moved from "boot" to "the first call to a feature nothing uses". The `''` → `undefined` preprocess is not incidental: `.env.example` ships these keys with empty values, and a bare `.optional()` treats `''` as present-and-too-short, so a verbatim copy of the example file crashed boot. `SENTRY_DSN` had the identical defect (`:54-57`) and got the same treatment. Tests: `parses successfully without GOOGLE_VERTEX_PROJECT (F-B11-7: optional until an LLM call is actually made)`; `treats an empty-string GOOGLE_VERTEX_PROJECT as unset, not "too small" (D2: an empty env block value must not crash boot)`; `treats an empty-string SENTRY_DSN as unset, not an invalid URL (D2: verbatim .env.example ships SENTRY_DSN=)`. |
| F-B11-9 | `BaseRepository` uses `as any` at every write boundary | RESOLVED — **and the row's own citation was wrong** | The file is `apps/api/src/shared/repositories/baseRepository.ts`; `apps/api/src/repositories/baseRepository.ts`, which this ledger cited for two rounds, does not exist. No `as any` remains: `:56` `.insert(data as Record<string, unknown>)`, `:76` `.update(data as Record<string, unknown>)`. |
| F-B11-10 | `apps/mobile/assets/_staging/` untracked and not gitignored | RESOLVED | `.gitignore:76` — `apps/mobile/assets/_staging/`. |
| F-B11-11 | Root `package.json` documents missing `patchedDependencies` | RESOLVED — **and it was already resolved when this row last said otherwise** | `package.json:40` is a dated decision, not a TODO: the source repo's three patches (expo-constants, expo-updates, @sentry/react-native) were evaluated on 2026-08-06 against this template's pinned versions, the original bugs did not reproduce, and the note says to reintroduce `patchedDependencies` only if they resurface. The only `TODO(porting)` string left anywhere in the repo was **this ledger row**, which is the exact failure mode the ledger exists to prevent — a status asserted from a stale reading of the file it cites. |

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

**The `.env` trap bit three times in one session, and that is the pattern worth keeping.**
Two tools default to the production `.env` unless every variable is explicitly exported:

1. An early RLS-test run hit **production** rather than the local stack, because `bun`
   auto-loads `apps/api/.env`. It created and then fully deleted 3 users and 2 households;
   cleanup was verified, and RLS passed there too. The localhost guard in
   `rls.integration.test.ts` exists because of that run.
2. The same mechanism, caught before it did anything.
3. During the mobile pass, a **stale Metro from Aug 5 was found serving PRODUCTION
   Supabase** — no `EXPO_PUBLIC_*` overrides in its environment, so it had fallen back to
   `apps/mobile/.env`. Killed. A long-lived dev server is the dangerous case: nothing
   re-reads its environment, so it keeps serving whatever it started with, and the
   simulator gives no indication which backend it is talking to.

Written up as `GOLDEN-FIXES.md` #26 — three occurrences is a pattern, not bad luck.

### Live API validation

Every remediation item was then exercised against the **running API** with real JWTs and
direct database assertions — an evidence class distinct from the unit suite, and the first
time most of this code has been driven end to end. Details and per-item results are in
[`CLOSURE-TABLE.md`](./CLOSURE-TABLE.md) → *Execution evidence beyond tests*. The headline:
both overnight splits conserved exactly, F-B9-9 proved out composed (seeded violation ⇒ HTTP
500 **and** a `job_runs` row of `failed|1`), and a final `run_integrity_checks()` over
everything the run had created returned **zero violations**.

### Mobile CX validation

A second pass then drove the **mobile app itself** — real simulator, dev build, local
stack — which is the only evidence class that sees what a carer or parent actually reads.
Every remediation item was confirmed **on screen**:

- **The C1 S0 renders correctly.** Two same-named departed Emmas produce **two tabs**, with
  the header, the approve dialog and the approved total each bound to the tab on screen.
  The live card names the snapshot carer rather than `"Someone"`.
- **Split fragments render under their own days**, with **no false "edited" badge** on
  fragment A — the `endsAtLocalMidnight` suppression working as designed.
- **Cancellation rows show the authoritative figure** — 480 stored minutes render as `8h`,
  not a re-derived span — and a legitimate **0m fragment shows no zero-duration warning**
  (C12's exemption, seen rather than reasoned about).
- **F-B8-6 renders in household time**, not device time.
- **Approve froze £573.81, penny-exact against the database.** The one number in this app
  that must never be approximately right.

**Co-parent approvals were not exercised in this pass either** — the same short-notice-window
constraint. It is now the only remediation-adjacent surface unvalidated at runtime across
**both** passes, which promotes it from a gap to the single most valuable probe left.

### Open items found during validation

Not defects in the remediation work — things the runs surfaced by driving the API and the
app as a user would. **D2–D6b** come from round 2's mobile pass; **D7–D10** from round 3's
first device pass and **D11** from the adversarial review of D8's fix. None is filed as a
numbered audit finding.

| Observation | Why it matters |
|---|---|
| **Conflict statuses are inconsistent.** A duplicate expense returns `400 VALIDATION_ERROR`; the equivalent conflict elsewhere returns `409 CONFLICT`. | A client cannot branch on "this already exists" uniformly. Cheap to align, and the 409 shape is the right one. **RESOLVED** — `DuplicatePendingClaimError` (`payErrors.ts:179`) now extends `ConflictError`, so `expenseRepository.ts:108` maps the 23505 from `expenses_one_pending_claim_idx` to **409**, with the `DUPLICATE_PENDING_CLAIM` discriminator kept in `metadata.reason`. Pinned by `translates the 23505 from expenses_one_pending_claim_idx into a 409 conflict`, which asserts the status rather than the class. |
| **Extra-shift adoption is indistinguishable on the wire.** A request that *adopted* an existing shift after losing the 059 race returns `data.status: 'created'`, exactly as a genuine create does. | This is the **mechanism behind** the adopted-double-tap re-push recorded as a C4/C5 residual (`RESIDUAL-RISK.md` §1.1) — the client cannot tell it should not re-notify. An `adopted: true` flag on the response would close both. **RESOLVED, and it closed both.** `CreatedExtraShiftResultSchema` carries `adopted: z.boolean().default(false)` (`shift.schema.ts:353`); the service returns `adopted: true` on both adoption arms — the in-window pre-check (`shiftChangeRequestCommandService.ts:614`) and the lost 059 race (`:660`) — and `false` only on a genuine create (`:684`). The **server-side** duplicate push is suppressed at the same time (`:549`, `if (!adopted) this.notifyExtraShiftProposed(shift)`), and the client suppresses its toast: `skips the success toast and clash-warning toasts when the created shift was adopted`; `still invalidates the shift/me caches and requests a calendar sync when adopted`. The default keeps an older client parsing: `defaults adopted to false when the response predates the field`. |
| **PTO balance/ledger and `/me/change-requests` return a bare 400 on a missing query param**, with no indication which one. | Ordinary API ergonomics; costs an integrator a round of guessing. **RESOLVED centrally rather than per route** — `ValidationError.summarise` (`apps/api/src/errors/ValidationError.ts:14-22`, called from `fromZodError` at `:49`) folds the failing Zod issue paths into the message, so the response now reads `Validation failed: year (Invalid input: expected number, received undefined)`. Capped at three issues with a `(+N more)` tail so a wide schema cannot turn one 400 into a wall of text. Because both routes validate through the shared `validate(schema, 'query')` middleware, this fixed **every** hintless 400 in the API, not the two the observation named. |
| **The PTO accrued/used split reads oddly after a correction** — the balance itself is correct, the two components it is presented as are not intuitive. | Presentation, not arithmetic. Worth a look before a parent reads it. **Still open.** Untouched in round 3 — it needs a product answer about what the two components should mean after a correction, not a code change. |
| **There is no timesheet submit route** — a week goes `open` → `approve` directly, with no `submitted` transition exposed. | The `submitted` status exists in the schema and the approve CAS keys on it. **RESOLVED AS INTENDED — not a missing route.** The owner confirmed auto-submit is the product, and the decision is now written where the next reader will hit it, at the `TIMESHEET_STATUSES` declaration (`packages/shared-types/src/schemas/timesheet.schema.ts:40-51`): *"PRODUCT DECISION (owner, 2026-08-06, audit closeout): there is deliberately NO carer-facing submit step. `rollUpIntoTimesheet` births every timesheet as 'submitted' the moment hours land … 'open' is therefore a dead value — 017's column default that no code path ever writes — kept only so the DB CHECK and this enum stay aligned … Do not "fix" the missing submit route; an explicit submit model was considered and declined."* Worth noting the second half of that comment: `open` being unreachable is the thing that made this look like a missing route. |
| **D2 — retroactive entries are falsely badged "· edited".** `wasEntryEdited` (`apps/mobile/src/domains/timesheet/utils/entryEdited.ts:38`) infers an edit from `updated_at > clock_out_at + slack`. A retroactive entry is *written* after the work happened, so the predicate is true on a row nobody ever edited. | Tells a parent a carer amended hours she did not amend — the badge exists to flag exactly that, so a false one is worse than none. **RESOLVED** — `entryEdited.ts:44-47` now compares `updated_at` against `max(clock_out_at, created_at)`: an ordinary session is born at clock-IN and settled by the clock-out write, a retroactive entry is born complete, so the later of the two is the row's real settling point. Red first — the retro fixture returned `true` against the old predicate (11 pass / 1 fail). Two pins matter: the **ordinary-session pin is what killed the naive `created_at`-only fix**, whose two timestamps are a whole shift apart by design and which would have badged every normal session instead; and an ordering check confirming the fragment-A midnight exemption still short-circuits ahead of the new comparison. **Residual:** the badge is still a two-timestamp heuristic — any future bulk server write to `time_entries` badges every row it touches. Upgrade path is a `time_entry_edits` table; the first disputed correction pays for it. |
| **D3 — signup swallows Supabase's 422 password error and clears the field.** | The user is told nothing and retypes blind. **RESOLVED** — client-side minimum-length check (`src/lib/passwordPolicy.ts`, matches Supabase's default 6), the `weak_password` code/message mapped in `errorLocalization.ts`, and the field proven retained on failure. The "clearing" itself was never the app: on-device isolation showed iOS Strong-Password AutoFill swallowing keystrokes (plus a Maestro `hideKeyboard` artifact) — no JS path clears it, and the render test pins retention. |
| **D4 — `empty-pending.png` has a transparency checkerboard baked into the pixels** (SchedulePendingScreen). | **RESOLVED, and it was 4 assets, not 1** — the neutral-pixel scan found the same baked-in checker in `empty-inbox`, `empty-time-off`, and `empty-today`; all cleaned programmatically (cream fill where the siblings use paper fill, true transparency for the cup-handle hole), verified on-screen. Whatever generated that batch bakes the checkerboard into fills — re-scan any future illustration (the detector: opaque pixels with `R==G==B` above luminance 200). |
| **D5 — create-account screen shows a white header band against the cream background.** | **RESOLVED** — the band was the native iOS stack header painting white over the cream background; `auth/_layout.tsx` now hides it for the auth stack, and create-account renders identically to sign-in (verified on-screen, same title y-position). |
| **D6a — the invite screen shows neither role nor expiry for a generated code.** | **RESOLVED** — role and `expires_at` were already on the wire; `InviteCodeCard` now renders "Nanny invite · expires Sep 5" (verified on-screen for both roles). Still compounds C9: a wrong code can be identified now, but not revoked. |
| **D6b — an empty-string `EXPO_PUBLIC_POSTHOG_API_KEY` triggers a dev LogBox error.** | **RESOLVED, two rounds** — skipping the provider only moved the `console.error` into `usePostHog`'s own `warnIfNoClient` (posthog-react-native 4.54.4). The shipped shape always constructs a client, `disabled: true` when unconfigured; on-device sink-verified that the disabled client sends **zero** requests and the enabled client captures and flushes. |
| **D7 — both destructive confirm buttons in the app were INERT** (remove-a-member, withdraw-a-pattern). Found on device, in work that had already passed unit tests **and** adversarial review. `AlertDialogAction` forwarded the caller's *button* class string into the *label's* class context, so the `<Text>` got `active:opacity-90`, css-interop attached press handlers to it, RN set `isPressable`, and responder negotiation — deepest-first — let the label steal the tap from the `Pressable` beneath. | A parent could not remove a member and a carer could not withdraw a pattern; the dialog opened and the button did nothing. **RESOLVED** at `apps/mobile/src/components/ui/alert-dialog.tsx:159-163` — the label context is `buttonTextVariants()` with no caller string, the caller's class goes only to the box. Fixes all **eight** call sites across six screens at once. Now `GOLDEN-FIXES.md` **#33**. The reason it shipped green is a ceiling in its own right: `bun.setup.ts:536-537` stubs `buttonVariants`/`buttonTextVariants` to `''`, so **no test in this repo can observe a button class** (**C32–C44** → C38). The new test re-mocks with a real `cva` rather than trusting the global stub. |
| **D8 — a removed member had NO route to her own pay.** `GET /v1/households` returned only active households, so every mobile payroll surface — all of which take their household id from `useActiveHousehold` — had nothing to point at. This is **C18**, met on screen. | The API read gates round 3 built were serving correctly to a client that could not ask. **RESOLVED** — `listByUserAnyStatus` (`householdMemberRepository.ts:134`) behind `GET /v1/users/me/memberships`, `isPastMember` derived at `useIsOnboarded.ts:178`, and a Past-households section plus a Past badge in `HouseholdSwitcher`. **Read the next row before treating this one as closed by its first fix.** |
| **D9 — `scripts/seed-test-users.ts` and two siblings read `apps/api/.env`, which points at PRODUCTION** — and `docs/DAYLIGHT-VISUAL-QA.md` told people to run them. A documented QA step that creates real auth users and writes real rows with a service-role key. | Third occurrence of the `GOLDEN-FIXES.md` **#26** class, and the first where a doc actively pointed at the loaded gun. **RESOLVED** — `scripts/localSupabaseGuard.ts`'s `assertLocalSupabaseUrl` runs before the client is constructed in all three scripts, with **no flag to bypass it**, and `DAYLIGHT-VISUAL-QA.md:27` now states the refusal and the `supabase start` prerequisite. Pinned as a class, not a fix: `every service-role seed script guards its client`. |
| **D10 — a FUTURE clock-out finish time was rejected silently.** The sheet refused to submit and said nothing about why. | The carer retypes blind — same shape as D3. **RESOLVED** — `ClockOutSheet.tsx:244`, with a 60-second tolerance (`:76`) so the client and the eventual server 400 agree on what "future" means, a rendered message and a disabled CTA. The pin that matters is the one protecting the legitimate case: `does NOT flag the overnight roll as a future finish, even though the rolled instant lands after this test's nowMs`. |
| **D11 — time-off create, cancel and update had NO membership gate at all.** A removed member got **201**, and cancel appended adjustment rows to a past household's `pto_ledger`. Found by the adversarial review of D8's fix, not by the device pass. | **A money write by a non-member** — the most serious thing this round found, and the device pass walked past it because the screen looked right. **RESOLVED** — all three route through `assertActiveMember` (`timeOffCommandService.ts:85`, `:136`, `:175`), pinned by `refuses a cancel from a caller with no active membership and attempts NO pto_ledger write` and four siblings. The gate is deliberately "holds **any** active membership" rather than "active here", because `carer_time_off` carries no `household_id`; reasoning and consequences at ceiling **C37**. |
| **Fixed in the same round, found by the re-validation itself:** `EmptyState`'s `default` variant collapsed (no flex on its `Animated.View` root — GOLDEN-FIXES #2 class) painting the Schedule empty state over the segmented control, now `flex:1` inline-style with only the two `variant="default"` call sites affected; the clock-out sheet previewed **and would have submitted** a 24h session when finish equalled start (the overnight wall-clock roll's `<=`), now collapsed to 0m at equality with the overnight case pinned; household member cards showed two identical "Finish setting up Nanny" labels — `profile_name` now rides the member payload (PostgREST embed) with the override → profile → role-label chain in the shared resolver. Five single-carer inline copies of that chain remain (Pay/Schedule screens, listed in the setup-lane report) — same class, lower stakes, they show "Nanny" for one person rather than merging two. |

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

---

## 2026-08-06 — audit closeout (round 3)

Branch `audit-closeout-final`, three commits (`69ce91a` waves 1–2, `56a986d` wave 3,
`3342add` wave 4). This is the pass that empties the ledger of everything it can honestly
empty, and says plainly what it cannot.

**Closed from this ledger (23):** F-B2-6, F-B4-10, F-B5-5, F-B6-4, F-B6-5, F-B7-3, F-B7-4,
F-B9-6, F-B9-7, F-B9-10, F-B10-4, F-B10-5, F-B10-6, F-B10-7, F-B10-8, F-B10-10, F-B11-3,
F-B11-4, F-B11-6, F-B11-7, F-B11-9, F-B11-10, F-B11-11. Partly: F-B11-5. Closed as
infeasible: F-B10-9 / F-B11-8. Three migrations shipped — `063` money upper bounds, `064`
change-request expiry, `065` pay-arrangement end-on-removal.

### The four evidence classes

Round 2 established that each new evidence class finds defects the previous one cannot see.
Round 3 ran four, and that held again — most sharply in the fourth, which was added after
everything below was already committed.

1. **The unit suites.** Final `bun run qc` green: mobile **2078**, API **2455**,
   shared-types **389**, scripts **24**. Useful, and the weakest of the three — most of the
   round's test work was spent making these assert *computed* figures rather than the
   stubs that produced them (F-B10-4 through F-B10-8).
2. **The co-parent approval runtime probe** — the gap both prior passes left open. All
   **7 probes OK**; the approval state machine is sound. Its findings were all peripheral
   to the state machine itself: a missing nanny push on the approved-cancel path, a boot
   trap, and silent terminal failures. All three fixed in wave 3. Written up in
   [`CLOSURE-TABLE.md`](./CLOSURE-TABLE.md) → *Round 3*.
3. **A live API run over the whole wave-4 surface** — roughly **150 checks** against the
   running API with direct database assertions. Removal preserved the payroll trail 50/50;
   a rejoin priced the historical week at the old rate and the new week hours-only with the
   gross field **absent, not zero**; revoke 7/7; duplicate expense 409; the `adopted` flag
   with exactly one shift row behind it; 064's sweep exact at the 7-day boundary (a request
   at 6d23h untouched); all five of 063's CHECKs convalidated and biting; both computed
   money guards firing before any write; and a final `run_integrity_checks()` over
   everything the run created returning **zero violations**.
4. **Two device passes — the app on a simulator against a dev build (wave 6).** The
   strongest instrument this effort has used, and the last one it reached for. Pass 1
   found **four** defects (**D7–D10** above), every one of them in work that had already
   passed unit tests *and* adversarial review. Pass 2 was the gate and confirmed all four
   on screen with the database checked behind each. Full account in
   [`CLOSURE-TABLE.md`](./CLOSURE-TABLE.md) → *Evidence class: the mobile CX device
   passes*; the thirteen ceilings it accepted are **C32–C44** in
   [`RESIDUAL-RISK.md`](./RESIDUAL-RISK.md) §1.3.

### The device passes, and the one thing they still could not see

**Three of the four defects in pass 1 were invisible to every test in this repo**, and one
of them structurally so: `bun.setup.ts:536-537` stubs `buttonVariants` and
`buttonTextVariants` to `''`, so no mobile test can assert a button class — which is exactly
how two inert destructive confirm buttons (D7) passed a suite and a review. The unit suite
was not weak there; it was blind, and it is still blind, because fixing the stub means
re-checking every test that touches a class string in one pass. That is ceiling **C38**, and
it is the one in this batch most likely to cost something again.

**Then the review of a fix found the fix was dead code.** D8's first cut keyed on an
`isPastMember` flag that was **permanently false** — it derived from
`GET /v1/users/me/memberships`, which filtered to active rows, so nothing could set it and
the removed nanny was still routed into the signup wizard. Its tests passed by mocking a
payload the server could not emit. Same family as `findAbandonedFragment`'s string compare
and the coverage-gap `ignoreDuplicates` premise: the test and the code shared an assumption
about a payload neither had seen. The same review then found **D11** — time-off writes with
no membership gate at all, a money write by a non-member — which the device pass had walked
straight past, because the screen looked right.

So the ordering is the finding, not either instrument on its own. The unit suite missed what
the API run caught; the API run missed what the screen showed; **and the screen missed what a
review of its own fix caught.** A device pass cannot read a filter in a repository method and
a review cannot see an inert button. What closed this round was running both, in that order,
and letting the second audit the first.

Pass 2 is also worth reading for *how* it asserted rather than what it found. Absence of a
write affordance was proven **A/B against an active nanny who does get the Clock in card** —
an absence on its own proves nothing, the contrast does. Disabled CTAs were asserted as
`enabled=false` in the view hierarchy rather than eyeballed. And the clock-out refusals were
proven in the same pass as the legitimate overnight roll that must still submit (clock_in
`2026-08-06 19:00Z` → clock_out `2026-08-07 04:46Z`, read back from the row), which is the
only way to know a new guard is a guard and not a regression.

### The co-parent gap is closed

`RESIDUAL-RISK.md` §3 item 4 named co-parent approvals as "the most valuable remaining
runtime probe" after both prior passes skipped it — the surface is awkward to drive because
it means sitting inside the short-notice window. It has now been driven. The state machine
was sound, which is the outcome that costs the most to establish and is worth the least to
report; the value was in the three peripheral defects the probe surfaced on the way.

### What the review process caught, again

Seven fixes were reopened after being written, reviewed and green. Each is a case where the
test agreed with the code and both were wrong:

- an **env var crashing boot on an empty string** — `.optional()` reads `''` as
  present-and-too-short, so a verbatim copy of `.env.example` would not start;
- **capped inputs multiplying into uncapped money** — the fix as specified capped every
  input and left the product unbounded, which is the figure that actually reaches a payslip;
- a **stale Sentry identity after a failed signOut** — supabase-js can resolve a signOut
  error without emitting `SIGNED_OUT`, so the cleanup had to move into a `finally`;
- an **inert fix built on a false database premise** — the coverage-gap push was written as
  though `ignoreDuplicates` had suppressed the conflict, when the expression index meant it
  never applied at all (now `GOLDEN-FIXES.md` #31);
- a **404 leaking existence** on one of the new read gates;
- **rejoin resurrecting money state** — a reactivated membership silently inheriting the
  terms it left with, which is what `065` exists to prevent;
- **20 fixtures broken by a schema change**, caught by the suite rather than by the author.

### An implementer refused an instruction, and was right

The orchestrator specified a fix for a PTO "stacking bug" on rejoin: a returning member
would supposedly inherit her old balance on top of a new grant. **The bug did not exist.**
PTO balances are year-scoped — `ptoLedgerRepository.listForCarerYear:88` reads a single
`${year}-01-01` … `${year}-12-31` window, and the lazy grant refuses any non-current year
outright (`ptoQueryService.ts:245-250`) — so there is nothing to stack. Implementing the
gate as specified would have denied a January rejoiner the annual grant she is entitled to:
a fix that creates the harm it was written to prevent. The implementer said so instead of
building it, and the leftover balance is now simply **named** in the rejoin push
(`householdCommandService.ts:441`) so a parent can correct it if it is wrong — pinned by
`names the leftover PTO balance so a parent can correct it` and
`says nothing about PTO when there is no balance to carry`.

**This is the fourth time in this effort that an agent has corrected the person directing
it** — after the `manual_adjustment` predicate, the "silent" account-delete failure, and the
two round-2 near-misses (`RESIDUAL-RISK.md` §4). Four for four, the correction came from the
implementer rather than the reviewer. That is a property of the process worth protecting:
the person with the most context on a change is the one being told what to do, and a
workflow where they cannot push back loses exactly the objections that matter.

**And a fifth, in wave 6.** An implementer was told to rewrite a set of green mobile tests
into other green tests. He declined, and argued the case rather than the instruction: the
tests as written were not wrong, the rewrite would produce a differently-shaped green, and
the only honest **red** available lived on the API side, where the behaviour actually was
unpinned. The reviewer, working independently, judged the call correct. Five for five, the
correction has come from the implementer — and this is the first one that was not about
whether the specified behaviour existed but about **where the evidence should come from**,
which is a harder objection to raise and an easier one to overrule. Full account in
[`RESIDUAL-RISK.md`](./RESIDUAL-RISK.md) §4.

### Two things I was told that the code did not support

Recorded because the ledger's own rule is that a claim is checked against the tree, not
accepted from a report:

- **"F-B3b-3 re-verified across 36 call sites."** There is no 36 anywhere. The active-member
  helper is `HouseholdMemberRepository.findActiveMembership` (`:28`), with **28** direct call
  sites in `apps/api/src`, one of which (`householdQueryService.getMembership:59`) is itself
  called at 19 more — 46 distinct authorization points, not 36. The substantive claim holds
  and is the one that matters: exactly three services gate on any-status membership, all
  three are payroll **reads**, and every write path resolves through an active-only helper.
- **"The new week renders hours-only with gross NULL, not 0."** The behaviour is right and
  the names are wrong. The status is **`no_arrangement`**, a distinct member of
  `WEEK_EARNINGS_STATES` from `hours_only`, and `WeekEarningsSchema`
  (`timesheet.schema.ts:365-400`) is a discriminated union whose non-`ok` arms carry **no
  money fields at all** — so the gross is structurally absent, not null. "Never renders
  £0.00" is true; "gross NULL" is not a state this wire format can express.

### What is NOT done

Four things, stated plainly so nobody reads the counts above as "finished":

1. **F-B10-1's controller layer.** The money-path service tests now assert computed figures;
   `timesheetController.test.ts` still asserts 12 mock calls and no arithmetic.
2. **F-B8-7's remaining client-derived surfaces.** `ParentWeekView` and
   `MarkTimeOffPaidSheet` still derive figures on the client. Only the `entryMinutes` mirror
   was closed, and only by testing it.
3. **Coverage in `qc`.** Closed as infeasible under the one-file-per-process design, not
   done. The thresholds exist and nothing runs them.
4. **The release blocker.** `eas.json:33` `EXPO_PUBLIC_SENTRY_DSN` is
   `"TODO-SET-BEFORE-BUILD"`. A production build ships today with mobile crash reporting
   off. Owner to supply; **do not cut a production build until it is set.**

Plus the **thirty** newly accepted ceilings C15–C44 in
[`RESIDUAL-RISK.md`](./RESIDUAL-RISK.md) §1.3 — seventeen from the waves above, three of
which (C24, C26, C30) were found by verifying this round's own work rather than by the work
itself, and **thirteen more (C32–C44) from the two device passes**. That last number is the
honest measure of this round: pointing a person at the running app for two afternoons
produced almost as many known-and-accepted limits as four waves of code review did, and none
of the thirteen was reachable by any instrument used before it.

Two of the thirteen should not sit in a table unread. **C38** — the `bun.setup.ts`
button-class stub — is a standing false-green generator, and it is the reason D7 shipped.
**C41** is the single probe this round leaves genuinely unrun: whether a non-owner parent
sees a Remove control on the owner's card, which the device fixture could not show because
it collapsed the owner and the signed-in user into one person. One SQL insert of a second
active parent membership closes it, and it is the cheapest open item in this ledger.
