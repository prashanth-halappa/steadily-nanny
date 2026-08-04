# TIER0-PLAN.md

Implementation plan for `AGENCY-ROADMAP.md` Tier 0 (money primitives) plus the
Section 4 groundwork that is cheap now and expensive later. Written 2026-08-04
against `claude/nanny-agency-features-os2jbx` (head `e919b4e`).

**Explicitly out of scope, per the roadmap and product owner:**
- Push/email/SMS delivery — the notification outbox stays in-app-only. Nothing
  in this plan depends on delivery; the owner will wire it separately.
- Payroll tax filing, agency tenant, open shifts, invoicing (Tiers 1–2).

Every phase below follows the repo's vertical-slice recipe (`CLAUDE.md`):
shared Zod schema → migration → repository → service → controller → routes →
mobile endpoint → query keys → hooks → screen, with tests colocated at every
layer and `bun run qc` green before the phase is called done.

---

## Execution model: sub-agents, strict TDD, and gates

Implementation is orchestrated across sub-agents sized to task complexity, with
one orchestrator holding the plan and the gates. Rules first, assignments
second.

### Strict TDD — non-negotiable, per task

1. **Red first, captured.** For every unit of behaviour: write the test, run
   it, and record the failure (test file + failing output in the task log)
   **before** any implementation exists. This is house style, not ceremony —
   Wave 0's delete-account UI shipped this way, and the plan inherits it.
2. **Green by the minimal change**, then refactor with the suite green.
   No implementation code lands in a commit that doesn't also contain (or
   follow) its red-first test.
3. **Test the wiring, not just the unit** — the D15 lesson. A component test
   that hands the component its own props proves nothing about the app. Every
   screen-level task includes a test that renders the real screen
   (`HoursScreen`, `PayArrangementScreen`) and asserts the control is reachable
   and wired. Every route/controller task includes a test through the mounted
   router, not the controller function in isolation.
