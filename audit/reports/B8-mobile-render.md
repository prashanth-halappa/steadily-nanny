### F-B8-1 | S0 | confidence: high
**Claim:** Hours week totals (and the approve confirmation) count still-running entries via client `nowMs`, while the server’s `total_minutes` and live/frozen earnings skip any entry without `clock_out_at`.
**Location:** `apps/mobile/src/domains/timesheet/utils/entryMinutes.ts:43-52` (running uses `nowMs`); `apps/mobile/src/domains/timesheet/components/ParentWeekView.tsx:249-252,394,512`; `apps/mobile/src/domains/timesheet/components/NannyWeekView.tsx:194-197,252`; `apps/mobile/src/domains/timesheet/components/TimeEntryDayRow.tsx:79-81,126,200-201`; `apps/api/src/domains/timesheet/utils/workedMinutes.ts:42-55`; `apps/api/src/domains/pay/services/weekEarningsService.ts:271-276`
**Trace:** `GET /households/:id/time-entries` + `GET /timesheets/:id` → Hours renders `sumEntryMinutes(entries, nowMs)` beside `timesheet.earnings` from `getWeekWithEarnings` → `buildWeekEarningsInput` drops rows with no `clock_out_at` → `POST /timesheets/:id/approve` freezes that finished-only earnings snapshot.
**Wrong-number scenario:** Week already `submitted` (Mon–Thu clocked out). Friday carer is still `running` for 2h. Parent Hours shows e.g. `42h` + Estimated gross for 40h finished; Approve dialog says approve `42h 00m` and `£X` (gross for 40h). Confirm freezes earnings/`total_minutes` for 40h — parent acted on inflated hours that the server never paid.
**Fix sketch:** For week totals / approve `hoursLabel`, sum only entries with `clock_out_at` (mirror `sumWorkedMinutes`); keep live `nowMs` only on Today / in-progress day chrome, not on the payable total.

### F-B8-2 | S0 | confidence: high
**Claim:** Several money-affecting writes never invalidate `timesheet` / `timeEntry` caches, so Hours keeps showing pre-mutation hours or estimated gross.
**Location:** `apps/mobile/src/hooks/mutations/useCreatePayArrangement.ts:28-34` (pay only); `apps/mobile/src/hooks/mutations/useCreateHouseholdClosure.ts:20-23`; `apps/mobile/src/hooks/mutations/useDeleteHouseholdClosure.ts:16-19`; `apps/mobile/src/hooks/mutations/useRespondToShiftChangeRequest.ts:23-25` (shift/`me` only). Contrast: `useMarkTimeOffPaid.ts:51-53` and expense hooks invalidate `queryKeys.timesheet.all`.
**Trace:**  
- Pay: `POST .../pay-arrangements` → live `weekEarnings` uses new `effectiveOn` arrangement → mobile still serves cached `queryKeys.timesheet.week` (`staleTime` 1m, no invalidate).  
- Closure: `POST/DELETE .../closures` → guaranteed top-up in `weekEarningsService` → same stale timesheet.  
- Cancel accept: `POST /change-requests/:id/respond` → `recordCancellationPaidEntry` writes `time_entries` + roll-up → mobile never invalidates `timeEntry`/`timesheet`.
**Wrong-number scenario:** Parent sets £18.50/hr then opens Hours within the fresh cache window → still `no_arrangement` / old gross. Or accepts a paid cancellation → Hours still omits the `cancellation_paid` minutes and their £ until a later incidental refetch.
**Fix sketch:** On success of each hook, also `invalidateQueries({ queryKey: queryKeys.timesheet.all })`; for change-request respond, also `queryKeys.timeEntry.all`.

### F-B8-3 | S1 | confidence: high
**Claim:** `HoursScreen` freezes `nowMs` for the lifetime of the mounted Hours tab, so any running-entry contribution (F-B8-1) is stuck at first visit, contradicting the file’s own “recomputed on tab focus” comment.
**Location:** `apps/mobile/src/domains/timesheet/components/HoursScreen.tsx:138-142` (`useMemo(() => Date.now(), [])`); tab stays mounted (`HoursScreen.tsx:25-27`, `173-178` only resets week offset on blur).
**Trace:** Hours tab mount → fixed `nowMs` → `ParentWeekView`/`NannyWeekView`/`TimeEntryDayRow` → `computeEntryMinutes` for `clock_out_at: null`.
**Wrong-number scenario:** Open Hours at 10:00 while clocked in since 09:00 → day/week shows +60m. Leave tab, return at 15:00 still running → still +60m, not +6h. Understates “so far” on the pay screen for the whole session.
**Fix sketch:** Refresh `nowMs` in `useFocusEffect` (or a short interval while any week entry is `running`).

