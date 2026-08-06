I have enough from the money doc, migrations, earnings engine, and mobile converters to assemble the authoritative inventory.

## Amounts

| path:line | identifier | unit as actually used | TS type | SQL column type if persisted | currency handling | rounding: where and which direction |
|---|---|---|---|---|---|---|
| `supabase/migrations/041_pay_arrangements.sql:67` | `rate_minor` | integer minor units / hour | `z.int().min(0)` → `number` (`payArrangement.schema.ts:49`) | `integer not null` | sibling `currency char(3)` (`041:82-83`) | none at storage; used raw in pricing |
| `supabase/migrations/041_pay_arrangements.sql:74` | `bill_rate_minor` | integer minor / hour (dormant) | `z.int().min(0).nullable()` (`:51`) | `integer` nullable | same row `currency` | unused in Tier 0 |
| `supabase/migrations/041_pay_arrangements.sql:82-83` | `currency` | ISO-4217 uppercase string | `z.string().regex(/^[A-Z]{3}$/)` (`:39,52`) | `char(3) not null default 'GBP'` + check | ISO-4217; no upcase on ingest | n/a |
| `supabase/migrations/041_pay_arrangements.sql:89-90` | `overtime_multiplier` | decimal multiplier (not money) | `z.number().min(1)` (`:55`) | `numeric(3,2) not null default 1.50` | n/a | recovered as hundredths via `Math.round(m*100)` then half-up (`earningsService.ts:264-266`) |
| `supabase/migrations/041_pay_arrangements.sql:101` | `mileage_rate_per_mile_minor` | integer minor / mile | `z.int().min(0).nullable()` (`:61`) | `integer` | same row `currency` | used in `priceMileage` half-up (`expenseCommandService.ts:143-146`) |
| `supabase/migrations/042_timesheet_earnings.sql:92-93` | `timesheets.gross_minor` | integer minor (frozen wages) | live via `WeekEarnings.gross_minor` `z.int()` (`timesheet.schema.ts:351`); not on bare `TimesheetSchema` | `integer check (>=0)` nullable | sibling `timesheets.currency` (`042:94-95`) | sum of per-line half-up amounts (`earningsService.ts:747-758`) |
| `supabase/migrations/042_timesheet_earnings.sql:94-95` | `timesheets.currency` | ISO-4217 | via earnings state, not raw wire (`timesheet.schema.ts:460-464`) | `char(3)` check, **no default** | frozen at approve | n/a |
| `supabase/migrations/042_timesheet_earnings.sql:96` | `timesheets.earnings` | jsonb breakdown (line `amount_minor`s) | `WeekEarningsStateSchema` (`timesheet.schema.ts:447-450`) | `jsonb` | currency inside ok arm | lines already rounded before freeze |
| `packages/shared-types/src/schemas/timesheet.schema.ts:318-333` | `EarningsLine.{minutes,rate_minor,amount_minor,multiplier}` | minutes int; rate/amount integer minor; multiplier float\|null | `z.int` / `z.number().min(1).nullable()` | stored inside `earnings` jsonb | week currency | `amount_minor = priceMinutes` half-up once (`earningsService.ts:228-232,347`) |
| `packages/shared-types/src/schemas/timesheet.schema.ts:350-353` | `gross_minor` / `reimbursements_minor` | integer minor | `z.int().min(0)` | snapshot / live compute | week `currency` | gross = sum wage lines; reimbursements summed apart (`earningsService.ts:750-758`) |
| `supabase/migrations/044_expenses.sql:112` | `expenses.amount_minor` | integer minor | `z.int().min(0).nullable()` (`expense.schema.ts:93`) | `integer check (>=0)` | `currency char(3)` (`044:114-115`) | expense: client int; mileage: `priceMileage` half-up at approve (`expenseCommandService.ts:143-146,315`) |
| `supabase/migrations/044_expenses.sql:113` | `expenses.miles` | decimal miles, 1dp | `MilesSchema` = `z.number()` with 1dp refine (`expense.schema.ts:60-74`) | `numeric(6,1)` | n/a (prices money later) | wire rejects >1dp; pricing `Math.round(miles*10)` then half-up (`expenseCommandService.ts:144`) |
| `packages/shared-types/src/schemas/expense.schema.ts:137` | `CreateExpenseRequest.amount_minor` | integer minor | `z.int().min(0)` | → `expenses.amount_minor` | `currency` default `'GBP'` (`:138`) | validated int; no float parse on wire |
| `apps/mobile/src/lib/money.ts:59-60` | `formatMoney` / `major` | display major = `minor/100` (float for Intl) | `(minor: number, currency: string) => string` | n/a | `Intl.NumberFormat` currency; bad code → `"CODE amount"` (`:68-73`) | Intl 2dp display; input already int |
| `apps/mobile/src/lib/money.ts:109-110` | `minorToMajorText` | major string `"18.50"` | `(minor: number) => string` | n/a | no symbol | `(minor/100).toFixed(2)` — display only |
| `apps/mobile/src/lib/money.ts:168-183` | `parseMajorToMinor` | integer minor from typed string | `string → number \| null` | n/a | strips one `£€$` | no float `*100`; `Number(whole)*100 + Number(frac.padEnd(2,'0'))`; reject >2dp / >`99_999_999` |
| `apps/mobile/src/domains/pay/utils/payArrangementForm.ts:175-176` | `rateMinor` / `buildCreatePayArrangementRequest` | integer minor via `parseMajorToMinor` | `CreatePayArrangementRequest.rate_minor` | → `pay_arrangements.rate_minor` | `state.currency` | refuse-or-int; no guess |
| `apps/mobile/src/domains/pay/utils/payArrangementForm.ts:212-216` | `mileageRatePerMileMinor` | integer minor / mile | `number \| null` | → `mileage_rate_per_mile_minor` | arrangement currency | via `parseMajorToMinor` |
| `apps/mobile/src/domains/pay/utils/payArrangementForm.ts:192-195` | `overtimeMultiplier` | JS float from `Number(text)` | `number` | → `numeric(3,2)` | n/a | no money round; stored as numeric |
| `apps/mobile/src/domains/expenses/utils/buildExpenseRequest.ts:45-51` | `amount_minor` (expense create) | integer minor | `CreateExpenseRequest` | → `expenses` | form `currency` | `parseMajorToMinor` |
| `apps/api/src/domains/pay/services/earningsService.ts:228-232` | `priceMinutes` | integer minor | `number` | feeds lines / gross | uses arrangement rate+currency | **half-up** via `floor((2n+60)/120)`; once per line |
| `apps/api/src/domains/pay/services/earningsService.ts:264-266` | `overtimeRateMinor` | integer minor / hour | `number` | line `rate_minor` | same | half-up of `rate×k/100` after `Math.round(multiplier*100)` |
| `apps/api/src/domains/pay/services/expenseCommandService.ts:143-146` | `priceMileage` | integer minor | `number` | → `amount_minor` at approve | claim `currency` must match arrangement (`:547+`) | **half-up** `floor((2n+10)/20)` on tenths×rate |
| `apps/api/src/domains/timesheet/services/timesheetCommandService.ts:885-888` | approve snapshot `gross_minor`/`currency`/`earnings` | integer minor + jsonb | writes DB columns | `timesheets.*` | from engine ok arm; non-ok leaves gross/currency null (`:876-881`) | freeze of already-rounded engine output |
| `apps/mobile/src/domains/timesheet/components/WeekEarningsLine.tsx:190` | display `formatMoney(gross_minor, currency)` | display major string | render | n/a | from earnings ok arm | display only |
| `apps/mobile/src/domains/timesheet/components/EarningsBreakdownSheet.tsx:99-100` | line `rate_minor`/`amount_minor` display | display major | render | n/a | week currency | display only |
| `apps/mobile/src/domains/expenses/components/PendingExpensesRow.tsx:56-57` | `totalMinor` | integer minor sum | `number` | n/a | only if single currency among priced rows (`:48-65`) | integer sum; no `/100` |
| `apps/mobile/src/domains/expenses/components/ExpenseReviewSheet.tsx:100` | `formatMoney(expense.amount_minor ?? 0, …)` | display; `?? 0` for null mileage preview path | render | n/a | expense.currency | display only |
| `packages/shared-types/src/schemas/payArrangement.schema.ts:93` | `CreatePayArrangementRequest.currency` | ISO code | regex + `.default('GBP')` | → column | default GBP | n/a |
| `apps/api/src/domains/pay/services/payArrangementCommandService.ts:128` | insert `rate_minor` | integer minor | from request | `pay_arrangements` | `request.currency` | no re-round |

