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
| 1 nanny pay setup flow (form + prompt-card entry points) | sonnet | Same field set as the change sheet; wiring tests for both entry points |
| 1 i18n en+es, query keys, barrels | haiku | Mechanical |
| 2 migration `042_timesheet_earnings` | sonnet | Four nullable columns |
| 2 **earnings engine + case table** | **opus** | The hardest logic in Tier 0: mid-week rate change, overtime/topup interaction, closure weeks, currency-change error arm |
| 2 timesheet service wiring (live/freeze/reopen-clears-snapshot) | **opus** | Recreates the exact D1 failure surface |
| 2 cancellation window repoint in shift change-requests | sonnet, **opus review** | Changes what a nanny gets paid; three-arm fallback logic |
| 2 Hours screen money line + approve dialog + wiring tests | sonnet | UI |
| 3 migration `043_pto_ledger` (anonymity note, idempotent accrual index) | **opus** | Touches the cross-family anonymity boundary |
| 3 services (lazy accrual, markTimeOffPaid assertions) | sonnet, **opus review** | One D12-class check inside otherwise patterned work |
| 3 mobile (balance, mark-paid flow, unnamed-family rendering) | sonnet | The unnamed-family surface gets a LEAKCANARY-style test |
| 4 migration `044_expenses` | **opus** | Retiered per review finding 19: the CHECK-constraint interplay with the approval write, and the select-only RLS stance, make it money-critical |
| 4 services (carer-write gate, approve-freezes-mileage) | sonnet, **opus review** | Carer-writable table is new ground; review focuses there |
| 4 mobile (add-expense, review sheet, statement section) | sonnet | UI |
| 4 i18n + statement copy | haiku | Mechanical |
| Per-phase adversarial diff review | **opus** | Wave 3 culture: try to break it before calling it done |

Orchestration notes: within a phase, independent lanes (API slice vs. mobile
slice after the shared schema lands; i18n alongside screens) run as parallel
sub-agents; anything touching the same files serializes. The orchestrator —
not a sub-agent — owns commits, the QC gate, and the phase review handoff.

---

## Owner decisions — 2026-08-04 (binding)

The product owner ruled on the open questions from `docs/TIER0-CX-SPEC.md` §10
and added two scope changes. These override anything else in this document or
the CX spec where they conflict:

1. **No co-parent approval for pay changes.** A single parent sets and changes
   pay terms; nothing routes through `approvalGateService`. The gate stays
   `can_write_household`, full stop.
2. **"Gross" stays** as the label (owner: "gross or total is fine").
3. **PTO entitlement is set during nanny setup** by the parent (it is a field
   of the arrangement, captured in the setup flow below), and the PTO year is
   the **calendar year** for v1.
4. **No future-dated rate changes in v1.** `valid_from` must be today or
   earlier (service-enforced; backdating allowed — an open week recomputes,
   an approved week stays frozen). The CX spec's "Scheduled change" card and
   the nanny's scheduled-change visibility are cut; the change sheet's
   effective-date default becomes **today**, not next Monday. The mid-week
   split rendering stays — a mid-week change still splits the week.
5. **Cancellation policy is per-nanny, set during setup, with a
   no-cancellation-pay option.** New column on the arrangement:
   `cancellation_paid_within_hours integer null check (> 0)` — a number means
   "a cancellation within N hours of the start is paid"; **null means no
   cancellation pay**. An arrangement's policy always overrides the household
   column; `households.cancellation_paid_within_hours` remains only as the
   fallback when no arrangement exists (flagged for deprecation, not dropped).
6. **Mileage rate is per-nanny, set during setup** — confirmed; this is
   already where the plan put it (a column on the arrangement).
