### F-B6-1 | S1 | confidence: high
**Claim:** Reminder dedupe claims `push_reminder_log` before delivery succeeds, so quiet hours, opt-out, empty tokens, Expo failure, or a crash permanently suppress that reminder.
**Location:** `apps/api/src/domains/notification/repositories/reminderLogRepository.ts:24-47`; `supabase/migrations/047_push_reminder_log.sql:8-11,16-26`; `apps/api/src/jobs/reminderJob.ts:380-397,449-470,522-538,320-326`; `apps/api/src/domains/notification/services/householdPush.ts:39-46`; `apps/api/src/domains/notification/services/pushDispatchService.ts:24-36`; `apps/api/src/domains/notification/services/notificationPrefsService.ts:118-203`; `apps/api/src/domains/notification/constants.ts:17-27`
**Trace:** `POST /api/jobs/reminders` → `validateJobApiKey` → `JobController.runReminders` → `runReminderJob` → `log.claim` INSERT → `await deps.push.notifyUser` → default wrapper calls fire-and-forget `notifyUser` → `sendToUser` → `shouldDeliverPush` (opt-out / quiet hours; `SHIFT_REMINDER` and `TIMESHEET_AWAITING_APPROVAL` are not quiet-hours-exempt) and/or zero tokens → no Expo send; unique `(user_id, reminder_key)` remains.
**Wrong-number scenario:** Parent with quiet hours `22:00–10:00` and a timesheet `submitted` for 3+ days: at local 09:00 the job claims `timesheet_awaiting_approval:<id>:<date>`, then `shouldDeliverPush` returns false. No push ever; later hourly runs skip forever for that key. Same for claim-then-no-device-token, Expo error (swallowed in `householdPush`), or process death after INSERT. Not a wrong paid cent by itself — silent stuck approval nudge on the hours/pay path.
**Fix sketch:** Gate with `shouldDeliverPush` (and token presence) before `claim`, or claim only after a successful Expo ticket; delete/rollback the log row on undelivered send.

### F-B6-2 | S2 | confidence: high
**Claim:** Shift reminders require an exact local hour of 18 and a once-only key, so a missed/failed run during that single hour never retries.
**Location:** `apps/api/src/jobs/reminderJob.ts:33,361-364,374-378,173-175,194-208`; `supabase/migrations/048_reminders_cron.sql:50-52`
**Trace:** Cron `5 * * * *` → `/api/jobs/reminders` → `processShiftReminders` → `clock.hour !== 18` skip; else `shiftDate === tomorrow` and `claim(shift_reminder:<id>)`. Next UTC hour local hour is 19; next calendar day `tomorrow` no longer matches that shift.
**Wrong-number scenario:** API down or job error throughout the carer’s local 18:00–18:59 while a confirmed shift starts “tomorrow”: no claim, no send, and no later hour can match. Carer gets no reminder. Not a wrong paid amount.
**Fix sketch:** Widen the send window (e.g. local hour ≥ 18 on the day before) or allow unclaimed retries until `starts_at`, still keyed once per shift.

### F-B6-3 | S1 | confidence: high
**Claim:** Horizon catch-up re-expands from `dtstart` and creates missing occurrences as `confirmed` with no “skip if already in the past” guard, so a multi-day job outage backfills phantom past shifts.
**Location:** `apps/api/src/domains/schedule/services/scheduleMaterialisationService.ts:190-207`; `apps/api/src/domains/schedule/services/recurrenceExpander.ts:242-263`; `apps/api/src/domains/schedule/services/schedulePatternCommandService.ts:399-442`; `apps/api/src/jobs/scheduleHorizonJob.ts:66-88`
**Trace:** `POST /api/jobs/schedule-horizon` → `runScheduleHorizonJob` → `materialiseForHorizon` → `expandRecurrence(dtstart…horizon)` → `materialiseOne` → if no row, `create({ status: 'confirmed', … })`. Orphan reconciliation only uses `isFuture` when deleting; create path does not.
**Wrong-number scenario:** Pattern accepted day 0 (materialised through day 84); `schedule-horizon` down until day 90. Catch-up creates days 85–89 as past `confirmed` shifts. Auto `matchConfirmedShift` is now-windowed, but an explicit `shift_id` clock-in (`timesheetCommandService.clockIn` with `input.shift_id`) can attach hours to a shift that never existed in real time — wrong hours attribution.
**Fix sketch:** In `materialiseOne`, skip create when `occ.startsAt <= now` (or only create from `localDateOf(now, pattern.timezone)` forward).

### F-B6-4 | S2 | confidence: high
**Claim:** Every successful horizon run unconditionally `sequence + 1` and rewrites children for every untouched existing occurrence, even when times/note are unchanged.
**Location:** `apps/api/src/domains/schedule/services/scheduleMaterialisationService.ts:227-243`; `apps/api/src/jobs/scheduleHorizonJob.ts:76-78`; `supabase/migrations/026_schedule_horizon_cron.sql:35-37` / `032_fix_schedule_horizon_cron_pg_net_guard.sql:35-37`
**Trace:** Daily `schedule-horizon` → `materialiseForHorizon` → `materialiseOne` for each existing non-immutable shift → always `update(… sequence: existing.sequence + 1)` and `replaceChildren`.
**Wrong-number scenario:** No wrong pay amount. Identical schedule data gets a new iCal `sequence` every night for every active recurring shift, causing spurious “updated” calendar/sync churn and CAS/version noise. Double runs the same day bump twice.
**Fix sketch:** Update (and bump `sequence`) only when `timesMoved`, timezone/note/children actually differ.

### F-B6-5 | S2 | confidence: high
**Claim:** Coverage-gap push fires after `insertMany` with `ignoreDuplicates: true` without checking whether any row was newly inserted, so concurrent detectors double-notify.
**Location:** `apps/api/src/domains/child/services/coverageGapService.ts:415-457`; `apps/api/src/domains/shift/repositories/shiftEventRepository.ts:121-141`; `supabase/migrations/025_shift_events_keyed_unique.sql:21-23`
**Trace:** `raiseGapsOnce` → `listEventKeysForDate` → filter → `insertMany` (`upsert` + `ignoreDuplicates: true`) → always `notifyHouseholdParents(COVERAGE_GAP_DETECTED)` if pre-filter was non-empty.
**Wrong-number scenario:** Two concurrent day-thread reads both see empty keys, both upsert (second is a no-op), both push parents. Duplicate coverage-gap notifications; not a wrong paid amount.
**Fix sketch:** Notify only when the insert reports new rows, or claim a push slot (e.g. unique log key) before notify; do not notify solely on the pre-insert filter after `ignoreDuplicates`.