---

## Time

| path:line | identifier | representation | timezone it is interpreted in | DST-safe? | rounding of durations |
|---|---|---|---|---|---|
| `supabase/migrations/015_shifts.sql:26-27` | `shifts.starts_at` / `ends_at` | `timestamptz` (UTC absolute) | stored UTC; authored zone in `timezone` | yes (absolute) | n/a |
| `supabase/migrations/015_shifts.sql:28-31` | `shifts.timezone` / `local_date` | IANA text + `date` | **authoring** zone (`015:8-12`); trigger `starts_at at time zone timezone` (`015:91`) | yes if zone DB correct | calendar day, no duration round |
| `supabase/migrations/017_time_tracking.sql:22-27` | `clock_in_at` / `clock_out_at` / `break_minutes` / `scheduled_minutes` | timestamptz; integer minutes | instants UTC; break/scheduled int minutes | yes | scheduled frozen via `Math.round(ms/60000)` (`timesheetCommandService.ts:1137-1140`) |
| `supabase/migrations/017_time_tracking.sql:41-42` | `time_entries.local_date` / `timezone` | `date` + IANA | trigger: `coalesce(clock_in,clock_out,now()) at time zone timezone` (`017:108-110`); clock-in sets **household** tz (`timesheetCommandService.ts:290`) | yes | day from instant; overnight wholly on clock-in date |
| `supabase/migrations/017_time_tracking.sql:77-78` | `timesheets.week_start` / `total_minutes` | Monday `date`; integer minutes | week_start = household-local Monday (`weekStart.ts:62-63`) | yes (calendar after local date) | total = sum of rounded worked minutes (`workedMinutes.ts:42-55`) |
| `apps/api/src/domains/timesheet/utils/workedMinutes.ts:28-31` | `computeWorkedMinutes` | integer minutes | absolute ms delta (tz-independent) | yes | **`Math.round(elapsedMs/60000) - break`**, clamp ≥0 |
| `apps/mobile/src/domains/timesheet/utils/entryMinutes.ts:33-35` | `computeWorkedMinutesFromInstants` | integer minutes | absolute ms | yes | **`Math.round(elapsedMin - break)`** (order differs; integer-break equivalent) |
| `apps/api/src/domains/timesheet/utils/weekStart.ts:48-55` | `localDateOf` | `YYYY-MM-DD` string | explicit IANA `timeZone` via `Intl` | yes | none |
| `apps/api/src/domains/timesheet/utils/weekStart.ts:62-63` | `weekStartOf` | Monday `YYYY-MM-DD` | household tz → local date → Monday | yes | none |
| `apps/mobile/src/domains/timesheet/utils/week.ts:68-69` | `getWeekStartISO` | Monday `YYYY-MM-DD` | household IANA (must be passed) | yes | none |
| `apps/mobile/src/lib/wallClock.ts:38-52` | `wallClockToUtcIso` | local wall → UTC ISO | household/pattern IANA; double offset pass | **yes** (DST fold/gap handled) | minute precision input |
| `apps/mobile/src/lib/wallClock.ts:65-75` | `shiftInstantsFromWallClock` | UTC ISO pair | household tz; overnight end+1 day | yes | none |
| `supabase/migrations/014_schedule_patterns.sql:43-46,83-84` | pattern `timezone` / `start_time`/`end_time` | IANA + Postgres `time` (nominal wall) | pattern tz at expand (`recurrenceExpander`) | **yes by design** (wall clock, not stored UTC) | span from expanded instants |
| `supabase/migrations/011_availability.sql:41-43` | `earliest_start` / `latest_finish` | Postgres `time` wall | carer profile timezone (display) | N/A (nominal) | none |
| `supabase/migrations/011_availability.sql:73-74` | `carer_time_off.starts_at`/`ends_at` | `timestamptz` | authored as **device-local midnight** (`timeOffDate.ts:30-41`) | device DST via `Date` local ctor | all-day exclusive end |
| `apps/mobile/src/domains/timeOff/utils/timeOffDate.ts:30-41` | `toAllDayRange` | device-local midnights → ISO | **device tz**, not household | device-local DST | exclusive end +1 calendar day |
| `apps/api/src/domains/pay/utils/localDateSpan.ts:48-61` | `localDatesCovered` | list of `YYYY-MM-DD` | **household** tz reinterpret of instants | yes | sub-day → 1 day; half-open `[start,end)` |
| `supabase/migrations/043_pto_ledger.sql:128-131` | `pto_ledger.minutes` / `effective_date` | signed integer minutes; `date` | `effective_date` household-local calendar | n/a | allocated via largest-remainder (`allocateMinutes.ts:47-94`) |
| `apps/api/src/domains/pay/utils/allocateMinutes.ts:64-69` | `allocateMinutes` | integer minutes parts | n/a | n/a | floor + largest remainder; **exact sum = total** |
| `apps/mobile/src/domains/pay/utils/payArrangementForm.ts:117-123` | `parseHoursToMinutes` | hours text → int minutes | n/a | n/a | `Math.round(hours * 60)` (**float hours**) |
| `apps/mobile/src/domains/timeOff/components/MarkTimeOffPaidSheet.tsx:87-106` | `parseHoursToMinutes` | hours → int minutes | n/a | n/a | `Math.round(hours * 60)`; reject if rounds to 0 from positive |
| `apps/mobile/src/domains/timeOff/components/MarkTimeOffPaidSheet.tsx:177` | prefill `hours: Math.abs(minutes)/60` | float hours for UI | n/a | n/a | display divide |
| `supabase/migrations/041_pay_arrangements.sql:88,93,96,111` | threshold / guaranteed / PTO entitlement / cancellation window | integer minutes or hours | `z.int` / hours int | integer columns | n/a | hours fields entered via `parseHoursToMinutes` round |
| `supabase/migrations/009_households.sql:35,51-57` | `households.timezone`, `*_hours`/`*_minutes` policy ints | IANA; integer hours/minutes | household schema | text / integer | default `Europe/London` | policy comparisons use float hours (`shiftChangeRequestCommandService.ts:131-133`) |
| `apps/api/src/domains/shift/services/shiftChangeRequestCommandService.ts:131-143` | `hoursUntilStart` / `isCancellationPaid` | float hours = ms/3_600_000 | absolute instants | yes (duration) | float compare vs integer hour window |
| `apps/api/src/domains/pay/services/weekEarningsService.ts:298-302` | closure `scheduled_minutes` | int minutes from shift span | absolute | yes | `Math.round(ms/60000)` (**recomputed**, not `time_entries.scheduled_minutes`) |
| `supabase/migrations/035_household_closures.sql:12-13` | `household_closures.starts_at`/`ends_at` | timestamptz | covered days via household tz (`localDateSpan`) | yes | none |
| `supabase/migrations/044_expenses.sql:104` | `expenses.local_date` | `date` | **client-supplied** ISO date (`expense.schema.ts:135`); week via `weekStartOfLocalDate` (`expenseCommandService.ts:525`) | no tz convert (already local date) | none |
| `apps/mobile/src/domains/timesheet/utils/duration.ts:22-29,37-40` | `formatDuration` / `formatElapsedSince` | display string | elapsed absolute | yes | `Math.floor` minutes for display; elapsed may be float before floor |
| `apps/mobile/src/lib/localDate.ts:6-19` | `localDateInZone` | `YYYY-MM-DD` | IANA; **fallback** `toISOString().slice(0,10)` = UTC (`:18`) | yes if zone valid; fallback **not** | none |
| `packages/shared-types/src/schemas/timesheet.schema.ts:68-72` | wire `clock_*` / `break_minutes` / `scheduled_minutes` | ISO offset datetime; int | as stored | yes | server owns rounding |

