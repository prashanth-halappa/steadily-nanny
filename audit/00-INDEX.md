# Steadily Nanny — Confirmed Defect Index

## How to read this
Twelve audit lanes (hours math, pay math, authz/RLS, concurrency, state machines, jobs, wire contracts, mobile render, observability, tests, shipping) traced 77 findings across API, mobile, migrations, and jobs. **CONFIRMED** means an adversarial verifier on a different model family independently reproduced the code trace; severity below is the verifier’s (including downgrades). S2/S3 findings were not adversarially checked and sit in **Unverified**; B10/B11 absence-of-coverage findings are **Observational** after spot-checking cited evidence.

## S0 — wrong money, wrong hours, or wrong access

### Paid-cancellation `local_date` written in shift timezone, rolled up in household timezone
**What breaks:** Paid cancellation hours are saved to `time_entries` but excluded from the week’s `total_minutes` and earnings because `local_date` falls outside the household-week filter.
**Where:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:511-518`, `:546`, `:1160-1172`; `apps/api/src/domains/timesheet/repositories/timeEntryRepository.ts:216-217`; `supabase/migrations/017_time_tracking.sql:108-110`; `apps/api/src/domains/pay/services/weekEarningsService.ts:448`
**Found by:** F-B1-2, F-B2-1 — **independent corroboration by 2 lanes (B1, B2)**
**Trigger:** Household timezone ≠ shift authoring timezone; parent accepts a paid cancellation; `recordCancellationPaidEntry` stamps `timezone: shift.timezone` while `rollUpIntoTimesheet` / `listForCarerWeek` bucket by household timezone.
**Fix:** Write cancellation entries with `timezone: household.timezone` (match clock-in path), or bucket roll-ups by clock-in instant week instead of `local_date` alone.

### Two-carer household Hours UI sums all carers but binds one arbitrary timesheet
**What breaks:** The header shows combined hours for every carer while approve/earnings attach to whichever timesheet `list()` returns first for that `week_start`.
**Where:** `apps/api/src/domains/timesheet/repositories/timeEntryRepository.ts:174-185`; `apps/api/src/domains/timesheet/services/timesheetQueryService.ts:87-99`; `apps/mobile/src/hooks/queries/useWeekTimeEntries.ts:25-26`; `apps/mobile/src/api/endpoints/timesheets.ts:90-97`; `apps/mobile/src/domains/timesheet/components/ParentWeekView.tsx:245-249`; `apps/mobile/src/domains/timesheet/components/NannyWeekView.tsx:193-194`
**Found by:** F-B1-3 (B1)
**Trigger:** Household with two active carers in the same week; parent opens Hours without per-carer scoping.
**Fix:** Scope week entry queries and mobile sums to one `carer_id`; resolve timesheets by `(household_id, carer_id, week_start)`.

### Paid cancellation accept succeeds when time-entry write fails
**What breaks:** Shift is marked `cancellation_paid=true` and the API returns 200, but no payable `cancellation_paid` entry exists — carer is underpaid with no retry path.
**Where:** `apps/api/src/domains/shift/services/shiftChangeRequestCommandService.ts:777-790`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:524-526`; `apps/api/src/domains/shift/controllers/shiftChangeRequestController.ts:55-63`
**Found by:** F-B2-5, F-B5-1, F-B9-1 — **independent corroboration by 3 lanes (B2, B5, B9)**
**Trigger:** `recordCancellationPaidEntry` throws (approved week, DB error, roll-up failure) after the cancel RPC commits; catch logs and continues.
**Fix:** Propagate failure from `respond` (or compensating-clear `cancellation_paid`); never return success without a matching `time_entries` row.