### F-B8-4 | S1 | confidence: high
**Claim:** Parent household time-off rows render date ranges from raw timestamptz `slice(0,10)` including the exclusive `ends_at` day, while the mark-paid sheet uses the correct exclusive-end undo.
**Location:** `apps/mobile/src/domains/timeOff/components/HouseholdTimeOffRow.tsx:136-138`; correct path `formatTimeOffRangeLabel` at `timeOffDate.ts:104-116` (used by `TimeOffRow.tsx:60` and this row’s sheet `rangeLabel` at `HouseholdTimeOffRow.tsx:102-105,162`).
**Trace:** `GET .../households/:id/time-off` → row UI → parent opens `MarkTimeOffPaidSheet` / `POST .../pto/mark-paid` (allocation uses household-local days from the same instants).
**Wrong-number scenario:** All-day off Mon–Wed (exclusive end Thu local midnight). Row shows UTC-truncated `starts_at`/`ends_at` dates (e.g. ends on Thu, or shifts a day for positive UTC offsets). Parent sees a different span on the list than in the mark-paid sheet for the same row.
**Fix sketch:** Render `formatTimeOffRangeLabel(timeOff.starts_at, timeOff.ends_at)` on the row (same as `TimeOffRow`).

### F-B8-5 | S1 | confidence: high
**Claim:** Clock-in/out mutations are optimistic and only in-memory; if the process dies while offline/paused, the queued write is lost while the UI already showed the opposite clock state.
**Location:** `apps/mobile/src/hooks/mutations/useClockIn.ts:4-9,65-77`; `apps/mobile/src/hooks/mutations/useClockOut.ts:4-9,46-55`; `timeEntryMutationUtils.ts:124-154` (optimistic row).
**Trace:** Today → `useClockIn`/`useClockOut` `onMutate` patches `queryKeys.timeEntry.running()` → `networkMode: 'online'` pauses until reconnect → no persistence → process kill drops mutation; server never got `POST .../clock-in` or `.../clock-out`.
**Wrong-number scenario:** Nanny clocks out offline (UI clears running), app is killed before flush → server still `running` → later pay includes hours she thought she ended; or opposite for lost clock-in.
**Fix sketch:** Persist pending clock mutations with idempotency keys, or refuse optimistic clock-out while offline and keep running until a durable queue exists.

### F-B8-6 | S2 | confidence: med
**Claim:** Optimistic clock-in stamps `local_date`/`timezone` from the device zone, not the household zone the server will write.
**Location:** `apps/mobile/src/hooks/mutations/timeEntryMutationUtils.ts:127-150` (`Intl.DateTimeFormat().resolvedOptions().timeZone` + `localDateInZone(timezone, now)`); server sets household tz at clock-in (`timesheetCommandService` per A2).
**Trace:** `useClockIn` `onMutate` → `buildOptimisticRunningEntry` → `queryKeys.timeEntry.running()` until `onSuccess` replaces with API row.
**Wrong-number scenario:** Device in `America/Los_Angeles`, household `Europe/London`, clock-in near a calendar-day boundary → optimistic `local_date` is the device day; any UI that keys off that field during the optimistic window disagrees with the server row that lands milliseconds later.
**Fix sketch:** Pass `household.timezone` into `buildOptimisticRunningEntry` (from the clock-in caller) and derive `local_date` with that zone.

### F-B8-7 | S2 | confidence: high
**Claim:** Client-side derived figures rendered on hours/money surfaces (divergence risk inventory; F-B8-1 is the paid-hours instance).
**Location:**  
- Live/payable hours: `entryMinutes.ts:28-60`; call sites in F-B8-1; ClockOut preview `ClockOutSheet.tsx:213-218`  
- “Vs scheduled” delta: `ParentWeekView.tsx:69-72,250-252` / `NannyWeekView.tsx:76+` (`scheduledMinutesFor` + client total)  
- Pending expense total: `PendingExpensesRow.tsx:56-63` (sum of server `amount_minor`)  
- PTO badge hours: `HouseholdTimeOffRow.tsx:100,145` (`netPaidMinutes / 60`)  
- Mark-paid prefill: `MarkTimeOffPaidSheet.tsx:177` (`minutes / 60`)  
- Hours→minutes input: `payArrangementForm.ts:123`; `MarkTimeOffPaidSheet.tsx:94` (`Math.round(hours * 60)`)
**Trace:** Render path only — none of these are the approve freeze except the week `totalMinutes` chain in F-B8-1.
**Wrong-number scenario:** Aside from F-B8-1, most are display/input transforms of server ints; the float `hours * 60` round can send 66 minutes for typed `1.1` when a binary fraction would not be exact — refused if invalid, but accepted values are client-rounded before `POST`.
**Fix sketch:** Treat server `total_minutes` / earnings lines as display source of truth on Hours; keep client math only for in-progress timers and validated input parsing.