---

## Unit boundary crossings

| Crossing | path:line | Notes |
|---|---|---|
| minor ↔ display major | `apps/mobile/src/lib/money.ts:60,110,182` | **Only intended site** for `*100`/`/100` money. `/100` creates IEEE float for Intl/`toFixed`. |
| hours text ↔ minutes | `payArrangementForm.ts:123`; `MarkTimeOffPaidSheet.tsx:94` | `Math.round(Number(hours)*60)` — float hours → int minutes. |
| minutes ↔ hours display | `MarkTimeOffPaidSheet.tsx:177`; `ptoFormat.ts:22-29` | `/60` float for prefill; signed format uses int remainder. |
| minutes ↔ money | `earningsService.ts:228-232` | `minutes * rate_minor / 60` half-up in integers. |
| multiplier float ↔ overtime rate | `earningsService.ts:264-266` | JS/`numeric(3,2)` float → `Math.round(*100)` hundredths → integer rate. **Documented lossy if skipped.** |
| miles decimal ↔ minor | `expenseCommandService.ts:143-146` | `numeric(6,1)`/JS number → tenths int → half-up minor. |
| miles string ↔ number | `miles.ts:27-34` | string validate → `Number(trimmed)` (exact for 1dp literals). |
| wall clock ↔ UTC ISO | `wallClock.ts:38-52` | local HH:MM + date + IANA → ISO. DST double-pass. |
| UTC ISO ↔ wall HH:MM | `wallClock.ts:108-115` | display/forms in household zone. |
| instant ↔ `local_date` (shifts) | `015_shifts.sql:91` | `starts_at AT TIME ZONE shifts.timezone`. |
| instant ↔ `local_date` (entries) | `017_time_tracking.sql:108-110` | uses **entry** `timezone` (household at clock-in). |
| instant ↔ week Monday | `weekStart.ts:62-63`; `timesheetCommandService.ts:349` | household tz. |
| device midnights ↔ timestamptz (time off) | `timeOffDate.ts:36-41` | device local → ISO; later re-read in **household** tz (`localDateSpan.ts:53-54`). **Implicit zone change.** |
| `YYYY-MM-DD` calendar ↔ epoch day | `weekStart.ts:29-32`; `earningsService.ts:201-208` | UTC-anchored pure date math (not a real instant). |
| DB integer ↔ JS number | all `*_minor` / minutes columns | safe within `Number.isSafeInteger` for realistic payroll. |
| DB `numeric(3,2)` / `numeric(6,1)` ↔ JS number | multiplier, miles | **implicit float**; recovered via scale+round before money math. |
| frozen snapshot ↔ live earnings | `timesheetCommandService.ts:871-888`; wire `TimesheetWeekSchema` (`timesheet.schema.ts:466-467`) | approve freezes; open weeks recompute. Raw snapshot columns **not** on wire. |
| client expense `local_date` ↔ week | `expenseCommandService.ts:525` | `weekStartOfLocalDate` — no re-zone (correct if client date is household-local). |
| scheduled span ↔ minutes (two sites) | freeze `timesheetCommandService.ts:1137-1140`; closure top-up `weekEarningsService.ts:298-302` | same formula, **recomputed from shifts** for top-up (not reading frozen `time_entries.scheduled_minutes`). |
| `effectiveOn` DB vs in-memory | `payArrangementRepository.ts:44-67` vs `earningsService.ts:284-305` | **duplicated rule** (doc says one place; engine reimplements for purity). |