### Parent can force-accept schedule patterns without carer consent
**What breaks:** A parent can PATCH `status: "accepted"` on a draft pattern, then materialise confirmed shifts the carer never agreed to — gateway to clock-in and paid-cancel paths.
**Where:** `packages/shared-types/src/schemas/schedule.schema.ts:100-103`; `apps/api/src/domains/schedule/services/schedulePatternCommandService.ts:138-146`; `apps/api/src/domains/schedule/controllers/schedulePatternController.ts:66-73`; `apps/api/src/domains/schedule/services/scheduleMaterialisationService.ts:191-199`
**Found by:** F-B3b-1, F-B7-2 — **independent corroboration by 2 lanes (B3b, B7)**; verifier downgraded F-B7-2 to S2 (mobile unused), merged here at S0 for the API hole.
**Trigger:** Parent `PATCH /schedule-patterns/:id` with `{ "status": "accepted" }` while pattern is `draft`; then amend or horizon job materialises `confirmed` shifts.
**Fix:** Remove `status` from `UpdateSchedulePatternSchema`; whitelist updatable fields and route accept through `respond` only.

### Removed nanny can still edit hours and pending expenses
**What breaks:** After membership is set to `removed`, the carer can still PATCH time entries and pending expenses because ownership checks `carer_id` only, not active membership.
**Where:** `apps/api/src/domains/timesheet/services/timesheetQueryService.ts:71-79`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:326`, `:590`; `apps/api/src/domains/pay/services/expenseCommandService.ts:426-439`, `:228-280`
**Found by:** F-B3b-3 (B3b)
**Trigger:** Parent removes carer (`status = 'removed'`); carer JWT still mutates existing entries or pending expense `amount_minor`.
**Fix:** Require `findActiveMembership(household_id, callerId)` in `getOwnedTimeEntry` and `loadOwnedPending` (same 404 collapse as timesheet reads).

### Parent JWT can escalate nanny role via PostgREST; nanny can then self-approve pay
**What breaks:** Any parent can PATCH `household_members.role` to `parent` through RLS; API `assertWriteMember` trusts that column, so a nanny can freeze her own `gross_minor`.
**Where:** `supabase/migrations/009_households.sql:268-271`; `supabase/migrations/040_rls_semantic_predicates.sql:132-135`; `apps/mobile/src/lib/supabase.ts:14-15`; `apps/api/src/domains/household/repositories/householdMemberRepository.ts:23-33`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:807-821`, `:1266-1279`
**Found by:** F-B3-1 (B3)
**Trigger:** Parent PostgREST `PATCH household_members` sets nanny `role = 'parent'`; nanny calls `POST /timesheets/:id/approve`.
**Fix:** Drop client `UPDATE` on `household_members` (service-role only), or trigger-reject `role`/`status` changes unless `service_role`.