4. **Repo test conventions bind every agent**: `bun:test` only;
   `mock.module()` inside `beforeAll` before any dynamic import
   (`docs/09-TESTING.md`); one file per process via the existing runner; mobile
   tests in `__tests__/`, never colocated in `src/app/` (GOLDEN-FIXES #8);
   test files are typechecked, so they stay type-clean.
5. **Migrations get executable assertions too**: each migration lands with
   additions to `scripts/e2e-assert.ts` (or a phase-local assert script)
   covering its RLS behaviour — written before the migration, red against the
   pre-migration schema where runnable. Where a live DB isn't available to the
   agent, the assertion script still lands with the phase and the owner runs it
   at apply time; "not runnable here" never means "not written".

### The gate — every phase, before it is called done

`bun run format` then **`bun run qc` green from the repo root** (run
unsandboxed — the sandboxed-shell tempdir failure is a known environment issue,
PROJECT-STATUS §8; `bun install` first on a fresh container). A red QC row is
the phase still being in progress, never a footnote in the handoff. The
orchestrator runs the gate itself rather than trusting a sub-agent's claim of
green — same verifier discipline the repo already uses.

### Agent assignments by task

Tiering rule: **opus** for tasks where a subtle mistake is expensive and quiet
(RLS, money math, authorization); **sonnet** for well-scoped vertical-slice
work with a clear pattern to copy; **haiku** for mechanical, low-blast-radius
work. Every phase ends with an **opus adversarial review** of the diff — this
repo's Wave 3/5 history shows happy-path-green code hiding real
authorization and state-integrity defects, and money raises the stakes.

| Task | Agent | Why |
|---|---|---|
| 0-A RLS indirection migration (enumerate + repoint every policy) | **opus** | Wide blast radius, three known traps (grants, initplan, search_path); a quiet mistake here 500s every read |
| 0-A verification additions to e2e-assert | sonnet | Pattern exists |
| 0-B paired constraint/const-map comments | haiku | Two comments |
| 0-C `docs/11-MONEY.md` + doc-table wiring | sonnet | Distillation of locked decisions, needs judgement not invention |
| 1 migration `041_pay_arrangements` + RLS | **opus** | Append-only policy design; money schema conventions set precedent here |
| 1 shared schema + repository (incl. `effectiveOn`) | sonnet | `effectiveOn` tie-break rule is subtle but single-method; red-first case table specified below |
| 1 command/query services (membership assertion) | **opus** | D12-class authorization check; repositories bypass RLS |
| 1 controller + routes + mobile endpoint/hooks | sonnet | Mechanical slice copy |
| 1 screens (parent Pay, nanny read-only) + wiring tests | sonnet | UI + D15-style wiring tests |
| 1 i18n en+es, query keys, barrels | haiku | Mechanical |
| 2 migration `042_timesheet_earnings` | sonnet | Four nullable columns |
| 2 **earnings engine + case table** | **opus** | The hardest logic in Tier 0: mid-week rate change, overtime/topup interaction, closure weeks, currency-change error arm |
| 2 timesheet service wiring (live/freeze/reopen-clears-snapshot) | **opus** | Recreates the exact D1 failure surface |
| 2 Hours screen money line + approve dialog + wiring tests | sonnet | UI |
| 3 migration `043_pto_ledger` (anonymity note, idempotent accrual index) | **opus** | Touches the cross-family anonymity boundary |
| 3 services (lazy accrual, markTimeOffPaid assertions) | sonnet, **opus review** | One D12-class check inside otherwise patterned work |
| 3 mobile (balance, mark-paid flow, unnamed-family rendering) | sonnet | The unnamed-family surface gets a LEAKCANARY-style test |
| 4 migration `044_expenses` | sonnet | Patterned, CHECK constraints specified above |
| 4 services (carer-write gate, approve-freezes-mileage) | sonnet, **opus review** | Carer-writable table is new ground; review focuses there |
| 4 mobile (add-expense, review sheet, statement section) | sonnet | UI |
| 4 i18n + statement copy | haiku | Mechanical |
| Per-phase adversarial diff review | **opus** | Wave 3 culture: try to break it before calling it done |

Orchestration notes: within a phase, independent lanes (API slice vs. mobile
slice after the shared schema lands; i18n alongside screens) run as parallel
sub-agents; anything touching the same files serializes. The orchestrator —
not a sub-agent — owns commits, the QC gate, and the phase review handoff.

---

## Design decisions locked by this plan

These are the choices the rest of the document assumes. Each is cheap to veto
now and expensive to veto after Phase 1 ships.

1. **Money is integer minor units + an ISO-4217 code, everywhere.** Column
   suffix `_minor` (`rate_minor`, `gross_minor`), `currency char(3)` on every
   table that stores an amount, defaulting `'GBP'` (the app is en-GB today).
   Never a float, never a bare number. Zod side: `z.number().int().nonnegative()`
   plus a `currency` string field; no `Money` object on the wire.

2. **The unit of pay configuration is the *arrangement*, not the household.**
   One effective-dated `pay_arrangements` row per (household, carer,
   valid_from) carries the hourly rate **and** the terms that travel with it:
   overtime threshold/multiplier, guaranteed weekly minutes, PTO entitlement,
   mileage rate, and a dormant `bill_rate_minor`. Rationale: two nannies in one
   household can have different deals, and a raise usually renegotiates the
   terms together. This collapses roadmap items 0.1 and 0.3's config — and part
   of 0.4's — into one table instead of three.

3. **Arrangements are append-only.** A change is a new row with a later
   `valid_from`; nothing is mutated or deleted. Pay history is evidence in
   exactly the dispute this product exists to prevent — same discipline as the
   frozen `scheduled_minutes` and the append-only `shift_events`.

4. **Earnings are computed live while a week is open, and frozen at approval.**
   The weekly pay statement is derived (minutes × the arrangement effective on
   each entry's `local_date`) whenever the timesheet is `open`/`submitted`/
   `queried`, and snapshotted onto the timesheet row at the moment of approval.
   The existing D1 reopen path (new hours landing in an approved week flip it
   back to `submitted`) must also **clear the snapshot**, or the frozen number
   becomes a stale lie — the exact failure D1 fixed for status.

5. **No arrangement → no numbers, never zero.** A week with hours but no
   effective arrangement renders "Set a pay rate to see totals", not £0.00. A
   silently wrong zero is the worst output a pay feature can produce.

6. **Paid PTO lives household-side, as a ledger.** `carer_time_off`
   deliberately carries **no household reference** — that's what makes
   cross-family leakage structurally impossible (`011_availability.sql`). So
   "this time off is paid" can never be a flag on the time-off row (paid by
   *whom*?). It's a `pto_ledger` row in the household's scope that *references*
   the time-off id. Balance = sum of ledger rows. This also just works for a
   nanny with two families where one pays PTO and the other doesn't.

7. **Reimbursements are not wages.** Expenses/mileage appear on the weekly
   statement as a separate reimbursement section — excluded from overtime math
   and from the gross-pay line, because that's how payroll (and tax) treats
   them.

8. **Jurisdiction presets are out of scope; the model must not preclude them.**
   V1 ships a weekly overtime threshold + multiplier (nullable = no overtime).
   US state rules (CA daily overtime etc.) become presets that *populate* these
   fields later; nothing hardcodes 40 hours anywhere.

---

## Phase 0 — Section 4 groundwork (no behaviour change)

### 0-A. RLS semantic indirection — migration `040_rls_semantic_predicates.sql`

Create pass-through wrappers in `private`:

```sql
create function private.can_read_household(hid uuid) returns boolean
  ... select private.is_household_member(hid);
create function private.can_write_household(hid uuid) returns boolean
  ... select private.is_household_parent(hid);
```

Then drop/recreate **every** policy that calls `is_household_member` /
`is_household_parent` directly to call the wrappers instead. Call sites to
repoint span `009, 010, 014, 015, 017, 018, 021, 022, 033, 035` (grep count
above 60 mentions; the real policy list is what the migration enumerates —
write it by grepping `pg_policies` on a live branch DB, not by eyeballing
files).

Traps, all previously paid for in this repo:
- **Grants**: revoke from `PUBLIC`, then grant to `anon, authenticated,
  service_role` explicitly (`012_fix_rls_helper_grants.sql`, GOLDEN-FIXES #16).
  A policy expression runs with the *caller's* privileges; SECURITY DEFINER
  does not grant the right to enter the function.
- **Initplan**: `018_optimize_rls_initplan.sql` wrapped predicate calls as
  `(select private.is_household_member(...))` so Postgres evaluates once per
  query, not per row. The recreated policies must keep that form with the new
  names.
- `security definer`, `set search_path = ''`, schema-qualified body — copy the
  house style from 009 verbatim.

**Definition of done:** migration applies clean; the existing RLS/e2e
assertions (`scripts/e2e-assert.ts`, LEAKCANARY fixtures) pass unchanged
against a live dev DB — this is a pure refactor and any behaviour delta is a
bug. (Applying against live Supabase is a human/owner step; the PR carries the
migration + a note in the description.)

### 0-B. Role-widening path — decision recorded, no code

Keep `household_members.role`'s four-value CHECK constraint. The recorded plan
for when agency roles arrive: one migration drops/re-adds the constraint, and
the same change widens `HOUSEHOLD_ROLES` in
`packages/shared-types/src/schemas/household.schema.ts` — the const-map and
the constraint are declared (in comments on both) to be a matched pair that
only ever changes together. Add those two comments now; nothing else.

### 0-C. Money conventions doc — `docs/11-MONEY.md`

One page: minor units + currency column convention, the arrangement concept,
append-only rule, compute-live/freeze-at-approval, the no-arrangement-no-zero
rule, reimbursements-are-not-wages. Add a row to `docs/README.md`'s table and a
line to `CLAUDE.md`'s required-reading table ("before touching anything that
renders or stores an amount"). The repo's own rule: knowledge not written down
is a documentation defect.

**Phase 0 estimate: S–M.** One migration (mechanical but wide), two comments,
one doc.

---

## Phase 1 — Pay arrangements (roadmap 0.1 + 0.3 config)

### Migration `041_pay_arrangements.sql`

```
pay_arrangements
  id                          uuid pk
  household_id                uuid not null → households on delete cascade
  carer_id                    uuid → user_profiles on delete set null   -- 033 discipline:
                                                                       -- payroll history survives account deletion
  rate_minor                  integer not null check (>= 0)            -- per hour
  bill_rate_minor             integer                                  -- dormant until Tier 2 invoicing
  currency                    char(3) not null default 'GBP'
  overtime_threshold_minutes  integer check (> 0)                      -- null = no overtime
  overtime_multiplier         numeric(3,2) not null default 1.50 check (>= 1)
  guaranteed_minutes_per_week integer check (>= 0)                     -- null = none
  pto_entitlement_minutes_per_year integer check (>= 0)                -- null = none (Phase 3 reads it)
  mileage_rate_per_mile_minor integer check (>= 0)                     -- null = none (Phase 4 reads it)
  valid_from                  date not null
  note                        text                                     -- "annual review", shown in history
  created_by                  uuid → user_profiles on delete set null
  created_at                  timestamptz not null default now()
  unique (household_id, carer_id, valid_from)
```

No `updated_at` and no update trigger — the table is append-only; a correction
is a new row (same `valid_from` is rejected by the unique constraint; the fix
for a fat-fingered rate entered today is a new row dated today… which collides —
so allow superseding by `created_at` tiebreak? **No.** Keep it simple and
honest: the effective arrangement for a date is the row with the greatest
`valid_from <= date`, ties broken by `created_at desc`. Document that rule in
the migration header and implement it in exactly one repository method).

RLS: select via `(select private.can_read_household(household_id))` — the
carer is a member, so she can always see her own terms (deliberate: opaque pay
is the disease). Insert via `can_write_household`. No update/delete policies at
all — append-only enforced at the policy layer too.

### Shared contract — `packages/shared-types/src/schemas/payArrangement.schema.ts`

`PayArrangementSchema`, `CreatePayArrangementRequestSchema` (no id/created
fields, `valid_from` as ISO date string), `PayArrangementListResponseSchema`.
Amounts as `z.number().int().nonnegative()`; document the minor-units rule in
the module JSDoc mirroring `timesheet.schema.ts`'s style.

### API — new domain `apps/api/src/domains/pay/`

- `schemas.ts` — re-export barrel over the shared module + URL param schemas
  (the timesheet pattern).
- `repositories/payArrangementRepository.ts` — `BaseRepository` +
  `effectiveOn(householdId, carerId, date)` and
  `listForCarer(householdId, carerId)`. `effectiveOn` is the **only** place the
  greatest-valid-from rule exists.
- `services/payArrangementCommandService.ts` — `create()`: parent-gated (role
  check at top, house style), then the **D12-class check**: assert `carer_id`
  is an *active member with role `nanny`* of *this* household before writing —
  repositories bypass RLS, the service is the gate. Collapse "no such carer"
  and "not your carer" into one error.
- `services/payArrangementQueryService.ts` — history + current.
- `errors/payErrors.ts` — `PayArrangementNotFoundError`.
- Controller + routes: `GET/POST
  /households/:householdId/carers/:carerId/pay-arrangements` via the
  `authWithValidation` presets; mount one line in `routes/index.ts`.

### Mobile

- `api/endpoints/payArrangements.ts` validating with the shared schema.
- `queryKeys.ts`: new `pay:` block (`current(householdId, carerId)`,
  `history(householdId, carerId)`).
- Hooks: `useCurrentPayArrangement`, `usePayArrangementHistory`,
  `useCreatePayArrangement`.
- UI: parent-only "Pay" screen reached from the member row in Settings →
  Household (`app/(private)/settings/pay.tsx` thin route →
  `domains/pay/components/PayArrangementScreen.tsx`): current terms card, an
  effective-dated "change" form (rate, overtime, guaranteed hours; PTO and
  mileage fields appear here too but are inert until Phases 3–4), and a
  history list. Nanny sees a read-only version of her own terms (Settings →
  "My pay"). Currency input: display-major, store-minor — conversion in one
  util (`lib/` or shared), property-tested (the classic ×100 float bug).
- i18n: en + es for every string.

**Phase 1 estimate: M.** The slice is mechanical; the two careful spots are
`effectiveOn` and the membership assertion.

---

## Phase 2 — Earnings on the timesheet (roadmap 0.2 + 0.3 math)

### Migration `042_timesheet_earnings.sql`

Columns on `timesheets`: `gross_minor integer`, `currency char(3)`,
`earnings jsonb`, `earnings_computed_at timestamptz` — all nullable, all null
while the week is open. `earnings` holds the full frozen breakdown (line items
with minutes, rate used, arrangement id) so an approved week is
self-describing even if arrangements change later.

### Earnings engine — `apps/api/src/domains/pay/services/earningsService.ts`

Pure function first, service wrapper second (test the function exhaustively,
`bun:test`, case table):

Input: the week's `time_entries` (with `kind`, minutes, `local_date`), the
arrangements effective across the week, household closure days, the
guaranteed-minutes config. Output line items:

- `regular` — worked minutes up to the overtime threshold × rate.
- `overtime` — minutes past `overtime_threshold_minutes` in the week ×
  rate × multiplier. Weekly basis only (decision 8). Uses the arrangement
  effective on each entry's `local_date`; a mid-week raise means two rates in
  one week — the case table must include it.
- `cancellation_paid` — the existing kind, finally priced.
- `manual_adjustment` — priced at the effective rate.
- `guaranteed_topup` — `max(0, guaranteed_minutes_per_week − payable minutes)`
  × rate. Household-closure days ("we're away") are the canonical trigger:
  the family's holiday must not zero the nanny's week. Topup is a computed
  line, never a synthetic `time_entries` row — the honest record of what was
  *worked* stays untouched.
- (Phases 3–4 append `pto` and `reimbursements` lines here; the engine's
  output shape includes them from day one, empty.)

Missing arrangement → the engine returns a typed `no_arrangement` result, not
zeros (decision 5).

### Wiring

- `timesheetQueryService` week read: attach live-computed earnings when status
  ≠ `approved`; return the frozen snapshot when `approved`.
- `timesheetCommandService.approve()`: compute → snapshot → approve, in one
  path, so what the parent saw is what froze.
- The D1 reopen path: **null out the four snapshot columns** when an approved
  week reopens. Add the regression test next to the existing D1 test.
- Shared contract: extend `timesheet.schema.ts` with `EarningsSchema` (line
  items, totals, `no_arrangement` union arm) on the week response.

### Mobile

- Hours screen: money line under the hours total for both roles; breakdown
  sheet (regular / overtime / cancellation / topup) on tap.
- Parent approve dialog: show the gross that is about to freeze.
- `no_arrangement` arm renders the "Set a pay rate" nudge → deep-link to the
  Phase 1 screen (parent) or a "ask your family to set a rate" line (nanny).

**Phase 2 estimate: M–L.** The engine's case table is the real work: mid-week
rate change, overtime + topup interaction (topup compares against *payable*
minutes, so an overtime week never also tops up), closure week, zero-hours
week, multi-currency-never (one currency per week asserted — a week spanning a
currency change is an error case, not a summed one).

---

## Phase 3 — PTO ledger (roadmap 0.4)

### Migration `043_pto_ledger.sql`

```
pto_ledger
  id             uuid pk
  household_id   uuid not null → households on delete cascade
  carer_id       uuid → user_profiles on delete set null
  kind           text check in ('accrual','usage','adjustment')
  minutes        integer not null check (<> 0)      -- signed: accrual +, usage −
  effective_date date not null
  time_off_id    uuid → carer_time_off on delete set null   -- usage rows only
  note           text
  created_by     uuid → user_profiles on delete set null
  created_at     timestamptz not null default now()
```

Append-only (no update/delete policies; corrections are `adjustment` rows).
RLS: read `can_read_household`, insert `can_write_household`. The
`time_off_id` FK is the *only* place a household-scoped row references a
cross-household time-off row; the anonymity analysis is: the household can
already see this time-off's existence via impact counts, and the FK reveals
nothing about *other* households. Say exactly that in the migration header.

V1 accrual model: **annual grant, not per-hour accrual** — one `accrual` row
per year from the arrangement's `pto_entitlement_minutes_per_year`, created
lazily by the API on first read of a year with no accrual row (idempotent:
unique partial index on (household_id, carer_id, kind, effective_date) for
kind='accrual'). Per-hour accrual is a later mode, not a v1 branch.

### API — extend `pay` domain

- `ptoLedgerRepository`, `ptoQueryService.balance(householdId, carerId)` (and
  ledger list), `ptoCommandService.markTimeOffPaid(timeOffId, minutes)` —
  parent-gated, D12-class assertion that the time-off's `user_id` is an active
  nanny of this household, minutes capped at the span's working overlap,
  duplicate-mark rejected (one usage row per (household, time_off)).
- Earnings engine: `pto` line = usage rows dated in the week × effective rate.

### Mobile

- Parent: the existing time-off impact surface gains "Mark N hours paid"
  (shows balance before/after). Balance chip on the member pay screen.
- Nanny: balance per family on "My pay"; a paid marker on her time-off rows
  (per family, unnamed families stay unnamed — it renders as "1 family paid
  this", never a name, on the cross-family surface).

**Phase 3 estimate: M.**

---

## Phase 4 — Expenses & mileage (roadmap 0.5)

### Migration `044_expenses.sql`

```
expenses
  id             uuid pk
  household_id   uuid not null → households on delete cascade
  carer_id       uuid → user_profiles on delete set null
  local_date     date not null
  kind           text check in ('expense','mileage')
  description    text not null
  amount_minor   integer check (>= 0)        -- expense rows: entered directly
  miles          numeric(6,1) check (> 0)    -- mileage rows
  currency       char(3) not null default 'GBP'
  status         text check in ('pending','approved','rejected') default 'pending'
  reviewed_by / reviewed_at / review_note
  created_at / updated_at (+ set_updated_at trigger)
  check: (kind='expense') = (amount_minor is not null)
  check: (kind='mileage') = (miles is not null)
```

Mileage amount is computed at **approval** (miles × the arrangement's
`mileage_rate_per_mile_minor` effective on `local_date`) and written into
`amount_minor` — frozen, same discipline as everything else. RLS: read
`can_read_household`; **insert by the carer herself** (`carer_id = auth.uid()`
∧ member) — this is the one Tier 0 table a nanny writes; review (status
change) via `can_write_household`. Service layer mirrors both gates.

### API — extend `pay` domain

`expenseRepository`, command service (`create` carer-gated with membership
assertion; `approve`/`reject` parent-gated; approve computes+freezes mileage
amount; no-mileage-rate → typed error, not zero), query service (list by week
/ status). Earnings engine: `reimbursements` section = approved expenses dated
in the week — summed separately, excluded from gross and overtime (decision 7).

### Mobile

- Nanny: "Add expense" from the Hours screen (kind toggle, date, description,
  amount-or-miles), list with status chips.
- Parent: pending-expenses row on the week view → approve/reject sheet.
- Weekly statement gains the reimbursement section.

**Phase 4 estimate: M.**

---

## Cross-cutting rules (every phase)

- **CX is specified, not improvised**: `docs/TIER0-CX-SPEC.md` is the binding
  design source for every screen, string, and state in Phases 1–4 — routes,
  layout, en-GB microcopy, empty/error states, and edge-case rendering all come
  from there. Its §10 open questions block only the pieces they name; agents
  implement the spec's stated defaults until the owner rules otherwise.

- **Tests**: written red-first per the execution model above, `bun:test` only;
  service tests `mock.module()` inside `beforeAll` before any dynamic import
  (`docs/09-TESTING.md`); mobile component tests in `__tests__/`, never
  colocated in `src/app/` (GOLDEN-FIXES #8). The earnings engine gets a
  case-table test file; the minor-units conversion util gets property-ish edge
  tests (0, 1p, £999999.99).
- **Every write that accepts a client-supplied foreign id gets a service-layer
  ownership assertion** (D12/D13/D14). In this plan: `carer_id` on
  arrangements, `time_off_id` on PTO marking, `carer_id`+`household_id` on
  expenses.
- **i18n**: en + es for every user-facing string, same wave — the repo has
  already paid once for retrofitting (Wave 5).
- **UI gotchas**: no `className` on `Animated.View`, `useElevation()` not
  `shadow-*`, weight via `fontWeight`, `BottomSheetBase` for any sheet
  (GOLDEN-FIXES #1/#2/#3/#19).
- **Biome/typecheck**: no `any`, no `!`, `import type`; test files are also
  typechecked. `bun run format` before commit; `bun run qc` green per phase.
- **Migrations are files in this repo first**; applying to the live Supabase
  project (`dylhrlvfkibipdkguptz`) is an owner step — each phase's PR notes
  which migrations it adds.

## Sequencing and delivery

Phases land in order — 0 → 1 → 2 → 3 → 4 — as separate commits (or separate
PRs if review cadence prefers; 0+1 pair naturally, 3 and 4 are independent of
each other and could swap or parallelize once 2 is in). Each phase leaves the
app shippable: after 1 rates exist but nothing prices; after 2 the Hours
screen shows money; 3 and 4 add their statement lines to an engine already
shaped to receive them.

Rough total: **4–6 focused implementation sessions** at this repo's
conventions-and-tests density, Phase 2 the largest.

## Open items deliberately left with the owner

- Apply migrations 040–044 to the live project as phases land (service-role
  access is not available to agents here).
- Default currency confirmed as GBP? (Plan assumes yes; it's a one-line
  default either way.)
- Notification *content* for expense-approved / pay-set events: rows will go
  to the existing in-app outbox like every other domain event; delivery
  remains the owner's separately-planned work.