**Flagged implicit/lossy:** overtime float path (mitigated); miles float (mitigated); hours×60 float round; time-off device→household day reinterpret; `localDateInZone` UTC fallback (`localDate.ts:18`); `formatMoney` `/100` float (display-only).

---

## Float contamination

| Site | path:line | Risk |
|---|---|---|
| `overtime_multiplier` SQL + wire | `041:89`; `payArrangement.schema.ts:55` | JS number; engine deliberately avoids `rate*multiplier` float (`earningsService.ts:240-266`). |
| `miles` SQL + wire | `044:113`; `expense.schema.ts:60-74` | `numeric(6,1)` / JS number; pricing scales to tenths first. |
| `hoursUntilStart` | `shiftChangeRequestCommandService.ts:132` | float hours for boolean window only — not stored as money. |
| `parseHoursToMinutes` | `payArrangementForm.ts:121-123`; `MarkTimeOffPaidSheet.tsx:91-94` | `Number` hours × 60 → round; e.g. `1.1` → 66 not 66.0 exact concern for binary fractions of hours. |
| `formatMoney` / `minorToMajorText` | `money.ts:60,110` | `/100` float for display only. |
| `parseMilesInput` | `miles.ts:32` | `Number(trimmed)` — safe for validated 1dp strings. |
| Elapsed display | `duration.ts:39` | float minutes then `floor` — display only. |
| **No** SQL `real`/`double precision`/`float` money columns | money cols are `integer` | `numeric` only for multiplier + miles (not wage totals). |
| Latitude/longitude | `009:37-38` | `numeric(9,6)` — not money. |

