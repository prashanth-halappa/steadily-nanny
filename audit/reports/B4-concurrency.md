### F-B4-1 | S0 | confidence: high
**Claim:** `assertWeekNotFrozen` is a pre-read, not part of the expense approve CAS, so a timesheet can freeze without a claim that then still flips to `approved`.
**Location:** `apps/api/src/domains/pay/services/expenseCommandService.ts:297-322`, `apps/api/src/domains/pay/services/expenseCommandService.ts:517-538`; `apps/api/src/domains/pay/repositories/expenseRepository.ts:210-221`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:807-821`
**Trace:** `POST /expenses/:expenseId/review` → `ExpenseController.review` → `expenseCommandService.review` → `assertWeekNotFrozen` (separate `timesheets` read) → later `expenseRepo.reviewPending` (CAS only on `expenses.status='pending'`) ; concurrent `POST /timesheets/:id/approve` → `approveSubmittedWithEarnings`.
**Wrong-number scenario:** Expense £40 pending in week W. A: review reads timesheet `submitted`, passes lock. B: approve freezes earnings without the £40. A: `reviewPending` sets expense `approved`. Approved week snapshot omits the reimbursement; claim is owed and invisible on the frozen statement (`docs/11-MONEY.md` §3 hazard the lock was meant to prevent).
**Fix sketch:** Include “timesheet for this week is not `approved`” in the same conditional update as the expense approve (RPC/join), or refuse when `reviewPending` would land after a freeze.

### F-B4-2 | S0 | confidence: high
**Claim:** PTO `adjustment` writes are read-then-insert with no lock or unique key, so two concurrent deltas both apply and corrupt the netted balance (the comment that racing reverses are safe is false).
**Location:** `apps/api/src/domains/pay/services/ptoCommandService.ts:245-298`, `apps/api/src/domains/pay/services/ptoCommandService.ts:400-456`, `apps/api/src/domains/pay/services/ptoCommandService.ts:517-519`, `apps/api/src/domains/pay/services/ptoCommandService.ts:622-662`; `apps/api/src/domains/availability/services/timeOffCommandService.ts:126`; `supabase/migrations/045_pto_usage_per_day.sql:34-41`
**Trace:** `POST .../pto/mark-paid` → `markTimeOffPaid` → `writeCorrection` / `writeFirstMarking`+`assertStillConfirmedAfterWrite`→`reverseNettedUsage`; and `DELETE /time-off/:id` → `cancel` → fire-and-forget `reconcileCancelledTimeOff` → `reverseNettedUsage`. DB allows unlimited `kind='adjustment'` rows (045).
**Wrong-number scenario:** Ledger has usage −480. Parent A and Parent B both correct to 360: both read paid=480, both insert +120 → net −240 (4h paid) instead of 360. Or cancel reconcile and mark-paid cancel-compensation both read outstanding=480 then both insert +480 → net +480 phantom accrual; weeks that recompute (or later approve) price wrong PTO minutes.
**Fix sketch:** Serialize per `(household_id, time_off_id)` with `pg_advisory_xact_lock` (024/027 pattern) around read+delta inserts, or a single RPC that computes and inserts under one transaction.

### F-B4-3 | S0 | confidence: high
**Claim:** Invite redeem is not single-use under concurrency: membership insert is not gated on invite `pending`, and invite accept is an unguarded update.
**Location:** `apps/api/src/domains/household/services/householdCommandService.ts:136-175`; `apps/api/src/domains/household/repositories/householdMemberRepository.ts:113-132`; `apps/api/src/shared/repositories/baseRepository.ts:74-81`; `supabase/migrations/009_households.sql:112-126` (no one-redeemer constraint beyond `code` unique)
**Trace:** `POST /households/invites/redeem` → `redeemInvite` → `findByCode` → `createMembership` → `inviteRepo.update` without `.eq('status','pending')`. Unique only on `(user_id, household_id)`, not on invite consumption.
**Wrong-number scenario:** Users A and B both redeem the same pending nanny invite. Both pass `status=pending`. Both `createMembership` succeed (different users). Both mark invite accepted. Two carers gain household membership and can read/write that household’s shifts/hours/pay data from one invite.
**Fix sketch:** CAS invite `pending→accepted` first (or in one RPC with membership insert); only the winner creates membership.

### F-B4-4 | S0 | confidence: high
**Claim:** Approve’s `updated_at` CAS does not observe `time_entries` mutations until `rollUpIntoTimesheet` runs, so approve can freeze a snapshot that excludes hours already written on the entry.
**Location:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:359-375`, `585-657`, `807-821`, `1152-1251`; `apps/api/src/domains/timesheet/repositories/timesheetRepository.ts:167-188`
**Trace:** `POST .../clock-out` or `PATCH /time-entries/:id` → entry `update`/`createSubmitted` (auto-commit) → later `rollUpIntoTimesheet` bumps timesheet; concurrent `POST /timesheets/:id/approve` → `computeSnapshot` then `approveSubmittedWithEarnings(... expectedUpdatedAt)`.
**Wrong-number scenario:** Timesheet `submitted`, `updated_at=T0`, 20h. A: approve reads T0, computes £370. B: clock-out writes +8h on `time_entries` (timesheet still T0). A: CAS matches T0, freezes £370 / 20h. B: rollUp fails or process dies before timesheet update → approved week permanently understates hours and gross while entries show 28h.
**Fix sketch:** Entry status/hours writes and timesheet roll-up in one RPC; or approve CAS must also fail if any week entry `updated_at`/`id` set changed since the pre-read (or lock the week).

