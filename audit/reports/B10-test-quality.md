### F-B10-1 | S1 | confidence: high
**Claim:** Money-path controller and repository tests assert service/query-builder *calls* (or echo the fixture they passed in) and never assert a computed hours or pay figure, so they stay green if arithmetic or freeze mapping is wrong.
**Location:** `apps/api/tests/unit/domains/timesheet/controllers/timesheetController.test.ts:104-255`; `apps/api/tests/unit/domains/pay/controllers/payArrangementController.test.ts:63-115`; `apps/api/tests/unit/domains/pay/controllers/expenseController.test.ts:75-231`; `apps/api/tests/unit/domains/pay/controllers/ptoController.test.ts:70-155`; `apps/api/tests/unit/domains/timesheet/repositories/timesheetRepository.test.ts:86-117` (asserts `chain.update` received the same `snapshotPatch` the test supplied); `apps/api/tests/unit/domains/pay/services/weekEarningsService.test.ts:954-996` (fetch scoping only); `apps/api/tests/unit/domains/child/services/coverageGapService.pushes.test.ts:79-89`; `apps/mobile/src/api/endpoints/__tests__/timesheets.test.ts:13-27` (fixture `total_minutes: 554` never recomputed).
**Trace:** HTTP controller → mocked command/query service (no engine) → response; or repository `approveSubmittedWithEarnings` → mocked PostgREST `update` with caller-supplied `gross_minor`.
**Wrong-number scenario:** Cannot itself mint a wrong paid amount; it fails to catch one. Example: change `priceMinutes` so 480 min × 1850p → 14799 instead of 14800 — every controller/repo test above still passes.
**Fix sketch:** Delete or demote call-only controller tests as coverage; add one assert of `gross_minor`/`total_minutes` on any path that claims to cover pay/hours.

### F-B10-2 | S0 | confidence: high
**Claim:** No test exercises Postgres RLS with an authenticated non-member (or helper) JWT against money/hours tables; “RLS tests” only grep migration SQL text, while the API always bypasses RLS via the service role.
**Location:** `apps/api/src/config/supabase.ts:6-12` (service role bypass); `apps/api/tests/unit/migration041PayArrangements.test.ts:381-404` (string contains policy); same pattern `migration043PtoLedger.test.ts:340+`, `migration044Expenses.test.ts:384+`; `supabase/migrations/040_rls_semantic_predicates.sql:323-333` (live `timesheets`/`time_entries` SELECT policies); A3 §3 confirms select-only money tables and no runtime RLS suite.
**Trace:** Client → PostgREST as `authenticated` → RLS policy on `timesheets`/`pay_arrangements`/`expenses`/`pto_ledger` — never invoked in tests. App path: route → service membership check → `supabaseService` (RLS off).
**Wrong-number scenario:** Not a wrong cent via the Express API if service gates hold. Wrong access: a leaked anon/authenticated key reading `pay_arrangements` / `timesheets` for another household is unchecked by the suite; policy drift that re-adds `can_read_household` on pay tables (explicitly forbidden in `migration041PayArrangements.test.ts:392-393`) is only caught if the SQL string still matches the grep.
**Fix sketch:** One integration test: two JWTs, `authenticated` client, assert non-member `select` on `timesheets`/`pay_arrangements` returns 0 rows.

### F-B10-3 | S1 | confidence: high
**Claim:** Aside from `payArrangementRoutes`, no money-path route is tested through real Express middleware to a service; timesheet/time-entry/expense/pto HTTP wiring is unproven.
**Location:** `apps/api/tests/unit/domains/pay/routes/payArrangementRoutes.test.ts:1-60,151-187` (only mounted-router money test; auth stubbed, services mocked); no `*Routes*.test.ts` for timesheets/time-entries/expenses/pto; controllers stub services (`timesheetController.test.ts:34-56`).
**Trace:** Missing: `POST /api/v1/timesheets/:id/approve` → `authWithOwnership` (`A1` row 77) → `TimesheetController.approve` → `timesheetCommandService.approve` → `weekEarningsService.computeForWeek` → freeze. Present tests jump in at controller or service with mocks.
**Wrong-number scenario:** Param/body mis-wire (wrong `id`, skipped ownership preset) can approve or clock against the wrong resource; suite would not fail. Does not by itself alter `priceMinutes` arithmetic.
**Fix sketch:** Copy the `payArrangementRoutes` listen+fetch pattern for `timesheetRoutes` approve/clock-out with a real `WeekEarningsService` stub only at the DB.