---

## Timezone authority

**There is no single source of truth for “which day” across the product.** Competing authorities:

1. **Shift calendar day** — `shifts.local_date` from `starts_at` in **`shifts.timezone` (authoring zone)** (`015_shifts.sql:91`). Comment in cancellation path warns this can disagree with household tz (`shiftChangeRequestCommandService.ts:148-151`).
2. **Worked / paid time-entry day** — `time_entries.local_date` from clock instants in **`time_entries.timezone`**, set to **`household.timezone` at clock-in** (`timesheetCommandService.ts:290`; `017:108-110`). Overnight entry belongs wholly to clock-in date (earnings engine assumes this, `earningsService.ts:49-52`).
3. **Timesheet week** — Monday of household-local date of clock instant (`weekStartOf` + household tz) (`weekStart.ts:62-63`; roll-up `timesheetCommandService.ts:349`).
4. **Expense day** — **client-supplied** `local_date` (`expense.schema.ts:135`); week membership via `weekStartOfLocalDate` without re-zoning (`expenseCommandService.ts:525`).
5. **PTO covered days (money)** — `localDatesCovered(starts_at, ends_at, household.timezone)` (`ptoCommandService` + `localDateSpan.ts:48-54`).
6. **Time-off authorship** — **device-local** midnights (`timeOffDate.ts:6-12,30-41`). Same instants later interpreted in household tz for paid marking → possible day-set disagreement near zone boundaries.
7. **Pay `valid_from` / PTO grant “today” / current year** — `localDateOf(now, household.timezone)` (`payArrangementCommandService.ts:105`; `ptoQueryService.ts:182`).
8. **Mobile “this week” UI** — `getWeekStartISO(now, household.timezone)` (`week.ts:68-69`); must not use device zone.