### Expense approve races timesheet freeze — reimbursement lands after snapshot
**What breaks:** A pending expense can be approved after the week’s timesheet is frozen, so the reimbursement is owed but absent from the approved earnings statement.
**Where:** `apps/api/src/domains/pay/services/expenseCommandService.ts:297-322`, `:517-538`; `apps/api/src/domains/pay/repositories/expenseRepository.ts:210-221`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:807-821`
**Found by:** F-B4-1 (B4)
**Trigger:** Concurrent `POST /expenses/:id/review` (approve) and `POST /timesheets/:id/approve`; `assertWeekNotFrozen` pre-read passes, then timesheet freezes, then expense CAS succeeds on `pending` only.
**Fix:** Include “timesheet not `approved`” in the same conditional update as expense approve (RPC/join), or re-check before commit.

### Concurrent PTO corrections double-apply adjustment deltas
**What breaks:** Two simultaneous mark-paid corrections both read the same net usage and each insert an adjustment, corrupting PTO balance and priced minutes.
**Where:** `apps/api/src/domains/pay/services/ptoCommandService.ts:245-298`, `:400-456`, `:622-662`; `supabase/migrations/045_pto_usage_per_day.sql:34-41`
**Found by:** F-B4-2 (B4)
**Trigger:** Two parents correct the same paid time-off window concurrently; or cancel reconcile races mark-paid.
**Fix:** Serialize per `(household_id, time_off_id)` with `pg_advisory_xact_lock` or a single RPC that read-compute-inserts atomically.

### Invite redeem is not single-use under concurrency
**What breaks:** Two different users can both redeem the same pending invite code and become active members of one household.
**Where:** `apps/api/src/domains/household/services/householdCommandService.ts:131-170`; `apps/api/src/domains/household/repositories/householdInviteRepository.ts:19-35`; `apps/api/src/shared/repositories/baseRepository.ts:74-78`; `supabase/migrations/009_households.sql:100-101`, `:112-124`
**Found by:** F-B3b-2, F-B4-3 — **independent corroboration by 2 lanes (B3b, B4)**
**Trigger:** Two users redeem the same code while invite is `pending`; unique index is on `(user_id, household_id)`, not invite consumption.
**Fix:** CAS `UPDATE household_invites SET status='accepted' WHERE id=$1 AND status='pending' RETURNING *`; only winner creates membership.

### Week-boundary overlap check misses entries on the other side of Monday
**What breaks:** Overlapping clock spans straddling a week boundary can both be saved and double-counted across two weekly totals.
**Where:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:732-762`; `apps/api/src/domains/timesheet/repositories/timeEntryRepository.ts:205-217`; `supabase/migrations/017_time_tracking.sql:108-110`
**Found by:** F-B1-1 (B1)
**Trigger:** Household in a non-UTC zone; `assertNoOverlap` lists only same-week `local_date` rows; second entry’s overlap window shares real time with a first entry stored under the prior week’s `local_date`.
**Fix:** Load completed entries whose clock span intersects `[clockInAt, clockOutAt)` (time-range query or ±1-day widen + in-memory filter), not `local_date` week filter alone.

## S1 — data loss, stuck state, silent failure

### Household timezone change drops entries from roll-up
**What breaks:** After `PATCH` household timezone, `rollUpIntoTimesheet` re-buckets by the new zone while `time_entries.local_date` stays frozen in the old entry timezone, excluding rows from the recomputed sum.
**Where:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:280-290`, `:1160-1172`; `supabase/migrations/017_time_tracking.sql:108-120`; `apps/api/src/domains/timesheet/repositories/timeEntryRepository.ts:216-217`
**Found by:** F-B1-4 (B1)
**Trigger:** Entry written under timezone A; household timezone later changed to B; subsequent `clockOut`/`updateEntry` roll-up uses B-derived `week_start` with `local_date` from A.
**Fix:** Bucket with `weekStartOfLocalDate(entry.local_date)` or persist `week_start` on the entry at write time.

### Clock-in allowed during paid-cancellation span — permanent running entry
**What breaks:** Carer can clock in during a `cancellation_paid` window; every clock-out overlaps the cancel entry, leaving a stuck `running` row that blocks further clock-ins.
**Where:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:245-293`, `:350-357`, `:732-762`, `:495-547`; `supabase/migrations/017_time_tracking.sql:63-65`
**Found by:** F-B2-4 (B2)
**Trigger:** Paid cancel creates full-span entry; carer adhoc clock-in succeeds; `assertNoOverlap` rejects all clock-outs.
**Fix:** Reject clock-in when prospective span overlaps a completed entry, or void/replace cancel pay when work is recorded.

### Parents can mutate shifts/schedule patterns via PostgREST, bypassing approval gates
**What breaks:** Parent JWT can directly PATCH/INSERT/DELETE `shifts` and `schedule_patterns`, skipping co-parent approval and audited RPC paths.
**Where:** `supabase/migrations/015_shifts.sql:226-229`; `supabase/migrations/014_schedule_patterns.sql:142-152`; `apps/api/src/domains/shift/services/shiftChangeRequestCommandService.ts:336-366`; `apps/api/src/domains/shift/services/shiftCommandService.ts:169-179`
**Found by:** F-B3-2 (B3); verifier kept S1 (authz bypass, not immediate frozen-money S0).
**Trigger:** Parent uses PostgREST with anon key + JWT to write schedule rows while `approval_mode` requires co-parent sign-off.
**Fix:** Narrow parent RLS on `shifts`/`schedule_patterns` to `SELECT` only (same as money tables).

