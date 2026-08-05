# 11 — Money

Read this before touching anything that stores or renders an amount:
`pay_arrangements`, `timesheets.gross_minor`/`earnings`, `pto_ledger`,
`expenses`, or any mobile screen that shows a `£` figure. It distils the
binding decisions in `TIER0-PLAN.md` ("Design decisions locked", "Owner
decisions") and `docs/TIER0-CX-SPEC.md` §0–1. Where this doc and either of
those disagree, the plan/spec win — fix this doc in the same session (house
rule: knowledge not written down is a documentation defect).

---

## 1. Storage: integer minor units, never a float

Every amount-bearing column is an `integer` counting the smallest unit of its
currency (pence, cents) — `rate_minor`, `gross_minor`, `amount_minor`. Every
table that stores an amount also carries `currency char(3) not null default
'GBP'` (ISO-4217). There is no bare `numeric`/`float` money column anywhere,
and there must never be one added: floats cannot represent currency exactly
(`0.1 + 0.2 !== 0.3`), and that error compounds across a year of weekly
payroll into numbers people will notice and distrust.

Zod house style for amount fields, matching `timesheet.schema.ts`'s
conventions rather than generic Zod idioms:

```ts
rate_minor: z.int().min(0),
currency: z.string().regex(/^[A-Z]{3}$/),
```

`currency` is a **regex, not `.length(3)`** (Phase 1 review, finding 4).
`"ab1"`, `"gbp"` and `"   "` are all three characters and none is a currency,
and the code is not decoration: `formatMoney` hands it to
`Intl.NumberFormat`, which throws a `RangeError` on a malformed code. Every
money table carries the matching DB check, `check (currency ~ '^[A-Z]{3}$')`,
so wire and table accept the same set. Uppercase only — nothing in the stack
upcases on the way in.

No `Money` object crosses the wire — a minor-units integer plus a sibling
`currency` string, always two fields, never packed into one.

**The display-major/store-minor conversion lives in exactly one util.**
`apps/mobile/src/lib/money.ts` is the only place that multiplies or divides
by 100: `formatMoney(minor, currency)`, `formatRate(minor, currency)`,
`parseMajorToMinor(text)`. `parseMajorToMinor` works on the **string**, never
`Math.round(x * 100)` on a parsed float — that reintroduces the exact bug
integer storage exists to avoid. Every call site imports this util; nobody
hand-rolls `* 100`/`/ 100` elsewhere. Property-test it at `0`, `1p`,
`£999,999.99`.

**Both functions are total, and `parseMajorToMinor` validates rather than
cleans** (Phase 1 review, finding 1). The original *stripped* every leading
non-digit and then parsed whatever survived, which ate the decimal point:
`".45"` became `4500` — £45.00 written into a pay record where 45p was typed.
The rule now is whole-string:

- at most **one** leading currency symbol (`£ € $`) plus an optional space is
  removed — never letters, never a dot;
- the remainder must **fully match** `^\d+(\.\d{1,2})?$` or the grouped form
  `^\d{1,3}(,\d{3})+(\.\d{1,2})?$` — commas are thousands grouping or the
  input is rejected, so `"1,2,3"` is `null`, not `12300`;
- the result is capped at **`99_999_999` minor (£999,999.99)**; above that
  every realistic input is a stray extra digit;
- anything else returns `null`. The caller shows "enter a valid amount"; the
  parser never guesses, for the same reason `parseWallClockInput` doesn't.

`formatMoney` never throws, even on a corrupt stored code: the
`Intl.NumberFormat` construction is wrapped, and a bad code degrades to
`"<code> <amount>"` (e.g. `"AB1 18.50"`). Money renders on the screen a nanny
opens to check what she is owed — a throw there blanks the number she came
for, so inert-but-visible beats correct-or-crash.

---

## 2. The pay arrangement: effective-dated, append-only, per (household, carer)

Pay terms are a row in `pay_arrangements`, one per `(household_id,
carer_id)` pair, effective from a date — not a column on the household or
the carer. A row carries the hourly rate **and** everything that travels
with a raise: overtime threshold/multiplier, guaranteed weekly minutes, PTO
entitlement, mileage rate, cancellation window. **Why one table instead of a
household column:** two nannies in the same household can have different
deals, and a raise usually renegotiates several terms together.

**Append-only.** A change is a new row with a later `valid_from`; nothing is
`UPDATE`d or `DELETE`d — no `updated_at`, no update trigger, no write path
for either. Pay history is evidence in exactly the dispute this product
exists to prevent, the same discipline as the frozen `scheduled_minutes` and
append-only `shift_events`.

**`effectiveOn` is the only place the resolution rule lives.** The
arrangement effective on a date is the row with the **greatest `valid_from
<= date`**, ties broken by **`created_at desc`**. That tie-break is the
deliberate, only correction mechanism for a same-day mistake: insert a
second row with the same `valid_from` and the right rate; the newer
`created_at` wins and the typo is superseded, never mutated. Implement this
in exactly one repository method
(`payArrangementRepository.effectiveOn(householdId, carerId, date)`); every
other call site — engine, screens, mid-week-split preview — calls it rather
than re-deriving the rule.

**Why no unique constraint on `(household_id, carer_id, valid_from)`:**
combined with append-only and no-future-dating, uniqueness would make a
same-day typo **permanently uncorrectable** — you could neither update the
wrong row nor insert a same-day fix. A plain (non-unique) index on
`(household_id, carer_id, valid_from desc)` serves `effectiveOn` instead.
This was drafted, then dropped in review — do not re-add it.

**`valid_from` is household-local today or earlier, never future (owner
ruling, 2026-08-04).** The service rejects any `valid_from` after the
household's **local** today, computed with the same timezone conversion
`weekStart.ts` already uses — server-UTC "today" would wrongly reject a
legitimate morning "today" for a household east of UTC. Backdating is
allowed: an open week recomputes under the new rate, an approved week stays
frozen (§3). There is no "Scheduled change" UI state and no future-dated
arrangement path — cut entirely, not deferred.

---

## 3. Compute live, freeze at approval, clear on reopen

Earnings are **derived**, not stored, while a timesheet is `open`,
`submitted`, or `queried`: minutes × the arrangement effective on each
entry's `local_date`, computed fresh on every read. At approval — inside the
same conditional update that flips status (`... where status = 'submitted'
and updated_at = <the row version read before computing>`) — the computed
breakdown is **snapshotted** onto the timesheet row (`gross_minor`,
`currency`, `earnings` jsonb, `earnings_computed_at`). From then the
approved figure is read from the snapshot, never recomputed, even if the
arrangement later changes.

**Both halves of that predicate are load-bearing** (Phase 2 review, finding
1). The status arm only catches a roll-up that *re-opens* an approved week.
It misses the commoner case: a clock-out rolling new `total_minutes` onto a
week that is **already `submitted`** leaves the status untouched, so a
status-only guard still matches and freezes the pre-clock-out gross over
hours nobody signed off. The `updated_at` arm closes it — the row's
`set_updated_at` trigger fires on every write, so any roll-up at all
invalidates the approve and the parent re-approves against the real hours.

**Reopen clears the snapshot, unconditionally.** The existing D1 reopen path
— new hours landing in an approved week flips it back to `submitted` — must
null out all four snapshot columns in the same write. Skipping this leaves a
frozen number on screen that no longer matches the now-mutated hours: the
same class of stale-authoritative-number bug D1 fixed for status, worse here
because it's a number people get paid against. The clear is **not** gated on
a "was this week terminal?" flag read before the write: an approve landing in
between makes that flag lie, leaving a `submitted` row wearing a frozen gross
and an approver. Every roll-up write sets `status = 'submitted'`, and a
submitted week has no snapshot and no approver by definition — so writing the
nulls every time simply restates the invariant, and is idempotent. Never CAS
the *revert*: a clock-out must never fail because a parent tapped Approve;
the hours happened and must be recorded.

**Legacy weeks render hours-only.** A timesheet `approved` before the
earnings columns existed has a `NULL` snapshot forever, never backfilled.
**A live-computed number must never appear under an "Approved" label** — that
would silently show today's arrangement standing in for whatever was
actually in force when the week was signed off.

**State labels are mandatory.** Every displayed amount carries an explicit
state word: **"Estimated"** while open/submitted/queried, **"Approved"**
once frozen (`docs/TIER0-CX-SPEC.md` §0). A figure with no state label is a
defect — the reader can't otherwise tell a live projection from a locked
number, and those carry very different weight in a pay dispute.

---

## 4. No arrangement → no numbers, never £0.00

A week with hours but no effective arrangement renders a nudge —
"Set a pay rate to see totals" (parent) / "Your family hasn't set a pay
rate ... yet" (nanny) — never `£0.00`. The engine returns a typed
`no_arrangement` result, not a zero total; a `0` is indistinguishable from
"correctly computed to nothing," and a silently wrong zero is the worst
output a pay feature can produce.

**Departed/deleted-carer variant:** once the carer's membership is inactive
or her `carer_id` has gone `NULL` (account deletion, 033 discipline), the
parent cannot complete the "set a rate" CTA — the command service requires
an active member to write an arrangement against. Do not show the nudge
here; render hours-only, naming that the week can't be totalled because
she's no longer in the household. A button the parent can't successfully use
is worse than no button.

---

## 5. PTO is a household-side ledger, not a flag on time off

`carer_time_off` deliberately carries **no household reference**
(`011_availability.sql`) — that absence is what makes cross-family leakage
of a nanny's time off structurally impossible. So "this time off is paid"
can never be a column on `carer_time_off`: paid *by whom*? A shared time-off
row has no single household to attribute a payment to. Instead "paid" is a
`pto_ledger` row living in the household's own scope that *references* the
time-off id via FK. Balance is the signed sum of that household's ledger
rows (`accrual` +, `usage` −, `adjustment` either). This also just works for
a nanny with two families, one paying PTO and the other not — each
household's ledger is independent and neither can see the other's.

The FK from a household-scoped ledger row to a cross-household time-off row
is the **only** place a household-scoped table references a row outside its
own household, and it's narrow by design: the household can already see
this specific time off's existence via its own carer, and the FK reveals
nothing about any *other* household's time off. Don't generalize this
pattern elsewhere without writing down the same anonymity argument.

---

## 6. Reimbursements are not wages

Expenses and mileage appear on the weekly statement as a **separate
reimbursement section**, summed independently and excluded from both the
gross-pay line and the overtime calculation — no `regular`/`overtime`/
`cancellation_paid`/`guaranteed_topup`/`pto` line item ever includes a
reimbursement penny. This matches how payroll and tax treat the two
categories: wages are earned income; a reimbursement pays back money the
nanny already spent on the family's behalf.

---

## 7. Guaranteed-hours top-up: closure-day shortfalls only

**Owner ruling, 2026-08-04, after independent review:** the top-up pays out
**only** for household-closure-day shortfalls — never a generic
under-scheduled week, never a nanny-caused absence. The engine implements
these definitions exactly, not an approximation:

- **Payable minutes** = worked + `cancellation_paid` + PTO usage. Guaranteed
  hours compare against payable minutes, so a week that already used paid
  PTO or a paid cancellation never *also* tops up on top of them — no
  double pay by construction.
- Per household-closure day, **lost minutes** = the scheduled minutes of the
  carer's shifts that day that did **not** become payable (not worked, not
  `cancellation_paid`). A closure-day shift already paid under the
  cancellation window counts as payable and so reduces, not adds to, topup.