**Closest pay-pricing authority:** arrangement resolution on each priced fact’s **household-local calendar date** (`time_entries.local_date`, PTO `effective_date`, expense `local_date`) via `payArrangementRepository.effectiveOn` (`payArrangementRepository.ts:44-48`) / in-engine twin (`earningsService.ts:284-305`). Week filing for hours uses household tz + clock-in instant.

---

## Deviations from `docs/11-MONEY.md`

| Doc rule | Followed? | Evidence |
|---|---|---|
| §1 Amounts as integer minor units | **Yes** for wage/expense/rate columns | `041:67`, `042:92`, `044:112` |
| §1 Every amount table has `currency char(3)` + regex check | **Yes** | `041:82-83`, `042:94-95`, `044:114-115` |
| §1 No `numeric`/`float` money column | **Mostly** — wage amounts are int; **`overtime_multiplier numeric(3,2)`** and **`miles numeric(6,1)`** exist and feed money math | `041:89`, `044:113` |
| §1 Zod `z.int()` + currency regex | **Yes** for money fields; multiplier is `z.number()` | `payArrangement.schema.ts:49,55`; `expense.schema.ts:93` |
| §1 No Money object on wire — minor + currency | **Yes** | schemas above |
| §1 Only `lib/money.ts` does `*100`/`/100` | **Yes** for money (guardrail test `noHandRolledMoneyDivision.test.ts`); hours/miles use other scales | `money.ts:7`; `payArrangementForm.ts:123` is hours not money |
| §1 `parseMajorToMinor` validates whole string | **Yes** | `money.ts:168-183` |
| §1 `formatMoney` never throws | **Yes** | `money.ts:63-73` |
| §2 Append-only pay arrangements; `effectiveOn` only in repo | **Partial** — append-only yes; **engine duplicates `effectiveOn` in memory** | `payArrangementRepository.ts:27-29` vs `earningsService.ts:284-305` |
| §2 No future `valid_from` (household local today) | **Yes** | `payArrangementCommandService.ts:105-106` |
| §3 Live compute; freeze at approve with status+`updated_at` CAS | **Yes** (documented in `042`; implemented in command service approve path) | `042:16-18`; `timesheetCommandService.ts:871-888` |
| §3 Reopen clears snapshot unconditionally | **Yes** (D1 path + deliberate reopen) | `042:34-51`; reopen clears in command service |
| §3 Legacy approved → hours-only, never live under Approved | **Yes** | `timesheet.schema.ts:392-400` `hours_only` |
| §3 State labels Estimated/Approved | **Client responsibility** — wire carries `timesheets.status` + earnings; UI labels in `WeekEarningsLine` | schema `timesheet.schema.ts:383-389` |
| §4 No arrangement → no £0.00 | **Yes** | `earningsService.ts:495-503`; `NO_ARRANGEMENT` arm |
| §4 Departed carer → hours-only, no nudge | **Yes** | `HOURS_ONLY_REASONS.CARER_REMOVED` `timesheet.schema.ts:420-423` |
| §5 PTO ledger, netted total, per-day allocateMinutes | **Yes** | `043`; `allocateMinutes.ts`; `weekEarningsService.netPtoUsage` |
| §5 Current-year-only lazy grant | **Yes** | `ptoQueryService.ts:209-214` area |
| §5 Stable note keys | **Yes** | `pto.schema.ts:66-75` |
| §6 Reimbursements excluded from gross/OT | **Yes** | `earningsService.ts:747-758`, `639-660` |
| §6 Mileage priced at approval | **Yes** | `044:21-27`; `priceMileage` |
| §7 Guaranteed top-up closure-only | **Yes** | `earningsService.ts:662-696` |
| §8 Select-only RLS on money tables | **Yes** (migrations 041/043/044 policies) | e.g. `044:157-160` |
| §9 Membership assertions on money writes | **Yes** (command services; not re-audited line-by-line here beyond expense/pay create headers) | `expenseCommandService.ts` module doc; `payArrangementCommandService` |

**Additional silent tensions with the doc’s spirit (not numbered as violations of a single sentence):**
- Doc §2 “`effectiveOn` is the only place” vs engine copy (`earningsService.ts:274-282`).
- Float-adjacent inputs (hours, miles, multiplier) are outside the “integer minor only” story but are converted before freezing pennies.
- Time-off day filing for PTO money reinterprets device-authored instants in household tz (`timeOffDate.ts` vs `localDateSpan.ts`) — a zone-boundary footgun for which week gets the minutes.