### Duplicate expense POST creates two payable rows
**What breaks:** A double-submitted expense creates two `pending` rows; parent can approve both, doubling `reimbursements_minor` on freeze.
**Where:** `apps/api/src/domains/pay/services/expenseCommandService.ts:165-204`; `apps/api/src/shared/repositories/baseRepository.ts:53-71`; `supabase/migrations/044_expenses.sql`
**Found by:** F-B4-6 (B4); verifier downgraded S0 → **S1** (requires parent to approve both).
**Trigger:** Flaky network double-taps `POST /households/:id/expenses` with identical payload; no idempotency key or dedupe unique.
**Fix:** Client idempotency key unique per carer, or soft-dedupe on pending claim identity.

### Co-parent approval status commits before applier runs
**What breaks:** `respond` CAS flips approval to terminal status, then runs the gated mutation separately; applier failure leaves settled approval with unapplied schedule/pay payload.
**Where:** `apps/api/src/domains/household/services/coParentApprovalCommandService.ts:133-141`; `apps/api/src/domains/household/repositories/coParentApprovalRepository.ts:47-74`; `apps/api/src/domains/household/services/approvalApplierRegistry.ts:50-61`
**Found by:** F-B4-8 (B4)
**Trigger:** Co-parent approves a gated cancel/extra-shift; `apply` throws after status is already `approved`.
**Fix:** Apply inside the same DB transaction as the status CAS, or only CAS to terminal after apply succeeds (outbox).