- A closure day with **no materialized shifts contributes nothing** — no
  schedule means nothing was lost to it.
- `guaranteed_topup = min(total lost minutes across the week's closure
  days, max(0, guaranteed_minutes_per_week − payable minutes))` — capped at
  what closure days actually cost, never at the full shortfall.
- **A week with no closure days never tops up, whatever the shortfall.**
  Family under-booking and nanny absence are both outside the v1 guarantee;
  only the household choosing to close pays for it.

---

## 8. RLS on money tables: select-only, service-role writes

`pay_arrangements`, `pto_ledger`, and `expenses` all follow one RLS stance:
a single **select** policy, and **no insert/update/delete policy at all**.
Every write goes through the API under the service role, exactly like
`shifts` and `time_entries`.

The select policy is the same on all three:

```sql
using (private.can_write_household(household_id) or carer_id = (select auth.uid()))
```

**Parents and owners, plus the carer reading her own rows. Helpers and other
carers are denied.** That is the product rule (`docs/TIER0-CX-SPEC.md`) and it
is what the query services already enforce: a helper never sees pay, and one
nanny never sees another's rate. An earlier draft used
`private.can_read_household` — *every active member* — which was wider than
both. PostgREST is a real door: a policy looser than the service does not make
the service's refusal safer, it makes it cosmetic. The carer can always read
her own terms, because opaque pay is the disease this feature treats.

