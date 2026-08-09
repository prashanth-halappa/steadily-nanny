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
`parseMajorToMinor(text)`. It also owns the single fallback-symbol map, via
`currencySymbol(code)` — the adornment an editable amount input renders beside
`minorToMajorText`'s value. A domain-local copy of that map used to live in
`domains/pay/utils/currencySymbol.ts`; it is gone, and a second one must not
come back. `parseMajorToMinor` works on the **string**, never
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

**Which currency is data; how it is FORMATTED is the device's preference.**
Two separate things, and they were both hardcoded to the UK until Aug 2026.
The currency code is a stored column (`pay_arrangements.currency`, §2), chosen
by the parent in `CurrencySelect` and merely *prefilled* from
`getDeviceCurrency()` — currency belongs to the employment arrangement, not to
whichever phone created it, so the prefill is never the final word. The
locale, meanwhile, is purely presentational (grouping, decimal separator,
symbol placement) and comes from `getDeviceLocale()`
(`apps/mobile/src/lib/deviceLocale.ts`), read once into `money.ts`'s
`DEVICE_LOCALE`. Both read `expo-localization`'s Language & Region SETTING,
which does not follow the user when they travel.

Known ceiling: `parseMajorToMinor` still accepts `.`-decimals only, so a
comma-decimal locale can display `1.234,56` but cannot have it typed back in.
Editable inputs seed from `minorToMajorText` (always `.`), so this only bites
someone hand-typing a comma. Build the locale-aware parser when a
comma-decimal market actually ships.

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

