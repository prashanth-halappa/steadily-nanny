## Could not verify

**Sentry MCP** is unauthenticated (`serverStatus: needsAuth`) — could not retrieve recurring issue titles or event counts from Sentry. All Sentry coverage findings below are from code only.

**PostHog live data:** `$exception` = 0 over the last 30 days; `screen_viewed`, `onboarding_step_completed`, and `sign_in_completed` = 0 over the same window. The project event catalog is dominated by legacy/template events (`paywall_presented`, `O20AddChild`, etc.), not Nanny hours/pay flows.

---

### F-B9-1 | S0 | confidence: high
**Claim:** Accepting a paid cancellation change request returns HTTP 200 even when the `cancellation_paid` time entry fails to write, so paid cancellation hours can be missing with no user-visible failure.
**Location:** `apps/api/src/domains/shift/services/shiftChangeRequestCommandService.ts:777-791` (`apps/api/src/domains/shift/controllers/shiftChangeRequestController.ts:55-63` returns success)
**Trace:** `POST /api/v1/change-requests/:id/respond` → `shiftChangeRequestCommandService.respond` → `changeRequestRepo.acceptAndApply` (shift marked `cancellation_paid`) → `cancellationPaidEntryRecorder` → `timesheetCommandService.recordCancellationPaidEntry` → `timeEntryRepo.createSubmitted` + `rollUpIntoTimesheet`; failure is caught, logged, and execution continues.
**Wrong-number scenario:** Parent accepts nanny’s cancellation of a 4h shift inside the household’s paid-cancellation window (`cancellation_paid=true`). DB write for `kind='cancellation_paid'` fails (transient DB error, roll-up error, etc.). Response is still 200 with the cancelled shift; timesheet `total_minutes` stays 0 for those 4h; week gross is understated by `4 × rate_minor` (half-up per line).
**Fix sketch:** Remove the try/catch swallow; let the error propagate so accept returns 5xx and the shift accept can be retried, or return a partial-failure flag and do not mark the change request applied until the entry exists.

---

### F-B9-2 | S1 | confidence: high
**Claim:** Cancelling time off returns success while PTO ledger reversal runs fire-and-forget; a failed reversal is only logged, leaving paid PTO usage on the books.
**Location:** `apps/api/src/domains/availability/services/timeOffCommandService.ts:118-131` → `apps/api/src/domains/pay/services/ptoCommandService.ts:556-594`
**Trace:** `DELETE /api/v1/time-off/:id` → `timeOffCommandService.cancel` → `carerTimeOffRepository.cancelById` (200) → `void reconcilePtoUsage(timeOffId).catch(...)` → `ptoCommandService.reconcileCancelledTimeOff` → per-household `reverseNettedUsage`.
**Wrong-number scenario:** Carer cancels a week of time off that was already marked paid (−480 PTO minutes in `pto_ledger`). Reversal throws on the first household. API returns 200 with cancelled time off; ledger still shows −480 used; `GET .../pto/balance` reports 480 fewer available minutes than reality; a later `mark-paid` or correction uses the wrong balance.
**Fix sketch:** `await this.reconcilePtoUsage(timeOffId)` in the cancel path (or return 503 until reversal succeeds); at minimum surface failure to the client instead of `void ...catch`.

---

### F-B9-3 | S1 | confidence: high
**Claim:** Timed-out co-parent approvals are marked `approved` in the database even when the gated mutation fails to apply; failures are logged and skipped with no alert.
**Location:** `apps/api/src/domains/household/services/approvalApplierRegistry.ts:69-85`; `apps/api/src/domains/household/services/coParentApprovalQueryService.ts:66-68`; `apps/api/src/jobs/scheduleHorizonJob.ts:116-124`
**Trace:** `schedule-horizon` cron → `expireStaleCoParentApprovals` → `coParentApprovalQueryService.expirePendingApprovals` → `approvalRepo.expireTimedOut` (status → `approved`) → `approvalApplierRegistry.applyAllSettled` → registered appliers (`shiftChangeRequestCommandService.ts:1147-1155` for `cancel` / `short_notice_change` / `extra_shift`).
**Wrong-number scenario:** A `cancel` approval times out and flips to `approved`, but `applyApprovedChangeRequest` throws (shift deleted, invalid payload). Approval row shows approved; no change request is opened; nanny never gets a cancel to accept; if the shift is later cancelled through another path without `cancellation_paid` recording, paid cancellation hours never land on the timesheet.
**Fix sketch:** On applier failure, revert approval status (or mark `failed`) and increment a Sentry metric; do not treat `applyAllSettled` as success for the sweep.