Two notes on the form, both load-bearing:

- `can_write_household` is called **bare, never `(select ...)`-wrapped** —
  migration 040's rule is that the initplan optimisation lives *inside* the
  helpers, and the wrapped form has never existed in this repo. Write-
  capability is the right predicate for reading money: the people who may set
  the terms are exactly the people who may see everyone's.
- The self-arm uses `(select auth.uid())`, 018's house form, where the
  sub-select *is* the optimisation — `auth.uid()` takes no per-row argument,
  so Postgres hoists it into one evaluation per scan.

**Why this isn't "tighten it later":** a client-exercisable write policy on
a money table would let a caller bypass every service-enforced rule — the
no-future-dating check, append-only, the membership assertion in §9 — using
nothing more than the anon key and her own JWT. The independent review's
motivating finding was concrete: a carer-self insert policy on `expenses`
would let a nanny insert a row with `status = 'approved'` and an arbitrary
`amount_minor` directly, self-approving her own money with no parent
involved. Select-only plus service-role writes is what makes every rule in
this doc *real* rather than advisory — RLS here is a backstop against a
compromised or misbehaving client, not a substitute for §9's checks.
Append-only tables enforce immutability the same way: not a trigger, but the
absence of any update/delete code path anywhere in the stack.

---

## 9. Every client-supplied foreign id gets a service-layer membership assertion

Inherited from `docs/DEFECT-LOG.md` D12–D14 — three real, previously-shipped
holes, all the same class: **an id accepted from the client and used without
checking it belongs to the caller.** Repositories run as the service role
and bypass RLS entirely, so on any write path the service layer is the
*only* gate — RLS is a backstop, not a check, per §8. Every unvalidated
client-supplied id on a write is a real hole, not a theoretical one.

Applied here: a `carer_id` on a pay-arrangement write must be asserted to be
an **active member with the `nanny` role of this specific household** before
the row is written — collapse "no such carer" and "not your carer" into one
error, so a caller learns nothing about carers who aren't hers. A
`time_off_id` on a PTO-marking write must be asserted to belong to a carer
who is an active member of the calling household. A `carer_id`/
`household_id` pair on an expense write gets the same treatment. Copy the
shape of `assertShiftBelongsToCarer` (D12's fix) rather than inventing a new
pattern — this is the one check every money write shares, and it belongs at
the top of the command service method.