7. **Nanny pay setup flow is in Phase 1 scope.** A full-form "Set up pay for
   {name}" flow — rate, effective date, overtime, guaranteed hours, PTO
   entitlement/yr, cancellation policy, mileage rate — reachable from (a) a
   prompt card parents see whenever an active nanny has no arrangement and
   (b) the no-arrangement empty states already specified. All fields are
   **live inputs and stored from Phase 1** (they are all columns of migration
   `041`); what lands later is their downstream *effect* — PTO accrual in
   Phase 3, mileage pricing in Phase 4. The stored-but-not-yet-priced fields
   say so inline ("Used from a later update" is banned copy — say what it
   does: e.g. mileage shows on expenses once expenses ship).

Per-nanny cancellation policy adds one integration task to Phase 2:
`shiftChangeRequestCommandService.ts` (line ~182) currently decides
`cancellation_paid` from `household.cancellation_paid_within_hours`; that read
becomes "the effective arrangement's window, null → not paid, no arrangement →
household fallback". Red-first tests for all three arms; sonnet with opus
review (it changes what a nanny gets paid).

---

## Independent review — 2026-08-04, folded in

An independent Fable-model reviewer with no authorship stake audited this plan
and the CX spec against the live codebase (20 findings: 4 ship-blockers, 8
serious, 8 minor; verdict "implementable to ship quality after fixes, no
structural rework"). Every accepted fix is edited into the body below and
tagged `review finding N` at the point it landed. The load-bearing corrections:

- **044's CHECK constraints** were equivalences that made mileage approval
  impossible → now implications, plus a DB-enforced no-amount-before-approval
  check (finding 1).
- **041's unique constraint** made a same-day rate typo permanently
  uncorrectable under no-future-dates + append-only → dropped; the
  `created_at desc` tie-break is the correction mechanism (finding 2).
- **Write RLS policies are gone from all three new tables** — select-only,
  service-role writes, the house pattern; client-exercisable insert policies
  would have bypassed every service rule, including letting a nanny insert
  pre-approved expenses (finding 3).
- **Guaranteed-topup eligibility was unruled** and as drafted paid out for
  nanny-caused shortfalls → payable-minutes defined precisely; **one owner
  ruling still required before Phase 2's engine starts** (finding 4, marked
  in place).
- **Phase 0's initplan instruction was factually wrong** about 018 → method
  rewritten: reproduce policies verbatim with only the helper name swapped;
  live-DB verification split out as explicit owner steps (finding 6).
- Legacy pre-042 approved weeks render hours-only (5); `carer_display_name`
  snapshots on all three tables (7); the notification-outbox fiction replaced
  with the real `householdPush` mechanism and a PROJECT-STATUS correction
  (8); PTO usage race closed with a 039-style partial unique index, status
  guard, and cancel-reconciliation adjustment rows (9); cancellation repoint
  specified to the actual function shape, date basis, and 0-window mapping
  (10); household-local "today" (11); worked/payable/overtime minutes defined
  (12); conditional approve (13); house Zod style (14); warn-never-block on
  mark-paid (16); analytics events (17); pending-expense edit/withdraw +
  currency assertion (18); 044 retiered to opus (19); PTO grant sourcing
  rules (20).

The reviewer also verified and cleared the plan's key claims — the D1 reopen
hook point, household-local week keying, the single cancellation decision
site, 033's deletion discipline, the anonymity argument for the `pto_ledger`
FK, and the CX spec's component/line anchors — so implementers need not
re-examine those.

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
`is_household_parent` directly to call the wrappers instead. Policy-bearing
migrations to repoint: `009, 010, 014, 015, 017, 018, 021, 022, 035` (033 is
comment-only; 016's tables don't use these helpers; the independent review
confirmed nothing but policies calls them — no views, triggers, or other
functions).

**Method (corrected per review finding 6):** reproduce each existing policy's
text **verbatim from the repo's migration files** — taking 018's versions for
the tables 018 rewrote (`time_entries`/`timesheets`, whose policies carry the
`(select auth.uid()) = carer_id` OR-arm) — with only the helper name swapped.
Do NOT wrap the helper calls in `(select ...)`: 018 deliberately left
household-helper calls bare, because the initplan optimisation lives *inside*
the helpers (they take a per-row `household_id` and cannot be initplans);
wrapping them is a form that has never existed in this repo.