### Parent PATCH on shift bypasses immutability while carer is clocked in
**What breaks:** Parent can rewrite shift times via `PATCH /shifts/:id` even when a `running` time entry exists, corrupting `scheduled_minutes` frozen at clock-out.
**Where:** `apps/api/src/domains/shift/services/shiftCommandService.ts:138-179`; `apps/api/src/domains/shift/repositories/shiftRepository.ts:267-301`; `supabase/migrations/034_parent_shift_edit_demote_on_time_change.sql:27-52`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:1126-1140`
**Found by:** F-B5-2 (B5); verifier downgraded S0 → **S1** (worked pay uses clock minutes; metadata/consent issue).
**Trigger:** Carer clocked into shift; parent PATCHes shorter times; carer clocks out — `freezeScheduledMinutes` reads edited span.
**Fix:** Call `shiftRepo.assertMutable(shiftId)` before `applyParentEdit`, or add time-entry checks inside the RPC.

### Co-parent approval timeout swallows applier failures
**What breaks:** Horizon job marks approvals `timed_out` and runs appliers; per-row errors are caught and logged, leaving terminal `timed_out` with no change request opened.
**Where:** `apps/api/src/domains/household/repositories/coParentApprovalRepository.ts:84-110`; `apps/api/src/domains/household/services/coParentApprovalQueryService.ts:58-71`; `apps/api/src/domains/household/services/approvalApplierRegistry.ts:69-86`; `apps/api/src/jobs/scheduleHorizonJob.ts:113-124`
**Found by:** F-B5-3 (B5)
**Trigger:** Gated cancel times out; carer has since clocked in; `assertMutable` throws during apply; error swallowed.
**Fix:** On applier failure after `timed_out`, flip to a terminal failure state and surface to requester; or retry until mutable.

### Reminder dedupe claims log row before delivery succeeds
**What breaks:** `push_reminder_log` INSERT happens before send; quiet hours, opt-out, empty tokens, Expo failure, or crash permanently suppress that reminder key.
**Where:** `apps/api/src/domains/notification/repositories/reminderLogRepository.ts:24-47`; `apps/api/src/jobs/reminderJob.ts:380-397`, `:449-470`, `:522-538`; `supabase/migrations/047_push_reminder_log.sql:8-11`; `apps/api/src/domains/notification/services/pushDispatchService.ts:24-36`
**Found by:** F-B6-1, F-B4-7 — **independent corroboration by 2 lanes (B6, B4)**; F-B4-7 was S2/unverified, F-B6-1 confirmed S1.
**Trigger:** Reminder job claims at local 09:00 during quiet hours 22:00–10:00; or claim-then-send fails; PK `(user_id, reminder_key)` blocks retry.
**Fix:** Gate with `shouldDeliverPush` before `claim`, or insert only after successful Expo ticket; delete row on undelivered send.

### Horizon catch-up creates past `confirmed` shifts after outage
**What breaks:** Multi-day `schedule-horizon` outage backfills missing occurrences as past `confirmed` shifts with no `startsAt <= now` guard.
**Where:** `apps/api/src/domains/schedule/services/scheduleMaterialisationService.ts:190-207`; `apps/api/src/domains/schedule/services/recurrenceExpander.ts:242-263`; `apps/api/src/jobs/scheduleHorizonJob.ts:66-88`
**Found by:** F-B6-3 (B6)
**Trigger:** Pattern accepted and materialised through day 84; job down until day 90; catch-up creates days 85–89 as past confirmed shifts.
**Fix:** In `materialiseOne`, skip create when `occ.startsAt <= now` (or only create from today forward in pattern timezone).

### Account delete API/mobile schema mismatch strands session
**What breaks:** `DELETE /users/me` succeeds server-side but mobile Zod parse fails (expects `data.message`), so UI reports failure while account is gone.
**Where:** `apps/api/src/domains/user/controllers/userController.ts:73`; `packages/shared-types/src/dto/user.dto.ts:19-21`; `apps/mobile/src/api/endpoints/user.ts:80-83`, `:210-214`
**Found by:** F-B7-1 (B7)
**Trigger:** User confirms delete; API returns `{ success: true }` in `data`; mobile `UserDeleteAccountResponseSchema` requires `message`.
**Fix:** Add `message` to API payload or drop `message` from mobile schema to match controller.

### Parent time-off list shows wrong date range vs mark-paid sheet
**What breaks:** `HouseholdTimeOffRow` renders UTC-truncated `slice(0,10)` dates including the exclusive `ends_at` day, while the mark-paid sheet uses correct exclusive-end logic.
**Where:** `apps/mobile/src/domains/timeOff/components/HouseholdTimeOffRow.tsx:136-138`; `apps/mobile/src/domains/timeOff/utils/timeOffDate.ts:104-116`; `apps/mobile/src/domains/timeOff/components/TimeOffRow.tsx:60`
**Found by:** F-B8-4 (B8)
**Trigger:** All-day Mon–Wed off (exclusive end Thu); row shows `10 Aug – 13 Aug` instead of `Mon 10 Aug – Wed 12 Aug`.
**Fix:** Render `formatTimeOffRangeLabel(timeOff.starts_at, timeOff.ends_at)` on the row (same as `TimeOffRow`).

### Time-off cancel returns 200 before PTO ledger reversal completes
**What breaks:** `DELETE /time-off/:id` commits cancel, then fire-and-forget `reconcilePtoUsage`; failed reversal leaves paid usage on the ledger with no retry on second DELETE.
**Where:** `apps/api/src/domains/availability/services/timeOffCommandService.ts:118-131`; `apps/api/src/domains/pay/services/ptoCommandService.ts:556-594`
**Found by:** F-B9-2 (B9)
**Trigger:** Cancel time off that was marked paid; `reverseNettedUsage` throws; API already returned 200; retried DELETE short-circuits without reconcile.
**Fix:** `await reconcilePtoUsage(timeOffId)` in cancel path; return 503 on failure instead of `void ...catch`.

## Unverified (S2/S3, not adversarially checked)

| id | severity | claim | path:line |
|---|---|---|---|
| F-B2-6 | S3 | Wire/API accept unbounded `amount_minor`/`rate_minor`; mobile caps at 99_999_999 | `packages/shared-types/src/schemas/expense.schema.ts:137`; `payArrangement.schema.ts:92`; `apps/mobile/src/lib/money.ts:168-183` |
| F-B4-10 | S3 | Tracked jobs have no idempotency key; overlapping cron runs always execute body | `apps/api/src/controllers/jobHandlerFactory.ts:48`; `jobRunService.ts:241-294` |
| F-B5-5 | S2 | Pending `shift_change_requests` never expire | `supabase/migrations/015_shifts.sql:161-163`; `shiftChangeRequestCommandService.ts:844-877` |
| F-B6-2 | S2 | Shift reminders only fire at local hour 18; missed window never retries | `apps/api/src/jobs/reminderJob.ts:361-364`, `:173-175` |
| F-B6-4 | S2 | Horizon run unconditionally bumps `sequence` on unchanged shifts | `scheduleMaterialisationService.ts:227-243` |
| F-B6-5 | S2 | Coverage-gap push fires after `ignoreDuplicates` upsert without checking new rows | `coverageGapService.ts:415-457` |
| F-B7-3 | S2 | Range/shift schemas use lexicographic `>` not instant compare for datetimes | `apps/api/src/domains/shift/schemas.ts:75-77`, `:112-124`; `me/schemas.ts:28-35` |
| F-B7-4 | S2 | `BusyBlocksQuerySchema` does not validate `from < to`; inverted range returns empty | `apps/api/src/domains/availability/schemas.ts:81-84` |
| F-B8-6 | S2 | Optimistic clock-in uses device timezone, not household | `timeEntryMutationUtils.ts:127-150` |
| F-B8-7 | S2 | Inventory of client-derived figures on hours/money surfaces (display drift risk) | `entryMinutes.ts:28-60`; `ParentWeekView.tsx:69-72`; `MarkTimeOffPaidSheet.tsx:94` |
| F-B9-6 | S2 | Mobile Sentry init omits `environment`/`release`; `setUserContext` never called | `apps/mobile/src/app/_layout.tsx:38-47`; `store/auth.ts` |
| F-B9-7 | S2 | API PostHog client initialized but never `capture()`s | `apps/api/src/config/posthog.ts:11-15`; `index.ts:14` |
| F-B9-8 | S2 | Corrupt frozen `earnings` JSON served as `hours_only` with no alert | `timesheetQueryService.ts:192-198` |
| F-B9-9 | S2 | Jobs return HTTP 200 / `job_runs` success when `errorCount > 0` | `jobHandlerFactory.ts:51-65`; `scheduleHorizonJob.ts:76-98` |
| F-B9-10 | S3 | Morgan logs every request at `info`, burying payroll errors | `apps/api/src/middlewares/logger.ts:69-70`, `:87-95` |

## Observational — tests, CI, config, monitoring gaps

| id | claim | path:line |
|---|---|---|
| F-B10-1 | Money-path controller/repo tests assert mocks/calls, not computed hours or pay figures | `timesheetController.test.ts:104-255`; `weekEarningsService.test.ts:954-996` |
| F-B10-2 | No integration test exercises RLS with authenticated JWT; API always uses service role | `apps/api/src/config/supabase.ts:6-12`; `migration041PayArrangements.test.ts:381-404` |
| F-B10-3 | Aside from `payArrangementRoutes`, no money-path route tested through real Express middleware | `payArrangementRoutes.test.ts:1-60`; no `timesheetRoutes` test file |
| F-B10-4 | Every `approve` test mocks `computeForWeek`; freeze path never runs real earnings arithmetic | `timesheetCommandService.test.ts:2060-2064`, `:2094+` |
| F-B10-5 | No test for worked hours + unreverted PTO on same `local_date` (product may intend additive pay per refuted F-B2-2) | `earningsService.test.ts:772-788`; `weekEarningsService.test.ts:1183-1209` |
| F-B10-6 | API `workedMinutes` and mobile `entryMinutes` use different break-rounding formulas; no shared golden vectors | `workedMinutes.ts:28-31`; `entryMinutes.ts:33-35` |
| F-B10-7 | `effectiveOn` duplicated in SQL repo and in-memory engine with no cross-assert test | `earningsService.ts:274-305`; `payArrangementRepository.test.ts:136-204` |
| F-B10-8 | Child-commitment fixtures use `'09:00'` not wire `'09:00:00'` | `childCommitmentCommandService.test.ts:80-86` |
| F-B10-9 / F-B11-8 | `bun run qc` does not run `check-test-coverage-new.sh` or `test:coverage` thresholds | `scripts/qc.sh:51-52`; `ci.yml:85-88`; `apps/api/bunfig.toml:8-9` |
| F-B10-10 | CI API test step reimplements one-file loop instead of calling `run-tests-one-file.sh` | `ci.yml:78-82`; `apps/api/scripts/run-tests-one-file.sh:10-18` |
| F-B11-1 | Migrations `047`/`048` in repo but reportedly unapplied in prod; `048` before `047` breaks reminders | `047_push_reminder_log.sql`; `048_reminders_cron.sql`; `A3-prod-ground-truth.md` |
| F-B11-2 | CI never applies/validates Supabase migrations against fresh DB | `ci.yml:1-254`; `apps/api/scripts/db-migrate.sh:26-31` |
| F-B11-3 | CI has no `shared-types` lint/format jobs (qc does) | `scripts/qc.sh:51-52`; `ci.yml:194-232` |
| F-B11-4 | Production EAS only inlines `EXPO_PUBLIC_API_URL`; Supabase vars default empty in release | `apps/mobile/eas.json:25-34`; `apps/mobile/src/config/env.ts:34-39` |
| F-B11-5 | No API/mobile contract version gate while `expo-updates` OTA is enabled | `apps/mobile/app.config.js:188-194`; `api/client.ts:33-37` |
| F-B11-6 | Bootstrap `ChildrenScreen` shows infinite spinner on profile/household create failure | `ChildrenScreen.tsx:63-74`, `:110-129` |
| F-B11-7 | API requires `GOOGLE_VERTEX_PROJECT` at boot in all non-test envs | `apps/api/src/config/env.core.ts:39`, `:48-68` |
| F-B11-9 | `BaseRepository` uses `as any` at every Supabase write boundary | `baseRepository.ts:56-57`, `:77-78` |
| F-B11-10 | `apps/mobile/assets/_staging/` untracked and not gitignored | `git status`; `.gitignore` (no `_staging` entry) |
| F-B11-11 | Root `package.json` documents missing `patchedDependencies` for Expo/Sentry workarounds | `package.json:40`; `apps/mobile/package.json:63,96` |

**Dropped:** none — all cited evidence held on spot-check.

## Themes

- **Timezone is a second calendar system with no single owner:** `local_date`, household week, shift authoring zone, and household zone are set and read in different places (cancellation entries, roll-up, overlap checks, mobile optimistic rows), producing silent inclusion/exclusion bugs that tests keyed to one zone never catch.
- **Money-adjacent writes are split across non-atomic steps:** cancel RPC → time entry → roll-up; approval CAS → applier; expense freeze check → expense CAS; invite read → membership → invite update — each gap is a TOCTOU or stuck-state class independently found by concurrency and state-machine lanes.
- **API authorization trusts DB columns clients can mutate:** RLS grants parent `UPDATE` on `household_members` and full write on `shifts`/`schedule_patterns`, while Express gates read `role` and membership from those same tables via service role — PostgREST is an alternate write path around every command-service invariant.
- **Freeze boundaries are inconsistently enforced:** expenses check frozen weeks; PTO mark-paid does not (refuted as intentional for wages, but ledger still moves); approve snapshots from live entries while `total_minutes` can drift — the “what is authoritative when” contract is lane-dependent.
- **Observability and test depth stop at the service mock boundary:** approve always mocks `computeForWeek`, no RLS JWT suite, no shared golden vectors between mobile display math and API roll-up, and client/server reminder jobs claim-before-send with no compensating monitor — defects ship because the suite cannot see the failure mode the audit reproduced.
- **Shipping gates don’t match local qc or prod schema:** migration parity, shared-types lint, coverage-on-new-files, and EAS env validation are absent from CI or release builds, so code paths depending on `047`/`048` or Supabase config can reach production untested.

## Suggested fix order

1. **`timesheetCommandService.ts` — cancellation timezone (F-B1-2/F-B2-1):** change line `:546` from `shift.timezone` to `household.timezone`. **Highest safety per line changed** — one field fixes silent omission from weekly totals and earnings.
2. **`shiftChangeRequestCommandService.ts` — stop swallowing recorder errors (F-B2-5/F-B5-1/F-B9-1):** remove or rethrow the `catch` at `:777-790` in the same PR as (1); both touch paid-cancel accept.
3. **`schedule.schema.ts` + `schedulePatternCommandService.ts` — strip `status` from PATCH (F-B3b-1/F-B7-2):** remove from schema; ignore in `update()`.
4. **`timesheetQueryService.ts` + `expenseCommandService.ts` — active membership on writes (F-B3b-3):** add `findActiveMembership` to `getOwnedTimeEntry` and `loadOwnedPending`.
5. **`householdCommandService.ts` — invite CAS redeem (F-B3b-2/F-B4-3):** conditional `pending → accepted` before `createMembership`.
6. **`timesheetCommandService.ts` + `timeEntryRepository.ts` — week-boundary overlap (F-B1-1):** time-range overlap query in `assertNoOverlap`.
7. **`expenseCommandService.ts` + `expenseRepository.ts` — expense approve freeze race (F-B4-1):** join timesheet status into approve CAS.
8. **`ptoCommandService.ts` — PTO correction lock (F-B4-2):** advisory lock around read+delta inserts.
9. **Multi-carer Hours scoping (F-B1-3):** API `listForHouseholdWeek` carer filter + mobile `getWeek` by `(carer_id, week_start)` + sum scope — ship API and mobile together.
10. **RLS migration — `household_members` + schedule writes (F-B3-1, F-B3-2):** SELECT-only client policies; role changes service-role only.
11. **`reminderJob.ts` + `reminderLogRepository.ts` (F-B6-1/F-B4-7):** claim after successful send or rollback on failure.
12. **`shiftCommandService.ts` (F-B5-2):** `assertMutable` before `applyParentEdit`.
13. **`coParentApprovalCommandService.ts` / `approvalApplierRegistry.ts` (F-B4-8, F-B5-3):** transactional apply or failure terminal state.
14. **`timeOffCommandService.ts` (F-B9-2):** await PTO reconcile on cancel.
15. **`HouseholdTimeOffRow.tsx` (F-B8-4):** use `formatTimeOffRangeLabel`.
16. **`user.dto.ts` / `userController.ts` (F-B7-1):** align delete response shape.
17. **`scheduleMaterialisationService.ts` (F-B6-3):** skip past-shift create on catch-up.
18. **`timesheetCommandService.ts` clock-in guard (F-B2-4):** reject overlap with `cancellation_paid` span.
19. **`timesheetCommandService.ts` roll-up bucketing (F-B1-4):** persist or derive week consistently after TZ change.
20. **Expense idempotency (F-B4-6):** client key or pending dedupe unique.