---

### F-B9-4 | S1 | confidence: high
**Claim:** Nothing in production monitors payroll data integrity—no check that `timesheets.total_minutes` matches summed `time_entries`, no alert on negative PTO balance, no detector for duplicate paid rows beyond the DB constraint firing at write time.
**Location:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:1152-1172` (derive-on-write only); `supabase/migrations/017_time_tracking.sql:77-78` (`total_minutes integer not null default 0`, no cross-table constraint); `apps/api/src/domains/pay/services/ptoQueryService.ts:137` (balance = raw sum, no sanity alert); `apps/api/src/jobs/` (no integrity job — grep over `apps/api/src/jobs` finds no `total_minutes` / `integrity` / `reconcil` matches)
**Trace:** All money reads assume derived state is correct; `rollUpIntoTimesheet` recomputes on each clock-out but nothing periodically verifies `timesheets.total_minutes === SUM(time_entries.worked)` or `pto_ledger` net sanity.
**Wrong-number scenario:** A bug or manual DB edit sets `timesheets.total_minutes = 480` while entries sum to 600. Approvals and earnings engine use the entries for gross but list views show 480; drift is invisible until someone notices manually. Duplicate `cancellation_paid` rows are blocked by unique index at insert (`timeEntryRepository.ts:99-115`) but a successful duplicate via service-role bypass would not trigger any audit.
**Fix sketch:** Add a scheduled `job_runs`-tracked integrity job that SQL-compares week totals to entry sums and flags negative PTO nets; page on mismatch.

---

### F-B9-5 | S1 | confidence: high
**Claim:** Mobile has no observability on hours/pay API failures—handled mutation errors show a toast only and are never sent to Sentry or PostHog.
**Location:** `apps/mobile/src/api/queryClient.ts:4-24` (no global `onError`); `apps/mobile/src/hooks/mutations/useApproveTimesheet.ts:19-21`; `apps/mobile/src/hooks/mutations/useClockIn.ts:89-120`; `apps/mobile/src/lib/analytics/events.ts:9-14` (no timesheet/pay events); `apps/mobile/src/lib/analytics/hooks/useIdentifyUser.ts:23-31` (never mounted — only exported from `apps/mobile/src/lib/analytics/index.ts:30`)
**Trace:** `POST /timesheets/:id/approve` fails → `useApproveTimesheet` `onError` → `showErrorToast` only. Same pattern for clock-in/out and expenses. `Sentry.captureException` exists only in `RootErrorBoundary.tsx:21`, `calendarSyncNative.ts:84`, `openExternalUrl.ts:40`, `maybeRequestReview.ts:43` — none on the timesheet/pay path.
**Wrong-number scenario:** Approve timesheet returns 500 for every parent for a week (bad earnings snapshot deploy). Parents see a generic toast; Sentry mobile project stays quiet; PostHog shows 0 `screen_viewed` / pay events (verified: 0 counts last 30 days); nobody knows approval is broken until payroll is missed.
**Fix sketch:** Add `queryClient` mutation `onError` that `Sentry.captureException`s 5xx on money mutations; wire `useIdentifyUser` in auth bootstrap; add `timesheet_approve_failed` / `clock_out_failed` PostHog events.

---

### F-B9-6 | S2 | confidence: high
**Claim:** Mobile Sentry is initialized without `environment` or `release`, and `setUserContext` is never called from auth—production crashes cannot be separated from dev or tied to a user.
**Location:** `apps/mobile/src/app/_layout.tsx:38-47`; `apps/mobile/src/lib/sentryBreadcrumbs.ts:33-37` (helper exists); `apps/mobile/src/store/auth.ts` (no `Sentry` / `setUserContext` usage)
**Trace:** `Sentry.init` in root layout omits `environment` and `release` (contrast API `apps/api/src/instrument.ts:23-27` which sets both). Auth store never calls `setUserContext` after sign-in.
**Wrong-number scenario:** Cannot produce a wrong number directly; if wrong hours appear in prod, Sentry issues from test builds and prod builds merge in one project with no release tag, and crash reports lack `user.id`, delaying root-cause on money-path client bugs (e.g. D7-class stale cache).
**Fix sketch:** Set `environment: process.env.EXPO_PUBLIC_APP_ENV` and `release` from `app.config.js` version; call `setUserContext({ id })` in auth store on `SIGNED_IN`.

---

### F-B9-7 | S2 | confidence: high
**Claim:** API PostHog client is initialized but never captures events—server-side product analytics and error funnels are dead.
**Location:** `apps/api/src/config/posthog.ts:11-15`; `apps/api/src/index.ts:14` (only `phClient.shutdown()`)
**Trace:** `phClient` is constructed at module load; no `capture()` call exists anywhere under `apps/api/src` (grep finds only `index.ts` shutdown).
**Wrong-number scenario:** Earnings engine starts returning `no_arrangement` for all weeks due to a deploy bug. API logs errors per request, but PostHog cannot show a funnel of `GET /timesheets/:id` → error rate spike; ops has no dashboard signal.
**Fix sketch:** Capture structured events on timesheet approve, mark-paid, and earnings `status !== 'ok'` in the command services.

---

### F-B9-8 | S2 | confidence: med
**Claim:** Corrupt frozen earnings JSON is served as `hours_only` with no error or monitoring event, hiding a bad approved snapshot from the UI.
**Location:** `apps/api/src/domains/timesheet/services/timesheetQueryService.ts:192-198`
**Trace:** `GET /api/v1/timesheets/:id` → `timesheetQueryService.getWeekWithEarnings` → `earningsFor` → approved row with unparseable `earnings` jsonb → `WeekEarningsSchema.safeParse` fails → `hoursOnly(..., UNREADABLE_SNAPSHOT)` (200).
**Wrong-number scenario:** Manual DB corruption or a bad deploy writes invalid `earnings` jsonb while `gross_minor` remains 50000. Parent opens approved week; UI shows hours with no £ amount (`hours_only`); they assume “no pay rate set” rather than “frozen snapshot is corrupt”; nobody is alerted.
**Fix sketch:** Log at `error` + `Sentry.captureMessage` when `safeParse` fails on an approved row; return a distinct error code or maintenance flag instead of silent `hours_only`.

---

### F-B9-9 | S2 | confidence: med
**Claim:** Background jobs report HTTP 200 and `job_runs` success even when per-item failures occur, so materialisation/approval/reminder errors do not trip alerts.
**Location:** `apps/api/src/controllers/jobHandlerFactory.ts:51-65`; `apps/api/src/jobs/scheduleHorizonJob.ts:76-98`; `apps/api/src/jobs/reminderJob.ts:604-618`; `apps/api/src/controllers/jobController.ts:23-33`
**Trace:** `POST /api/jobs/schedule-horizon` → `runScheduleHorizonJob` increments `errorCount` per failed pattern (`scheduleHorizonJob.ts:80-85`) but still returns a result object → `createTrackedJobHandler` calls `JobRunService.complete` and `sendSuccessResponse` 200. Same for `runReminderJob` with `errorCount` in payload only.
**Wrong-number scenario:** Schedule materialisation fails for every pattern for a week (DB outage mid-job). Cron returns 200; `job_runs` row is `complete`; no PagerDuty; carers work unmaterialised shifts; clock-ins miss `scheduled_minutes` matching; week totals diverge from schedule silently.
**Fix sketch:** `if (result.errorCount > 0) throw new JobPartialFailureError(...)` before `JobRunService.complete`, or mark run `failed` when `errorCount > 0`.

---

### F-B9-10 | S3 | confidence: med
**Claim:** Every HTTP request is logged at `info` via Morgan, which can bury `error`-level payroll failures in high-traffic logs.
**Location:** `apps/api/src/middlewares/logger.ts:69-70` (`LOG_LEVEL` default `info`); `apps/api/src/middlewares/logger.ts:87-95` (Morgan → `logger.info` for every request)
**Trace:** Production default log level is `info`; each API call emits an access line at `info`; 5xx paths also call `logger.error` in `logError` (`logger.ts:136-140`), but both appear in the same stream with no sampling.
**Wrong-number scenario:** Cannot produce a wrong number; during heavy usage, `Failed to record cancellation_paid time entry` error lines are surrounded by thousands of `GET /api/v1/me/shifts 200` info lines, slowing incident triage when payroll numbers go wrong.
**Fix sketch:** Log access lines at `debug` in production, or route Morgan to a separate access log sink.
