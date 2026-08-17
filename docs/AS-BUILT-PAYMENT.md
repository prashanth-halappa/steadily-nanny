# Payment — as-built map

**What this is:** the payment chain — time entries → week totals → approval → payment → correction → settlement — as the code implements it, diffed against `docs/11-MONEY.md`, `docs/design/screens-hours.md`, `docs/TIER0-CX-SPEC.md` and `docs/ROLLBACK-RUNBOOK.md`.

**Captured:** 2026-08-17, against `main` at `0ad4dd5`.

**Companions:** [`AS-BUILT-PAY-TERMS.md`](./AS-BUILT-PAY-TERMS.md) · [`AS-BUILT-SCHEDULE.md`](./AS-BUILT-SCHEDULE.md) · [`CROSS-CUTTING-DEFECT-PATTERNS.md`](./CROSS-CUTTING-DEFECT-PATTERNS.md) — the mobile render defects, **including a live double-payment path**, live there.

---

## 1. Method and limits

Two independent read-only passes — data model + API, and mobile CX — plus a docs-only pass. **Nothing was executed:** no tests run, no app launched, no database queried. Test files were read.

---

## 2. The chain, and what freezes

| Step | Freezes | Stays live |
|---|---|---|
| clock-in | display name, timezone, `local_date` | everything priced |
| clock-out | `scheduled_minutes` | earnings |
| week roll-up | `total_minutes` (full recompute, never an increment) | earnings |
| read while unapproved | nothing | every figure, computed fresh per read |
| **approve** | `gross_minor`, `currency`, `earnings` jsonb, `earnings_computed_at` | nothing money-side |
| record payment | the row's household/carer/currency, stamped from the **locked** timesheet | paid-to-date (signed sum, per read) |
| correct | stamped from the **original payment**, not the timesheet | — |
| reopen | — | all four snapshot columns nulled |

**The freeze is one conditional update** gated on **both** `status = 'submitted'` **and** `updated_at` matching the version read before computing (`timesheetRepository.ts:241-263`). Both arms are load-bearing: a clock-out rolling new minutes onto an already-`submitted` week leaves status untouched, so a status-only guard would freeze a pre-clock-out gross over hours nobody signed off.

**Hours are not frozen — the snapshot is.** New hours reopen the week rather than being refused.

### Can an approved figure still move?

| Vector | Verdict |
|---|---|
| Backdated arrangement | **No** — the snapshot is read back, never recomputed |
| Late expense or mileage | **No** — 409 `EXPENSE_WEEK_LOCKED`; rejecting stays allowed |
| Voided entry | **No** — `TimeEntryNotEditableError('week_approved')` |
| Correction | **No** — touches `payments` only |
| **Clock-out into an approved week** | The figure does not change — **the approval is revoked.** Status flips back, snapshot nulls, parent learns by push. Deliberate: *"a clock-out must never fail because a parent tapped Approve; the hours happened and must be recorded"* |
| **Re-approval at a lower gross after payments exist** | **This one moves.** Approve → pay → reopen → re-approve lower. Payments survive; `balance_due_minor` goes negative. Consequence documented; see P1 |

---

## 3. Money correctness — all six claims PASS

Verified against `docs/11-MONEY.md`, with citations.

| Claim | Verdict | Evidence |
|---|---|---|
| Minor units, **no float arithmetic** | **PASS** | `priceMinutes` is integer half-up; multipliers never form a float product. The comment records that the naive `Math.floor(rate * multiplier + 0.5)` was wrong on **16,337 of 20,000** rate/multiplier pairs, always low |
| Corrections are a negative row, never a mutation | **PASS** | Enforced at three layers — DB shape CHECK, no write policy, no route/method. The sign flip lives in **one line**: *"Asking a human to type a minus sign to un-record a payment is how a correction ends up adding money to a week"* |
| Payment and correction export separately, never netted | **PASS** | `weekExportCsv.ts:332-334` with a required guard comment: *"THE PAIR IS THE AUDIT TRAIL"* |
| `balance_due_minor` never clamped | **PASS** | Plain subtraction; an overpayment renders negative |
| No arrangement → typed result, never a fabricated 0 | **PASS** | The `no_arrangement` arm of the discriminated union has **no `gross_minor` key** — writing the bug is a type error |
| Reimbursements are not wages | **PASS** | Excluded from gross, payable minutes, and the payment ceiling by construction; separate table with no `timesheet_id` |