### F-B10-4 | S0 | confidence: high
**Claim:** Every `TimesheetCommandService.approve` test injects a mocked `computeForWeek`; the freeze path never runs real earnings arithmetic, so a broken engine cannot fail approve tests.
**Location:** `apps/api/tests/unit/domains/timesheet/services/timesheetCommandService.test.ts:2060-2064` (`makeEarnings`), used at `:2094`, `:2142`, `:2174`, `:2517`, `:2885`, etc.; contrast real engine case tables in `earningsService.test.ts:1058-1070` and `weekEarningsService.test.ts:1065-1079`.
**Trace:** `approve` → `computeSnapshot` (`timesheetCommandService.ts:871-888`) → `earnings.computeForWeek` (mocked) → `approveSubmittedWithEarnings` with mocked `gross_minor: 14_800`.
**Wrong-number scenario:** Mutate `priceMinutes` half-up to floor; parent still “approves” in all approve tests and freezes whatever the mock returns (14800). Production would freeze the wrong cent; only the separate pure-engine file would go red — and only if someone runs it and notices the layer split.
**Fix sketch:** One approve test constructing `new TimesheetCommandService(..., new WeekEarningsService(fakeRepos))` and asserting frozen `gross_minor` from known entries/rate.

### F-B10-5 | S0 | confidence: high
**Claim:** No test covers worked hours and unreverted PTO usage on the same `local_date` (the cancelled-then-worked double-pay hazard the netting comments describe).
**Location:** Closest PTO+worked asserts different days: `earningsService.test.ts:772-788` (MON worked, TUE PTO); `weekEarningsService.test.ts:1183-1209` (default Mon entry + PTO `2026-08-04`); reversal-without-work: `weekEarningsService.test.ts:514-538`. No same-date pair found.
**Trace:** `pto_ledger` usage (no reversing adjustment) + `time_entries` same `local_date` → `buildWeekEarningsInput` / `netPtoUsage` → `computeWeekEarnings` → both `regular` and `pto` lines → `gross_minor` sum → approve freeze.
**Wrong-number scenario:** Carer works 8h on 2026-08-03 and an unreverted −480 PTO usage exists for 2026-08-03 at £18.50/h → engine pays 960 payable minutes / £296.00 with no test pinning “must reverse first” or “double pay is intended.”
**Fix sketch:** Add engine + `buildWeekEarningsInput` cases: same-day worked+PTO with and without reversing adjustment; assert gross.

### F-B10-6 | S1 | confidence: high
**Claim:** Mobile and API each maintain a separate worked-minutes formula with no shared golden vectors; the clock-out UI “mirror of the server rule” test only regexes a function name.
**Location:** API `workedMinutes.ts:28-31` (`round(elapsed) - break`); mobile `entryMinutes.ts:33-35` (`round(elapsed - break)`); API tests `timesheetCommandService.test.ts:173-192`; mobile `entryMinutes.test.ts:37-41`; UI `ClockOutSheet.test.tsx:202-206` (source contains `computeWorkedMinutesFromInstants(...)` only).
**Trace:** Clock-out sheet preview → mobile formula; server clock-out roll-up → API formula → `timesheets.total_minutes` / earnings `worked_minutes`.
**Wrong-number scenario:** Change API to `Math.floor(ms/60000)` and leave mobile; preview shows 481, timesheet stores 480 — ClockOutSheet test still green; no cross-app case fails.
**Fix sketch:** Shared fixture table (ISO in/out/break → minutes) asserted in both `workedMinutes` and `entryMinutes` tests; replace source-regex with a numeric render assert.

