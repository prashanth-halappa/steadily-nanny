### F-B2-1 | S0 | confidence: high
**Claim:** `cancellation_paid` rows stamp `timezone: shift.timezone`, so `local_date` can fall outside the household-tz week that roll-up/earnings use, and the paid minutes never enter that week's total or gross.
**Location:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:546` (writes `shift.timezone`); `:515-518` + `:1161-1172` (week from household tz; `listForCarerWeek` filters on `local_date`); `apps/api/src/domains/timesheet/repositories/timeEntryRepository.ts:216-217`; `supabase/migrations/017_time_tracking.sql:108-110`; `supabase/migrations/015_shifts.sql:10-12`
**Trace:** `POST .../change-requests/:id/respond` → `shiftChangeRequestCommandService.respond` → `recordCancellationPaidEntry` → `timeEntryRepo.createSubmitted` (trigger sets `local_date` from `shift.timezone`) → `rollUpIntoTimesheet` → `listForCarerWeek(household weekStart)` → later `approve` → `weekEarningsService.computeForWeek` → same `listForCarerWeek`.
**Wrong-number scenario:** Household `Pacific/Auckland`, shift authored `Europe/London`, `starts_at=2026-08-02T14:00:00Z`, 8h cancel (480 min) at £18.50/h (`rate_minor=1850`). Auckland week_start=`2026-08-03`; London `local_date=2026-08-02`. Roll-up lists `[2026-08-03,2026-08-10)` → entry excluded. Expected gross `priceMinutes(480,1850)=14800` (£148.00); actual week gross `0` for that cancel (entry orphaned).
**Fix sketch:** Write `timezone: household.timezone` (same as clock-in) in `recordCancellationPaidEntry`, not `shift.timezone`.

### F-B2-2 | S0 | confidence: high
**Claim:** Paid PTO and worked hours on the same calendar day both price with no mutual exclusion; only cancel→reverse was fixed for double pay.
**Location:** `apps/api/src/domains/pay/services/weekEarningsService.ts:145-151` (documents cancel double-pay fix); `:317-321` + `:271-286` (PTO netted + worked both fed); `apps/api/src/domains/pay/services/earningsService.ts:450-451` + `:605-612` + `:747-758`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:245-293` (clock-in never consults `carer_time_off`)
**Trace:** `POST .../pto/mark-paid` → `ptoCommandService.markTimeOffPaid` → `pto_ledger` usage → `GET/POST timesheets` earnings via `weekEarningsService.buildWeekEarningsInput`/`computeWeekEarnings`; parallel `POST .../time-entries/clock-in`→`clock-out` → worked entry.
**Wrong-number scenario:** Mon marked paid PTO 480 min and also worked 480 min at £18.50/h. Expected one 480-min wage line → `14800`. Actual `pto` `14800` + `regular` `14800` → gross `29600` (£296.00).
**Fix sketch:** When building engine input, zero (or reduce) `pto_usage` minutes on dates that already have worked/`manual_adjustment` minutes (or refuse clock-in on marked-paid days).

### F-B2-3 | S0 | confidence: high
**Claim:** Marking/correcting PTO has no frozen-week lock, unlike expenses, so ledger money can move after a timesheet snapshot is authoritative.
**Location:** `apps/api/src/domains/pay/services/ptoCommandService.ts:234-300` (no timesheet status check); contrast `apps/api/src/domains/pay/services/expenseCommandService.ts:297-299` + `:517-538`; freeze read path `apps/api/src/domains/timesheet/services/timesheetQueryService.ts:185-198`; `docs/11-MONEY.md` §3 expense lock only
**Trace:** `POST /timesheets/:id/approve` freezes `earnings` → later `POST .../pto/mark-paid` appends `pto_ledger` → approved `getWeekWithEarnings` still returns snapshot (no recompute).
**Wrong-number scenario:** Week approved with no PTO (`gross_minor=0` wages beyond hours). Parent then marks Mon 480 min PTO at £18.50/h. Ledger/balance move by −480 min; statement still `gross_minor` without PTO (`amount_minor` owed `14800` invisible). Reverse case: approve with PTO `14800` frozen, then mark `0` → balance restored, frozen statement still pays `14800`.
**Fix sketch:** Mirror `assertWeekNotFrozen` in `markTimeOffPaid` for any covered day whose timesheet is `approved`.

### F-B2-4 | S1 | confidence: high
**Claim:** Clock-in is allowed during a `cancellation_paid` span; clock-out then always hits overlap, leaving a permanent running entry and blocking further clock-ins.
**Location:** `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:245-293` (clock-in, no overlap check); `:350-357` + `:732-762` (`assertNoOverlap` on clock-out includes `cancellation_paid`); `:495-547` (cancel entry = full shift span)
**Trace:** Cancel accept → `recordCancellationPaidEntry` → carer `POST /time-entries/clock-in` (adhoc; auto-match skips cancelled) → `POST .../clock-out` → `TimeEntryOverlapError`; `time_entries_one_running_per_carer` blocks new clock-ins.
**Wrong-number scenario:** Cancel paid 09:00–17:00 (480 min owed). Carer clocks in 10:00 same day. Every clock-out in `(10:00,∞)` overlaps → stuck `running`. Cannot record real work; cancel pay stands; no additional correct hours possible without DB surgery. Not a wrong cent by itself; stuck hours/pay path.
**Fix sketch:** Reject clock-in when the prospective span overlaps an existing completed entry (or void/replace cancel pay when work is recorded).

### F-B2-5 | S1 | confidence: high
**Claim:** If recording the `cancellation_paid` time entry fails, the shift accept still commits `cancellation_paid=true` and the error is swallowed, so owed hours never hit the timesheet.
**Location:** `apps/api/src/domains/shift/services/shiftChangeRequestCommandService.ts:777-790`; `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:524-526` (approved week throws); `supabase/migrations/039_cancellation_paid_unique.sql:9-11` (only dedupes successful inserts)
**Trace:** `respond` → RPC sets `shifts.cancellation_paid=true` → `cancellationPaidEntryRecorder` throws → catch logs → accept returns success.
**Wrong-number scenario:** 8h short-notice cancel at £18.50/h; entry write fails (`week_approved` or DB). Shift shows paid cancel; timesheet/earnings have `0` for it. Expected `14800`; actual `0`. Silent underpay until manual repair.
**Fix sketch:** Fail the accept (or compensating-clear `cancellation_paid`) when `recordCancellationPaidEntry` throws; do not swallow.

### F-B2-6 | S3 | confidence: med
**Claim:** Wire/API accept unbounded non-negative `amount_minor`/`rate_minor` while mobile money parse caps at `99_999_999`, so a non-UI client can create extreme rates/claims the product’s money util refuses.
**Location:** `packages/shared-types/src/schemas/expense.schema.ts:137`; `packages/shared-types/src/schemas/payArrangement.schema.ts:92`; `apps/mobile/src/lib/money.ts:168-183`; DB `integer` in `044_expenses.sql:112`, `041_pay_arrangements.sql:67`
**Trace:** `POST .../expenses` or `POST .../pay-arrangements` with raw JSON → Zod `z.int().min(0)` → service insert (parent still reviews expenses; rate is immediate for open weeks).
**Wrong-number scenario:** `rate_minor=2_000_000_000` (£20M/h) or `amount_minor=2_000_000_000`. Mobile would return `null` above £999,999.99; API stores until Postgres int limit. Open-week pricing then uses that rate. Unlikely without a malicious/buggy client; parent must also approve expenses.
**Fix sketch:** Add `.max(99_999_999)` on wire amount/rate fields to match `parseMajorToMinor`.