**A nanny can never write money — no, three ways, each proven by a test.** She cannot record a payment, approve her own timesheet, or edit an entry in an approved week. Where the terms domain needed an identity swap, the payment side needs none: no payment flow is ever nanny-initiated, so instead the RPC **takes no household, carer or currency parameter** — *"there is nothing to spoof."*

**Client side:** no `rate × hours` arithmetic exists anywhere (grep-verified), with explicit refusal comments at five call sites, one naming the exact `$1,400 vs $1,540` bug it avoids. A fabricated `$0.00` never renders — `derivePaidState` returns `null` on a null gross rather than measuring against zero.

---

## 4. Races

### Prevented by a real mechanism

Migration 077's `record_timesheet_payment` locks the **timesheet row carrying the frozen gross** — not an advisory key on the payment set — because *"a reopen that is in-flight but uncommitted is invisible to any predicate read at READ COMMITTED."* Sum, refusal and insert happen in one body behind that lock, with everything stamped from the locked row.

Covered: two simultaneous payments exceeding gross; a payment landing on a week being reopened; a correction racing a payment; a double reversal; a correction chaining off a correction; a correction reaching another household's payment; **a week approved twice** (CAS on `id + status + updated_at`); an approve freezing a gross computed from stale hours; two parents settling the same carer-week (unique index); a second void double-counting.

Both SQL bodies are pinned as source by tests asserting the lock precedes the sum and that the body contains no `least(`/`greatest(` — *refuses, never clamps*.

### Accepted and recorded

- **Payment double-tap → two legitimate-looking rows.** `payments` has no unique index beyond its PK. Recorded in `077:60-67` and `085:83-86` — **but not in `ONBOARDING-PAY-SCHEDULE-GAPS.md` §5.2** where its two sibling D-57 risks live. Anyone auditing accepted money risks from the ledger will miss it.
- Reimbursement settle race (D-57) — see P2.

### Neither prevented nor recorded — the findings

**P1 — reopen never consults `payments`.** The *consequence* (a negative balance) is documented; **the race that produces it is not** — not in the gap ledger, not in a migration header, not as a race in any doc. `record_timesheet_payment` takes a `FOR UPDATE`; `reopen` is a plain CAS'd PostgREST update that never asks whether money has moved before clearing the gross those payments were bounded by.

**P2 — the `approved ⇒ frozen snapshot` invariant has no database constraint.** `042:87` calls it *"a service-layer invariant"*. There is no CHECK asserting `status='approved' ⇒ gross_minor is not null`, and `rollUpIntoTimesheet` reaches the table through the generic unconditional `BaseRepository.update`. Correct today purely because of what that one call site passes.

**P3 — a money-CAS invariant with a single untested enforcement point.** `stampParentViewed` must not bump `updated_at`, or every concurrent approve silently loses its CAS. That guarantee lives entirely in a migration-100 trigger and **no test at any layer asserts it**.

---

## 5. The reimbursement settlement gap — verified link by link

`ROLLBACK-RUNBOOK.md` §9.2 carries a correction dated 2026-08-12 saying its own earlier description understated this. Each link was re-checked in code:

| Link | Verdict |
|---|---|
| Unlocked sum → settlement captures a stale figure | **CONFIRMED** — plain read then `reduce`, two round trips, no lock, no plpgsql |
| Unique index blocks a second settlement | **CONFIRMED** — and it is structurally incapable of preventing an **under** settle. It answers the double-tap, and only the double-tap |
| `listUnsettled` suppresses on **existence**, never amount | **CONFIRMED** — `amount_minor` is never read into the suppression set. One row of any amount removes every approved claim in that carer-week from the owed list, permanently |
| 086 gives the table no correction path | **CONFIRMED** at five layers — no route, no service method, no RPC, no policy, no job |
| **Silent — nothing on screen shows the settled amount** | **REFUTED.** The runbook's own proposed mitigation has shipped |

**The refuted link matters.** `expenses.json` now carries `"stateSettled": "Reimbursed {{amount}} on {{date}}"`, and `ReimbursementsCard.tsx:159-168` renders the settlement's own `amount_minor` beside the live approved total. Both week views pass it. A short settlement reads "Total to reimburse £30.00 / Reimbursed £24.60 on 12 August" — visible to both parties. The nanny-side half (*"reads 'not reimbursed yet' permanently after she has been paid back"*) is **also fixed**.

**So the risk today is: permanent, unremediable-in-product money loss — now visible rather than silent.** §9.2 itself said on-screen visibility is what makes accepting this race *"defensible rather than merely cheap"*. By its own standard the accepted-risk classification is better justified than the document admits.