### F-B4-5 | S1 | confidence: high
**Claim:** `query` and `reopen` use unguarded `BaseRepository.update` (id only), so they can overwrite an approve that used a proper CAS and leave a contradictory money-adjacent row.
**Location:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:902-905`, `960-966`; `apps/api/src/shared/repositories/baseRepository.ts:74-81`; contrast `timesheetRepository.ts:185-187`
**Trace:** `POST /timesheets/:id/query` → `query` → `timesheetRepo.update` (no `status`/`updated_at` predicate). Concurrent `approve` → `approveSubmittedWithEarnings` with status+version CAS.
**Wrong-number scenario:** Both parents see `submitted`. A: approve CAS wins → `approved` + frozen gross. B: query update sets `status=queried` and `query_note` only — leaves `approved_by`/`gross_minor`/`earnings` set. Read path treats non-`approved` as live (`timesheetQueryService.ts:185-190`), so UI shows Estimated live £ while approval metadata/snapshot columns still claim a settled figure; week is stuck non-approvable until new hours roll it back to `submitted`.
**Fix sketch:** Mirror approve: `UPDATE ... WHERE status='submitted' AND updated_at=:v` for query; `WHERE status='approved'` for reopen; clear snapshot columns on query if that transition is allowed to beat approve.

### F-B4-6 | S0 | confidence: med
**Claim:** Expense create has no natural or idempotency key; a double-posted claim is two payable rows.
**Location:** `apps/api/src/domains/pay/services/expenseCommandService.ts:165-204`; `apps/api/src/shared/repositories/baseRepository.ts:53-71`; `supabase/migrations/044_expenses.sql` (no dedupe unique on claim identity)
**Trace:** `POST /households/:householdId/expenses` → `expenseCommandService.create` → plain `insert`.
**Wrong-number scenario:** Flaky network double-taps submit the same £25 expense twice → two `pending` rows → parent approves both → `reimbursements_minor` +£50 instead of +£25 on the week that freezes them.
**Fix sketch:** Client idempotency key unique per carer, or soft-dedupe on `(household_id, carer_id, local_date, kind, amount_minor/miles, description)` for pending.

### F-B4-7 | S2 | confidence: high
**Claim:** Reminder dedupe claims the log row before send with no release on failure, so a crash/error after claim permanently suppresses that reminder.
**Location:** `apps/api/src/jobs/reminderJob.ts:380-397`, `453-470`, `522-538`; `apps/api/src/domains/notification/repositories/reminderLogRepository.ts:24-48`; `supabase/migrations/047_push_reminder_log.sql:9-11`
**Trace:** `POST /api/jobs/reminders` → `runReminderJob` → `log.claim` (PK insert) → `push.notifyUser`; on throw, catch increments errors but does not delete the claim row.
**Wrong-number scenario:** Cannot produce a wrong paid amount. Push is skipped forever for that `(user_id, reminder_key)` after claim+send failure (at-most-once, silent miss). Concurrent job overlap is otherwise deduped by the PK.
**Fix sketch:** Insert after successful send, or delete/mark failed on send error so the next hourly run can retry.

### F-B4-8 | S1 | confidence: high
**Claim:** Co-parent approval status flip and applier run are separate auto-committed steps; a failed apply leaves the gated mutation unapplied while the approval is already settled.
**Location:** `apps/api/src/domains/household/services/coParentApprovalCommandService.ts:133-141`; `apps/api/src/domains/household/services/coParentApprovalQueryService.ts:58-68`; `apps/api/src/domains/household/repositories/coParentApprovalRepository.ts:47-74`
**Trace:** `PATCH .../approvals/:approvalId` → `respond` CAS → `approvalApplierRegistry.apply`; timeout path `expireTimedOut` then `applyAllSettled`.
**Wrong-number scenario:** No direct cent math, but accept/cancel/extra-shift parked in the approval never runs while status is `approved`/`timed_out` — stuck schedule/pay-adjacent state with no automatic retry on the respond path (apply error propagates after status already committed).
**Fix sketch:** Apply inside the same DB transaction as the status CAS, or only CAS to terminal after apply succeeds (outbox).

### F-B4-9 | S1 | confidence: high
**Claim:** `clockOut` does not CAS `time_entries.status='running'`, so concurrent clock-outs both rewrite the same row and both roll up.
**Location:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:326-375`; `apps/api/src/shared/repositories/baseRepository.ts:74-81`; contrast `timeEntryRepository.ts:72-88` (clock-in unique) and `shiftRepository.ts:96-104` (accept CAS)
**Trace:** `POST /time-entries/:id/clock-out` → read `running` → `timeEntryRepo.update(id, patch)` with no status predicate → `rollUpIntoTimesheet`.
**Wrong-number scenario:** Double-tap with different `clock_out_at`/`break_minutes`: both updates succeed; last write wins the paid span (e.g. forgotten finish 17:00 overwritten by “now” 09:00 next day before client bounds apply inconsistently). Totals are re-derived so usually not double-counted, but the stored session hours can be the wrong span until corrected.
**Fix sketch:** `UPDATE ... WHERE id=:id AND status='running'` returning null → `TimeEntryNotRunningError` (same shape as `confirmPending`).

### F-B4-10 | S3 | confidence: med
**Claim:** Tracked jobs call `JobRunService.start` with no idempotency key, so overlapping cron/manual triggers always run the body twice; safety relies entirely on per-domain dedupe.
**Location:** `apps/api/src/controllers/jobHandlerFactory.ts:48`; unused `apps/api/src/domains/job/services/jobRunService.ts:241-294`; `apps/api/src/controllers/jobController.ts:16-37`
**Trace:** `POST /api/jobs/schedule-horizon` / `reminders` → `createTrackedJobHandler` → `JobRunService.start` (always inserts) → job fn.
**Wrong-number scenario:** Does not by itself duplicate pay rows when child paths hold (shift `ical_uid` unique; reminder PK claim). Latent if a future job write lacks that protection — two overlapping runs both mutate money/hours.
**Fix sketch:** Use `startWithIdempotencyKey` with a period key (e.g. `reminders:2026-08-05T18`) so the second overlap exits before work.