**A parent can also reopen a week deliberately, not just via D1's roll-up
path.** `POST /timesheets/:id/reopen` (`timesheetCommandService.reopen`,
parent/owner only, approved weeks only) is the same undo, triggered by a
person instead of a clock-out: it clears the snapshot exactly like D1's path
and requires a reason. That reason is recorded ONLY as an append-only
`shift_events` day-thread row (`event_type: 'timesheet_reopened'`) — never on
`timesheets.query_note`. `query_note` means one specific thing, "a parent
queried this week" (§ above), and `ParentWeekView` renders it as
"Queried: {{note}}" whenever status is 'queried' (a belt-and-braces status
gate — `buildInboxItems` already applies the same one when deciding whether
a week belongs in the nanny's inbox); writing a reopen reason into the same
column would relabel an undo-approve as an open dispute the next time anyone
reads the row. The two facts about a week are kept in two places on purpose, and no new
migration was needed to do it — the day-thread table already exists and
already carries a nullable `shift_id` for exactly this kind of week/day-level
(non-shift) event. A dedicated `reopen_reason` column on `timesheets` (wired
through the shared `TimesheetSchema` wire contract) would let the reason
surface in the UI the way `query_note` does today; nothing currently reads
the day-thread audit trail for this, so that surfacing is a real product
decision to make deliberately, not a gap to patch quietly — if you build it,
it needs a migration, not a second reuse of `query_note`.

**A frozen week refuses new money, rather than silently reopening.**
Approving an expense or mileage claim dated inside an already-`approved`
week is refused with a typed 409 (`ExpenseWeekLockedError`, reason
`EXPENSE_WEEK_LOCKED`) — Phase 3/4 review, finding 6. The reimbursement
section lives inside the frozen `earnings` snapshot, so a claim approved
after the freeze is money on a row that appears on no statement: owed,
invisible, and found months later. The alternative — reopening the week the
way new hours do — is deliberately rejected: the reopen path exists for
*facts about work that happened and must be recorded whatever it costs the
sign-off*, and a reimbursement is not wages at all (§6). Letting one
un-approve a payroll week both parties agreed would give a non-wage item
authority over the wage record. **Rejecting** a claim in a frozen week stays
allowed — it moves no money, so the parent is never left without an action.

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

**The unit of truth is the NETTED total per `(household, time_off)`, never
"the usage row"** (Phase 3/4 review, findings 1–3). What a household has paid
for one time off is `-sum(minutes)` over EVERY row it holds against that
`time_off_id` — the `usage` row and all of its `adjustment` corrections.
Three rules follow, and all three are load-bearing:

- **Marking paid is a TOTAL, and every write is a delta.** Re-submitting a
  different number of hours appends an `adjustment` for the difference
  (8h → 6h writes `+120`); re-submitting the same number writes nothing and
  succeeds; submitting `0` fully reverses. Nothing is ever updated or
  deleted, and no second `usage` row is written for a day already marked —
  the partial unique index (per `(household, time_off, day)` since migration
  045) stands, and the delta path is what makes a correction possible under
  it. This is the ONLY way to fix a mis-marked figure; do not add an update
  path.
- **A marking is one row PER COVERED DAY, and the days sum to the total
  exactly.** A multi-day time off used to record its whole total on the start
  date, so a fortnight marked 80h paid priced 80h in week one and nothing in
  week two — and approving week one froze it (§3). The days counted are every
  **calendar** day the time off covers, not the carer's scheduled days:
  holidays are booked months ahead of the materialisation horizon, so a
  schedule-based split would silently fall back to calendar days exactly when
  it matters, and `carer_time_off` is cross-household so the same marking
  would take a different shape per family. **Known limitation, stated not
  hidden:** a holiday spanning a weekend attributes minutes to days she would
  not have worked; the total, the balance and each week's sum stay exact, and
  a parent can correct the shape. Splitting is `allocateMinutes`, the one
  place minutes are divided — largest-remainder, so no minute is ever lost or
  invented.
- **Reversal is netted, so it is idempotent.** Cancelling a time off writes
  the reversal of what is *still outstanding*, so a retry (the reconcile is
  fire-and-forget, so retries are guaranteed) writes nothing and a
  part-corrected marking gets only the remainder. Do NOT add a partial unique
  index on `(household_id, time_off_id) where kind = 'adjustment'` to express
  this: it directly contradicts the delta rule above, which needs unlimited
  adjustment rows per pair.
- **The engine sees the netted minutes, not the usage rows.** The netting
  happens in `weekEarningsService.buildWeekEarningsInput`, not the engine —
  the engine takes priced facts, and `kind`/sign/`time_off_id` are ledger
  storage. Feeding it raw `usage` rows made a day that was marked paid,
  cancelled, and then actually worked price BOTH a `pto` and a `regular`
  line: double pay, frozen at approval. The netting is per `time_off_id` AND
  per date — a multi-day marking spans weeks, so collapsing a group onto one
  date would re-create the misattribution above.

**System-written `note` values are stable machine keys, never English**
(`PTO_LEDGER_NOTE_KEYS` in `pto.schema.ts`). `pto_ledger` is append-only and
permanent, so prose stored today can never be re-keyed: localising the ledger
history later would orphan every row already written. Wave 5's handoff chips
made exactly this mistake with English display labels in `handoff_notes.chips`
and the fix was stable snake_case keys — the same shape is used here, down to
the "render an unknown value verbatim" fallback. No parameters are stored,
because the row already carries them (the grant's year is its
`effective_date`; a correction's size is its own `minutes`). A note the
**parent typed** is user content and is stored verbatim — it is simply an
unknown key to the renderer.

**Only the household-local CURRENT year is lazily granted** (Phase 3/4
review, finding 4). Reading any other year — a nanny booking January makes
the client read next year — returns the balance but mints no `accrual` row.
A grant is frozen at today's entitlement and un-re-grantable, so minting
2027's grant in August 2026 writes a number that is wrong the moment the
terms change and correctable only by hand.

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

## 7. Guaranteed-hours top-up: weekly shortfall, unconditional

**Owner ruling, 2026-08-09:** the top-up pays out for **any** weekly
shortfall against `guaranteed_minutes_per_week` — unconditionally. An
under-guarantee week always shows a `guaranteed_topup` line for the **full**
shortfall, whether the gap came from a household closure, under-booking, or
nanny absence. The earlier closure-day-only gate (owner ruling 2026-08-04) was
removed as a product decision: families with a guaranteed-hours arrangement
expect the guarantee to mean what it says on the label.

The engine implements these definitions exactly, not an approximation:

- **Payable minutes** = worked + `cancellation_paid` + PTO usage. Guaranteed
  hours compare against payable minutes, so a week that already used paid
  PTO or a paid cancellation never *also* tops up on top of them — no
  double pay by construction.
- `guaranteed_topup = max(0, guaranteed_minutes_per_week − payable minutes)`
  — the full shortfall, never capped by closure-day lost minutes or any
  schedule-derived figure.
- **Closure days no longer gate the top-up.** Household closures may still
  affect what was worked or cancelled, but they do not limit how much of the
  shortfall is topped up.

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

**Expense claims are reimbursements, not wages — they do not require a pay
arrangement to exist** (owner decision, 2026-08-09). A non-mileage claim's
`currency` is whatever the carer submitted (schema default `GBP`); when an
arrangement *does* exist, its currency must still match. **Mileage is the
exception:** the per-mile rate lives on the arrangement, so a mileage claim
(and approving one) still refuses with `NO_PAY_ARRANGEMENT` when none is
effective on `local_date`.

## 10. Removal is soft, and rejoining resumes the old money state

Removing a member (`householdCommandService.removeMember`, `PATCH
/households/:householdId/members/:memberId` with `status: 'removed'`) flips
`household_members.status` to `removed` and touches nothing else. The row is
never deleted — `time_entries` and `shifts` reference it, and their history
has to survive the person leaving.

Rejoining is redeem-only: a removed member who redeems a fresh invite has
their existing row flipped back to `active`
(`householdMemberRepository.reactivateMembership`), because the unique
`(household_id, user_id)` constraint makes a second row impossible. **The
same row coming back is what makes this a money question:**

- **The pay arrangement is not end-dated on removal, and not re-derived on
  rejoin.** Arrangements are effective-dated and append-only per
  `(household, carer)` (§2), so the one that was live when the carer left is
  still the one that resolves after they return — at the old rate, with no
  gap recorded. Nobody is prompted to write a new row.
- **The PTO balance is not reset or re-derived.** It is a household-side
  ledger (§5), so accrual and usage from the previous stint carry straight
  over into the new one.
- **A rejoin can change role silently.** Invite redemption is the ONLY path
  that mutates a membership's role — the member PATCH rejects everything but
  `status: 'removed'` — so re-inviting a former nanny on a `parent` invite
  reactivates them as a parent, and `can_edit` resets to `false` regardless
  of what they held before.

None of this is a decision that has been made; it is what the code does
today because reactivation reuses the row. Whether a rejoin should end-date
the arrangement, snapshot or reset the PTO balance, or refuse a role change
is an **open owner decision** — see `audit/RESIDUAL-RISK.md`. Do not add
money-side behaviour to the rejoin path before that lands.

## 11. The settlement ledger: payments are facts, never a second source of truth

`payments` (`supabase/migrations/067_payments.sql`,
`packages/shared-types/src/schemas/payment.schema.ts`) records that a week's
wages **actually moved**, outside the app — bank transfer, cash, whatever a
family actually does. It is the other half of the loop §3 describes: §3
freezes what a week was *worth*; this table records that it was *paid*. A
payment row is evidence of a real-world event, not a computed or editable
figure, so — same discipline as `pay_arrangements` (§2) and `pto_ledger`
(§5) — **it is append-only**: no update, no delete, anywhere in the stack.
Recording the wrong amount cannot be fixed by editing the row, only by
recording a correcting fact (there is currently no correction path at all;
an over-recorded payment stands until a human notices).

**The ceiling is enforced by refusal, not by clamping.**
`apps/api/src/domains/pay/services/paymentCommandService.ts` is the only
place `sum(payments) <= gross_minor` is checked — a cross-row `SUM` can't be
a row `CHECK`, and 067 has no insert policy at all (§8), so the service is
the entire constraint. Gate 4 there computes `alreadyPaidMinor + amountMinor`
and, if it would exceed the week's frozen `gross_minor`, throws
`PaymentExceedsGrossError` rather than trimming the amount to what's left —
a trimmed payment would be a record of money that did not move, which is a
worse lie than a rejected request. **The service's own header documents a
known, un-closed race on this gate**, in its own words: the check is
read-then-write, so two simultaneous first payments could each see `sum = 0`
and both commit, together exceeding the gross; sequential retries never hit
it (the first row is visible by the second write), so the window is two
parents tapping "Record payment" on the same week in the same instant.
Closing it needs a 051-style database function that sums and inserts in one
statement — a wider pre-check in the service cannot close a race that lives
between two reads and two writes.

**Currency is stamped from the frozen week, never client-chosen.**
`CreatePaymentSchema` carries no `currency` field at all — the command
service copies `currency` off the timesheet's own frozen snapshot (the same
`gross_minor`/`currency` pair §3 freezes at approval), so a payment can never
be recorded in a currency the week wasn't priced in. This is the same
"minor-units-plus-sibling-currency, never packed, never guessed" discipline
as §1, applied at the point where a client could otherwise have supplied one.

**`paid_at` is a calendar date, not an instant.** It's the day the parent
says the money moved — `z.iso.date()` on the wire, no timezone to get wrong,
the same shape as a `local_date` elsewhere in this codebase rather than a
`timestamptz`. There is no "when during the day" to record because nothing
about payroll needs it.

**The CSV export serialises only the FROZEN snapshot, in integer minor
units, and refuses anything that isn't one.**
`apps/api/src/domains/timesheet/utils/weekExportCsv.ts` is the payroll
handoff artifact — the file a parent hands to HomePay/Nannytax/an
accountant — and its column contract states plainly: "EVERY AMOUNT IS AN
INTEGER IN MINOR UNITS. Never a major-unit float, never a currency symbol,
never a thousands separator" — formatting money server-side is exactly how
rounding errors get into a payslip, so the export never does it.
`timesheetQueryService.exportWeekCsv` is **stricter than the screen**: a week
that isn't `TIMESHEET_STATUSES.APPROVED`, or whose earnings state isn't
`WEEK_EARNINGS_STATES.OK` (a legacy pre-042 approval, an unreadable snapshot,
a departed-carer week, anything the screen would degrade to "hours only"),
is refused outright with `TimesheetNotExportableError` (409) rather than
exported with a caveat — a screen can show an honest "Estimated" or
"hours-only" state next to a figure, but a downloaded file has no such label
once it leaves the app and is filed against. Nothing is recomputed on the
way out: the status check happens *before* the earnings are read, so the
only branch reachable from there is the frozen-snapshot one.

**`balance_due_minor` is a plain subtraction, deliberately never clamped at
zero.** It is `total_gross_minor - paid_to_date_minor` in the export, and an
over-payment (recorded in error, or against a week whose gross later reads
differently through some future correction path) must render as a
**negative** balance, not silently disappear — the same "no is honest, zero
often lies" instinct as §4's no-arrangement rule.

**The export's `paid_to_date_minor` read gate is deliberately the WEEK read's
gate, not the payments-list gate — read the one-line reason at its call
site rather than assuming a bug.**
`paymentQueryService`'s own gate (used by `GET
/timesheets/:timesheetId/payments`) is narrower than the week read: only
active owners/parents plus the week's own carer, denying a second nanny and
any helper — because one nanny must never see another's money. The export,
by contrast, calls `getReadableTimesheet` — byte-identical to the plain week
read's gate, which is "any active member of the household." That's not an
oversight; `timesheetQueryService.exportWeekCsv`'s doc comment states the
reasoning directly: *"this discloses a settlement total to any active member
the week read already shows the frozen gross to — a wider audience than
`paymentQueryService`'s own gate... That is deliberate and bounded: the
export is the same artifact as the week read, in a different container, and
giving it a second, narrower gate would mean a carer or parent could see a
figure on screen that her own download silently omits."* In short: the export
must never hide a number the corresponding screen already shows, even though
that makes its read gate wider than the dedicated payments-list endpoint's.