**Three doc claims are stale and should be corrected toward the code:** `ROLLBACK-RUNBOOK.md:271-275`, `:293-298`, and `POST-SHIP-WATCH.md` §6b's premise. (§6b's SQL detection query is still valid and still the only way to find historical drift.) Its cited line numbers have also drifted.

**To settle a stranded remainder: no product path exists.** Manual database write only.

---

## 6. Multi-nanny and multi-family

**Server: no leak at any layer.** The read scope **overrides** a client-supplied `carerId` rather than defaulting it — *"a nanny handed carer-2's id would otherwise read carer-2's pay."* `assertPayrollReader` resolves by role first: parents household-wide, a nanny **forced** to own-scope, a helper refused outright, active or removed. Existence leaks are uniformly closed — 404 not 403, with denials required to be **byte-identical** to the no-such-row throw because `metadata` serialises on any sub-500 status.

A removed nanny reads what she was paid and writes nothing; a removed parent reads payroll but cannot approve or pay; a `candidate` reads nothing — *"There is no audit trail to keep for somebody who has not been paid anything."*

**Client, parent side: clean.** The carer is picked once and all eight derivations read from that one key, including the lead line — name and hours from the same carer. The one surface that aggregates (`PendingExpensesRow`) names **every** contributing carer and refuses to show a total unless the rows share one currency.

**Client, nanny in two households: four wrong-household instances**, detailed in `CROSS-CUTTING-DEFECT-PATTERNS.md` §A. The worst carries a real money figure from household B into a link that opens household A's week.

**Structurally fragile, not currently wrong:** `NannyWeekView.tsx:522` computes `approvedExpenses` with **no carer filter**, safe only because the server narrows a nanny to own-scope. An invariant that lives only on the server.

---

## 7. Other findings

- **P4 — the Hours screen has no household switcher.** Nineteen push types route to it. A nanny landed on the wrong household's week has no in-screen way to switch, and navigating away loses the one-shot `weekStart` param.
- **P5 — the reopen reason is write-only.** The parent is compelled to type one; nothing ever reads it back. The component's own header admits it.
- **P6 — migration 100's receipt is nearly invisible.** `parent_viewed_at` reaches exactly one place — the middle step of the nanny's status timeline — which renders **only while the week is `submitted`**. Approving or querying erases the evidence the week was ever opened, and the parent never sees it at all.
- **P7 — `timesheets.status = 'open'` is dead**, as is `time_entries.status` `'approved'`/`'queried'`. Kept because shipped clients read them; `open` and a null timesheet are indistinguishable in the UI.
- **P8 — `BaseRepository.update`/`delete` are inherited and callable** on every append-only table including `payments` and `reimbursement_settlements`, running as service role where RLS cannot stop them. "Append-only" there is enforced by nobody having written the call.
- **P9 — `docs/11-MONEY.md` §11 is stale in the code's favour.** It describes the payment over-gross race as open and the TS service as sole enforcement; 077 closed it and 085 re-issued it.

---

## 8. Test coverage gaps

1. **No append-only assertion on `PaymentCommandService`.** Settlements have an explicit test that `update`, `delete` and `correct` are `undefined`; payments have no equivalent — so the strongest guarantee in the design is unasserted on the table where it matters most.
2. **`recordCorrection`'s repository→Supabase wiring is unpinned.** Its sibling pins the exact RPC name and five `p_*` params; renaming a param on `record_payment_correction` fails no unit test.
3. **P3 is untested** — nothing asserts the migration-100 trigger preserves `updated_at`.
4. **P1 is untested end to end** — no test reopens a week with payment rows, re-approves lower, or drives a negative balance.
5. **The accepted double-tap is untested as behaviour** — if a unique index is ever added, nothing goes red to prompt the reserved handler.

---

## 9. What holds up

This is the most rigorous code in the repository.

- **All six money-correctness claims pass**, including exhaustive verification of the rounding fix.
- **A fabricated zero is a type error**, not a convention.
- **The lock anchors on the right row**, with the reasoning written into the migration.
- **Existence leaks are closed uniformly**, down to byte-identical denial metadata.
- **A helper touches no money in either direction**, active or removed.
- **Client money axes fail closed** — `paidState` returns null rather than "Unpaid", the reimbursements card withholds a subtotal rather than zeroing it, and the earnings error arm fires before every other branch.
- **i18n is at exact en/es parity** across six namespaces.

The defects are not in the money engine. They are in what the UI says when a *query* fails around it — which is why the highest-severity payment finding lives in `CROSS-CUTTING-DEFECT-PATTERNS.md`, not here.