### F-B10-7 | S1 | confidence: high
**Claim:** `effectiveOn` is duplicated in SQL/repo and in-memory engine with no test that both implementations agree on the same arrangement history.
**Location:** `earningsService.ts:274-305` (in-memory; comment says rule must change in both places); `payArrangementRepository.test.ts:136-204` (repo only); engine mid-week rate tests `earningsService.test.ts:164-246,726-768` do not call the repository.
**Trace:** Approve/live week → `WeekEarningsService` loads arrangements → `computeWeekEarnings` → in-memory `effectiveOn`; other reads → `PayArrangementRepository.effectiveOn` (PostgREST `lte`/`order`).
**Wrong-number scenario:** Tie-break or `valid_from <= date` drifts in one copy only → expense/mileage priced at rate A while timesheet wages use rate B for the same calendar day.
**Fix sketch:** Export or twin-test one fixture vector through repo fake-chain and `computeWeekEarnings` arrangements list; assert identical arrangement id.

### F-B10-8 | S2 | confidence: med
**Claim:** Child-commitment tests still use `HH:MM` wall times (`'09:00'`), the D25 fixture class that previously hid production `HH:MM:SS` mismatches (availability was fixed; this lane was not).
**Location:** `apps/api/tests/unit/domains/child/services/childCommitmentCommandService.test.ts:80-86,105`; `coverageGapService.pushes.test.ts:22-23` (`startTime: '09:00'` — service accepts both per `coverageGapService.ts:62-63`, so the fixture never forces the DB wire shape).
**Trace:** Commitments → coverage gaps / schedule materialisation → shift spans → eventual clock/pay windows (indirect).
**Wrong-number scenario:** Does not directly mint a wrong `gross_minor` today; can hide parse/compare bugs that skip or duplicate coverage windows feeding schedule hours.
**Fix sketch:** Use `'09:00:00'` / `'12:00:00'` in fixtures to match `time` column wire form (A3 / D25).

### F-B10-9 | S2 | confidence: high
**Claim:** `bun run qc` does not run the same gates as CI: CI’s new-file coverage script is absent from qc, and neither qc nor CI runs `test:coverage`, so `bunfig` 30% thresholds never fail a gate.
**Location:** `scripts/qc.sh:51-52,84` (`test`/`lint`/`format:check`/`typecheck` only); `.github/workflows/ci.yml:75-88` (api tests + `check-test-coverage-new.sh`); `apps/api/bunfig.toml:8-9` (`coverageThreshold`); `apps/api/package.json:15-16` (`test` vs `test:coverage`).
**Trace:** Developer `bun run qc` green → merge; CI may still fail `check-test-coverage-new.sh`; coverage thresholds never consulted.
**Wrong-number scenario:** Cannot produce a wrong cent by itself; allows money-path source to land without a colocated test file that CI would have required.
**Fix sketch:** Invoke `check-test-coverage-new.sh` from `qc.sh`; optionally add `test:coverage` to CI for api/mobile.

### F-B10-10 | S3 | confidence: high
**Claim:** CI’s API test runner reimplements the one-file loop instead of calling `scripts/run-tests-one-file.sh`, so future script filters/exclusions can silently diverge from CI.
**Location:** `.github/workflows/ci.yml:78-82`; `apps/api/scripts/run-tests-one-file.sh:10-18`; `apps/api/package.json:15`.
**Trace:** `qc` → `bun run test` → script; CI → inline `find … bun test`.
**Wrong-number scenario:** None today (same `*.test.ts` set). Latent: a skipped money test file in one runner only.
**Fix sketch:** CI step: `bun run test` (or `bash scripts/run-tests-one-file.sh tests/unit`).

---

## Untested invariants

Boundary matrix (money/hours path):