Traps, all previously paid for in this repo:
- **Grants**: revoke from `PUBLIC`, then grant to `anon, authenticated,
  service_role` explicitly (`012_fix_rls_helper_grants.sql`, GOLDEN-FIXES #16).
  A policy expression runs with the *caller's* privileges; SECURITY DEFINER
  does not grant the right to enter the function.
- `security definer`, `set search_path = ''`, schema-qualified body — copy the
  house style from 009 verbatim.

**Definition of done, split by who can do it (review finding 6):** the agent
writes the migration from the repo's migration files and lands a policy-parity
check with it. The **owner steps**, recorded in the PR description: apply to
the live project, diff `pg_policies` before/after (name, cmd, qual,
with_check — only the helper names may differ), and run
`scripts/e2e-assert.ts` + the LEAKCANARY fixtures. This is a pure refactor;
any behaviour delta is a bug.

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
  cancellation_paid_within_hours integer check (> 0)                   -- null = NO cancellation pay;
                                                                       -- overrides households.* when set (owner decision 5)
  valid_from                  date not null                            -- must be <= household-local today;
                                                                       -- enforced in the command service
                                                                       -- (owner decision 4, review finding 11)
  carer_display_name          text not null                            -- snapshot at insert (033 discipline);
                                                                       -- survives carer deletion (finding 7)
  note                        text                                     -- "annual review", shown in history
  created_by                  uuid → user_profiles on delete set null
  created_at                  timestamptz not null default now()
  -- NO unique constraint on (household, carer, valid_from) — deliberately
  -- (review finding 2): with no-future-dates and append-only, uniqueness
  -- would make a same-day rate typo permanently uncorrectable. A non-unique
  -- index (household_id, carer_id, valid_from desc) serves effectiveOn.
```

No `updated_at` and no update trigger — the table is append-only; a correction
is a new row. The effective arrangement for a date is the row with the greatest
`valid_from <= date`, **ties broken by `created_at desc`** — which is exactly
how a same-day correction supersedes the typo it fixes. Document that rule in
the migration header, implement it in exactly one repository method, and put
the same-day-correction case in `effectiveOn`'s red-first case table.

RLS (**house pattern for API-mediated money tables — select-only**, review
finding 3): select via `(select private.can_read_household(household_id))` —
the carer is a member, so she can always see her own terms (deliberate: opaque
pay is the disease). **No insert/update/delete policies at all** — writes go
through the API under the service role, exactly like `shifts` (015) and
`time_entries` (017). A client-exercisable insert policy would let a parent
bypass every service-enforced rule (the no-future-dates check, the D12-class
carer assertion) with the anon key + her own JWT; the service layer being the
only write path is what makes those rules real. Append-only is enforced by the
absence of any update/delete path anywhere in the stack.

### Shared contract — `packages/shared-types/src/schemas/payArrangement.schema.ts`

`PayArrangementSchema`, `CreatePayArrangementRequestSchema` (no id/created
fields, `valid_from` as ISO date string), `PayArrangementListResponseSchema`.
House Zod style (review finding 14): `z.int().min(0)` for amounts, `z.uuid()`,
`z.iso.date()`, `z.string().length(3)` for currency — match
`timesheet.schema.ts`, not generic Zod idioms. Document the minor-units rule
in the module JSDoc mirroring that file's style.

### API — new domain `apps/api/src/domains/pay/`

- `schemas.ts` — re-export barrel over the shared module + URL param schemas
  (the timesheet pattern).
- `repositories/payArrangementRepository.ts` — `BaseRepository` +
  `effectiveOn(householdId, carerId, date)` and
  `listForCarer(householdId, carerId)`. `effectiveOn` is the **only** place the
  greatest-valid-from rule exists.
- `services/payArrangementCommandService.ts` — `create()`: parent-gated (role
  check at top, house style — a single parent suffices, owner decision 1: no
  `approvalGateService` involvement), then the **D12-class check**: assert
  `carer_id` is an *active member with role `nanny`* of *this* household before
  writing — repositories bypass RLS, the service is the gate. Collapse "no such
  carer" and "not your carer" into one error. Also validates
  `valid_from <= today` **in the household's timezone** (owner decision 4,
  review finding 11 — server-UTC "today" would reject a morning "today" east
  of UTC; the `weekStart.ts` utilities already do this conversion) and
  rejects a future date with a typed error; the red-first tests pin a
  non-UTC household on both sides of midnight.
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
- UI (per `docs/TIER0-CX-SPEC.md` §2–3, as amended by owner decisions 4/5/7):
  parent-only "Pay & terms" screen (`/settings/pay`, `/settings/pay/[carerId]`
  → `domains/pay/components/PayArrangementScreen.tsx`): current terms card
  (now including the cancellation-policy row), the change sheet
  (effective-date default **today**, past dates allowed, no future dates, no
  Scheduled card), and the append-only history list. Nanny gets read-only
  "My pay" (`/settings/my-pay`). Currency input: display-major, store-minor —
  conversion in one util, property-tested (the classic ×100 float bug).
- **Nanny pay setup flow** (owner decision 7): "Set up pay for {name}" —
  the change sheet's field set as a first-run form (rate, effective date,
  overtime, guaranteed hours, PTO entitlement/yr, cancellation policy with an
  explicit "No cancellation pay" option defaulting from the household's
  current window, mileage rate). Entry points: a prompt card on Manage
  household whenever an active nanny has no arrangement, plus the
  no-arrangement empty states. Every field stores from Phase 1; PTO/mileage
  *effects* land in Phases 3–4.
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
arrangements effective across the week, household closure days, the carer's
time-off days, the guaranteed-minutes config, and (Phase 3+) the week's PTO
usage. Definitions the engine states in code and tests, not in prose (review
findings 4 and 12):

- **Worked minutes** = `worked` + `manual_adjustment` entries (an adjustment
  is a clock-span correction of worked time; downward corrections are
  unrepresentable in v1 — the DB requires `clock_out > clock_in` — and the
  engine documents that).
- **Overtime counts worked minutes only.** `cancellation_paid`, PTO, and
  topup never push a week over the threshold — overtime compensates work
  actually done.
- **Payable minutes** = worked + cancellation_paid + PTO usage. This is what
  the guaranteed-hours comparison runs against, so a paid-PTO week never
  *also* tops up (no double pay).

Output line items:

- `regular` — worked minutes up to the overtime threshold × rate.
- `overtime` — worked minutes past `overtime_threshold_minutes` in the week ×
  rate × multiplier. Weekly basis only (decision 8). Uses the arrangement
  effective on each entry's `local_date`; a mid-week raise means two rates in
  one week — the case table must include it. An overnight entry belongs
  wholly to its clock-in `local_date` (the 017 trigger), so an entry spanning
  a rate-change midnight prices at the old rate — in the case table too.
- `cancellation_paid` — the existing kind, finally priced.
- `guaranteed_topup` — `max(0, guaranteed_minutes_per_week − payable minutes)`
  × rate, **subject to the eligibility rule below**. Topup is a computed
  line, never a synthetic `time_entries` row — the honest record of what was
  *worked* stays untouched.
- (Phases 3–4 append `pto` and `reimbursements` lines here; the engine's
  output shape includes them from day one, empty.)

**Topup eligibility — the one open owner ruling (review finding 4).** As
first drafted the formula paid out for *any* shortfall, including
nanny-caused ones (her unpaid week off would earn a full-week topup).
Recommended rule, pending the owner's word: **days on which the carer has
time off reduce the guarantee pro-rata** (guaranteed minutes × scheduled days
she was available ÷ scheduled days), so household closures and family
under-booking still trigger the topup — the guarantee's actual purpose — but
the nanny's own absence never does. Alternative if simpler is wanted: topup
only for household-closure shortfalls. Phase 2 does not start the engine until
this is ruled.

Missing arrangement → the engine returns a typed `no_arrangement` result, not
zeros (decision 5).

### Wiring

- `timesheetQueryService` week read: attach live-computed earnings when status
  ≠ `approved`; return the frozen snapshot when `approved`. **Legacy arm
  (review finding 5):** a week `approved` before migration 042 has a NULL
  snapshot — it renders hours only, no money line, ever. A live-computed
  number must never appear under an "Approved" label.
- `timesheetCommandService.approve()`: compute → snapshot → approve as one
  **conditional update** (`... where status = 'submitted'`, review finding
  13) so a concurrent clock-out roll-up — D1's exact surface — cannot slip
  hours in between the compute and the freeze.
- The D1 reopen path: **null out the four snapshot columns** when an approved
  week reopens. Add the regression test next to the existing D1 test.
- **Cancellation window repoint** (owner decision 5, detailed per review
  finding 10): the sole decision point is `planAcceptedChange` — a **pure,
  synchronous** function taking `Household`, so the effective arrangement is
  fetched in the async accept path (~line 666) and threaded in, which changes
  an exported signature and its existing tests. The arrangement is selected
  by the **shift's household-local start date** (not the accept date — they
  differ across a rate change). Three arms, red-first: window set → that
  window; window explicitly null → not paid; no arrangement → household
  fallback. The household column allows `0` (= no pay); the arrangement
  column forbids it (`> 0` or null) — the setup form maps a `0` household
  default to the "No cancellation pay" chip.
- Shared contract: extend `timesheet.schema.ts` with `EarningsSchema` (line
  items, totals, `no_arrangement` union arm) on the week response.
- **Notifications (review finding 8 — there is no outbox):** the repo's real
  mechanism is `householdPush.ts`-style `notifyUser`/`notifyHouseholdParents`
  calls plus `PUSH_NOTIFICATION_TYPES` entries, as `timesheetCommandService`
  already does for `TIMESHEET_QUERIED`. Add types and calls for: pay terms
  set → nanny; (Phase 4) expense submitted → parents, expense
  approved/rejected → nanny; (Phase 3) time off marked paid → nanny.
  Delivery remains whatever the app does today — no new delivery work (owner
  directive). Fix `PROJECT-STATUS.md` §5's outbox claim in the same commit
  (house rule: doc defects are fixed in-session).

### Mobile

- Hours screen: money line under the hours total for both roles; breakdown
  sheet (regular / overtime / cancellation / topup) on tap.
- Parent approve dialog: show the gross that is about to freeze.
- `no_arrangement` arm renders the "Set a pay rate" nudge → deep-link to the
  Phase 1 screen (parent) or a "ask your family to set a rate" line (nanny) —
  **except for a departed/deleted carer** (review finding 7): her `carer_id`
  is null or her membership inactive, the parent cannot complete the CTA (the
  command service requires an active member), so her unapproved weeks render
  hours-only with distinct copy, never the set-a-rate nudge.

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
  carer_display_name text not null                          -- snapshot at insert (finding 7)
  note           text
  created_by     uuid → user_profiles on delete set null
  created_at     timestamptz not null default now()
  -- unique partial index (household_id, time_off_id) where kind='usage'
  -- (finding 9): the 039 pattern — one paid marking per time off per
  -- household, enforced by the DB, not by two concurrent taps agreeing.
```

Append-only. RLS: **select-only** via `can_read_household` — no write
policies; writes are service-role only, same stance as 041 (finding 3). The
`time_off_id` FK is the *only* place a household-scoped row references a
cross-household time-off row; the anonymity analysis is: the household can
already see this time-off's existence via impact counts, and the FK reveals
nothing about *other* households. Say exactly that in the migration header.

V1 accrual model: **annual grant, not per-hour accrual** — one `accrual` row
per year, created lazily by the API on first read of a year with no accrual
row (idempotent: unique partial index on (household_id, carer_id,
effective_date) where kind='accrual'; note the lazy grant makes that read a
write-on-GET, deliberately). Grant rules (finding 20): the grant amount is the
`pto_entitlement_minutes_per_year` of the arrangement effective **at grant
time**; a mid-year entitlement change does NOT retro-adjust the year's grant
(documented; the parent can add an `adjustment` row); no pro-rating for
mid-year joiners in v1 (same escape hatch). Per-hour accrual is a later mode,
not a v1 branch.

### API — extend `pay` domain

- `ptoLedgerRepository`, `ptoQueryService.balance(householdId, carerId)` (and
  ledger list), `ptoCommandService.markTimeOffPaid(timeOffId, minutes)` —
  parent-gated, D12-class assertion that the time-off's `user_id` is an active
  nanny of this household, **only `confirmed` time off is markable** (finding
  9), duplicate-mark rejected by the partial unique index. Minutes are freely
  chosen with an over-balance warning, never a hard cap (finding 16 — the CX
  spec's warn-never-block stance wins; the plan's earlier "capped at the
  span's working overlap" is dropped).
- **Cancelled time off with a usage row** (finding 9): when a carer cancels a
  time off that a household has marked paid, the service inserts a reversing
  `adjustment` row (append-only correction) and notifies the parents — the
  balance self-heals, silently unpaying nobody.
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
  carer_display_name text not null              -- snapshot at insert (finding 7)
  created_at / updated_at (+ set_updated_at trigger)
  -- Implications, NOT equivalences (review finding 1 — an equivalence would
  -- make the mileage-approval write, which sets amount_minor on a
  -- kind='mileage' row, violate its own constraint):
  check (kind <> 'expense' or amount_minor is not null)
  check (kind <> 'mileage' or miles is not null)
  -- DB-enforces "no indicative amount before approval" (spec §10.6):
  check (kind <> 'mileage' or status = 'approved' or amount_minor is null)
```

Mileage amount is computed at **approval** (miles × the arrangement's
`mileage_rate_per_mile_minor` effective on `local_date`) and written into
`amount_minor` — frozen, same discipline as everything else. RLS:
**select-only** via `can_read_household`; no write policies (finding 3 — a
carer-self insert policy would let a client insert `status='approved'` rows
with arbitrary amounts, self-approving money; the nanny writes through the
API like every other mutation in this app, and the service enforces
carer-role + membership + `status='pending'` + currency matching the
effective arrangement's currency, per finding 18).

**Pending-expense corrections (finding 18):** the carer can edit or withdraw
her own expense while `status='pending'` (service-gated to `carer_id =
caller` and pending status; withdraw is a hard delete of a pending row —
nothing downstream references it). Once reviewed, rows are immutable; a
mistake after approval is the parent's `manual_adjustment` escape hatch.

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
- **Analytics** (review finding 17): the repo has a full PostHog module
  (`src/lib/analytics/`); each phase adds its events — `pay_terms_set`,
  `timesheet_approved` gains a `has_earnings` property, `expense_submitted`
  / `expense_reviewed`, `pto_marked_paid`. Event payloads carry ids and
  minutes, **never amounts** — pay figures don't belong in analytics.
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

(The design questions formerly listed here were ruled on 2026-08-04 — see
"Owner decisions" at the top. What remains is operational:)

- Apply migrations 040–044 to the live project as phases land (service-role
  access is not available to agents here).
- Default currency confirmed as GBP? (Plan assumes yes; it's a one-line
  default either way.)
- Notification *content* for expense-approved / pay-set events: rows will go
  to the existing in-app outbox like every other domain event; delivery
  remains the owner's separately-planned work.