| Boundary | Any test? |
|---|---|
| DST transition day (hours roll-up / earnings filing) | **No** (DST covered for recurrence/`weekStart`/wallClock display only — not `computeWorkedMinutes` or `gross_minor`) |
| Midnight-crossing / overnight shift | **Yes** — overnight rate (`earningsService.test.ts:232+`); week-boundary reject (`timesheetCommandService.test.ts:1687+`) |
| Week boundary | **Yes** |
| Zero hours / empty week | **Yes** (`sumWorkedMinutes` empty; zero worked + PTO/guarantee cases) |
| Negative / zero amount | **Partial** — PTO mark-paid `minutes: 0` tested; no approve of negative `gross_minor` (DB check exists, no runtime test) |
| Rounding half-cent | **Yes** (`earningsService.test.ts:1058-1070`, overtime half-up table) |
| Concurrent double-submit | **Partial** — approve CAS + timesheet `23505` yes; DB unique one-running clock-in race not exercised against Postgres |
| Timesheet reopen after approval | **Yes** |
| PTO + worked hours **same day** (no reversal) | **No** |
| Rate change mid-week | **Yes** |
| Carer removed mid-week / departed | **Partial** — hours-only / empty snapshot for departed; not “removed Wednesday, Mon–Tue still priced” |

Properties that must always hold for hours/pay and currently have **no** (or no end-to-end) test behind them:

1. `timesheets.total_minutes` from roll-up equals `WeekEarnings.worked_minutes` for the same entry set (module comment in `workedMinutes.ts:14-16` — never co-asserted).
2. Frozen approve snapshot `gross_minor` equals live `computeWeekEarnings` for the same week inputs (approve always mocks the engine — F-B10-4).
3. Unreverted PTO usage + worked entry on the same `local_date` has a defined pay outcome (forbid double pay **or** document intentional sum) — F-B10-5.
4. In-memory `effectiveOn` and `PayArrangementRepository.effectiveOn` return the same arrangement for every `(history, date)` — F-B10-7.
5. Mobile `computeWorkedMinutesFromInstants` and API `computeWorkedMinutes` agree on a shared golden table (including half-minute elapsed boundaries) — F-B10-6.
6. Sub-minute clock spans: e.g. 29.4s vs 30.5s elapsed → documented `Math.round` minute (only whole-hour fixtures in `computeWorkedMinutes` tests `:173-192`).
7. Household-local DST spring-forward / fall-back calendar day: entry `local_date`, `week_start`, and priced lines for a shift/entry whose UTC span crosses the transition.
8. Authenticated non-member receives zero rows from PostgREST on `timesheets`, `time_entries`, `pay_arrangements`, `expenses`, `pto_ledger` (RLS) — F-B10-2.
9. Helper member cannot `SELECT` another carer’s `pay_arrangements` / `expenses` via PostgREST (select-only + `can_write_household` arm) — SQL-grep only.
10. `POST /timesheets/:id/approve` and `POST /time-entries/.../clock-out` through real `authWithOwnership` / validation presets hit the intended service with the intended ids — F-B10-3.
11. Concurrent double clock-in against the live unique “one running entry” index loses safely (service `AlreadyClockedInError` mocked; no DB race test).
12. `earnings.worked_minutes` + dated `pto_usage` on a guarantee week never double-pays the same minutes as both top-up and PTO when those minutes share a closure day **and** a worked entry (hazard cases exist for PTO-vs-topup and cancellation `became_payable`, not PTO+worked same day).
13. After reopen, a subsequent approve freezes a newly computed gross that reflects post-reopen entry edits (reopen + approve tested with mocked earnings, not recomputed wages).
14. Client-displayed clock-out minutes equal server `total_minutes` for the same instants/break (UI test is source-regex only — F-B10-6).
15. Coverage / qc: every new money-path source file has a test file (`check-test-coverage-new.sh` not in qc); line coverage thresholds in `bunfig.toml` are never enforced by qc or CI — F-B10-9.
