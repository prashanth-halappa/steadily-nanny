# TIER0-CX-SPEC.md

Customer experience specification for the Tier 0 money primitives
(`TIER0-PLAN.md` Phases 1–4). Written 2026-08-04, to be handed to
implementation agents alongside the plan.

**Binding inputs:** `TIER0-PLAN.md` §"Design decisions locked" (integer minor
units, append-only effective-dated arrangements, compute-live/freeze-at-approval,
no-arrangement-never-zero, PTO as a household-side ledger, reimbursements are
not wages), `AGENCY-ROADMAP.md` §1–2, `docs/07-MOBILE-UI-SYSTEM.md`,
`apps/mobile/lib/design-tokens/*`, and the judgements already settled in
`docs/DAYLIGHT-UX-AUDIT.md`.

---

## 0. Design position (read this before the screens)

**Hours are the record; money is derived from it.** Everything in this spec
follows from that. The hours total keeps its `H1` on the Hours screen
(`WeekTotal.tsx:112`, per audit finding #10 — the number is the content); gross
pay renders directly beneath it at `typography.h3`, subordinate in size and
unambiguous in meaning. Inverting that — a giant money figure over small hours —
would make the app read as a payroll calculator whose inputs you cannot audit,
which is the opposite of "an honest record of what happened".

Three rules apply to every surface below and are not restated each time:

1. **Every amount is labelled with its state.** `Estimated` while the week is
   open/submitted/queried, `Approved` once frozen. A figure with no state label
   is a defect.
2. **No arrangement → no numbers.** Never `£0.00`. Render the nudge (§4.4).
3. **No new colour semantics.** Money uses `foreground` / `mutedForeground`;
   status uses `StatusPill` (`src/components/ui/status-pill.tsx`). Apricot stays
   on the live clock only.

---

## 1. Shared primitives to build once

| Thing | File | Spec |
|---|---|---|
| Money formatting | `apps/mobile/src/lib/money.ts` (new) | `formatMoney(minor: number, currency: string): string` → `Intl.NumberFormat('en-GB', { style: 'currency', currency })`. Explicit fallback symbol map for `GBP £`, `EUR €`, `USD $` when `Intl` returns the bare code (Hermes ICU variance) — unit-tested. `formatRate(minor, currency)` → `£18.50/hr`. `parseMajorToMinor(text)` → integer, rejecting >2 decimals; property-tested at `0`, `1p`, `£999,999.99` per the plan. Never `Math.round(x * 100)` on a float without the string path. |
| Money line | `apps/mobile/src/domains/timesheet/components/WeekEarningsLine.tsx` (new) | Label `typography.metadataLabel` (13/18/500) `text-muted-foreground`; amount `typography.h3` (20/28/600) `tabular`; chevron `lucide-react-native` `ChevronRight` 18px when tappable. Whole line one `AnimatedPressable`, `minHeight: spacing.minTouchTarget`. |
| Amount row | `apps/mobile/src/domains/pay/components/AmountRow.tsx` (new) | `flex-row items-baseline justify-between`, label `Body`, amount `Body` `font-medium` `tabular`. Optional second line `Small text-muted-foreground` for the derivation ("12h 30m at £18.50"). **No hairline divider** — Daylight separates by light. A subtotal/total row instead gets `rounded-cell bg-muted px-4 py-3`. |
| i18n | `apps/mobile/src/i18n/locales/{en,es}/pay.json` (new), registered in `src/i18n/index.ts` alongside `timeOff` | Every string below lands in `en` **and** `es` in the same wave. |
| Query keys | `apps/mobile/src/api/queryKeys.ts` | New `pay:` block (`current`, `history`, `ptoBalance`, `ptoLedger`) and `expenses:` block (`week`, `pending`). |

Sheets: **`BottomSheetBase`** (`src/components/custom/BottomSheetBase.tsx`),
never a bare `<Modal>` (GOLDEN-FIXES #1). Confirmations that must block:
`AlertDialog`, as `ManageHouseholdScreen.tsx:406` already does.

---

## 2. Surface A — Pay arrangement (parent)

### Navigation

- New row in `apps/mobile/src/app/(private)/(tabs)/settings.tsx`, parent branch
  of `settings-household-section` (after `settings-manage-household`, before
  `settings-view-availability`): `testID="settings-pay"`, label **"Pay & terms"**.
- Route `apps/mobile/src/app/(private)/settings/pay/index.tsx` → `/settings/pay`.
  Thin route → `domains/pay/components/PayArrangementScreen.tsx`.
- Route `apps/mobile/src/app/(private)/settings/pay/[carerId].tsx` →
  `/settings/pay/{carerId}` for the second-nanny case.
- `/settings/pay` resolves carers from `useHouseholdMembers`, filtering
  `role === 'nanny' && status === 'active'` — write this filter fresh; do
  **not** copy `carer-availability.tsx:25`, which takes the *first* nanny-or-
  helper match with no status check (review finding 15). **One carer → render her terms inline**, no intermediate list.
  **Two or more → a picker list**, each a `rounded-row bg-card` +
  `elevation.row` row (copy the `SettingsNavRow` shape at `settings.tsx:50-83`)
  showing name and `$18.50/hr` right-aligned `tabular`, pushing to
  `/settings/pay/{carerId}`.
- Role gate: `useIsOnboarded().role` via `isParentEditorRole`, with the
  `manage-household-not-available` empty-state pattern
  (`ManageHouseholdScreen.tsx:166-195`) for a deep-linked nanny.

### Layout — `PayArrangementScreen`

`ScrollView`, `SCREEN_CONTENT_STYLE` (22px gutters), back affordance + `H1`
"Pay & terms", `Small` muted subtitle. Then, in order:

**1. Current terms card** (`Card` + `CardContent`, no border, `elevation.card`):

- Line 1: `metadataLabel` muted — "In effect since 1 Apr 2026".
- Line 2: `typography.display`-adjacent is wrong here; use `H1` `tabular` for
  the rate — **"$18.50"** — with `Body` muted `"/hr"` on the same baseline row
  (`flex-row items-baseline gap-1`).
- Then `AmountRow`s for the term inventory (`screens-pay-terms.md` §3 has the
  current, much longer list — overtime tiers, guarantee, PTO, cancellations,
  mileage, holidays, pay schedule, and the in-writing fields; this is no
  longer a fixed six), `gap-3`, for example:
  - "Overtime" → "After 40h, at 1.5×" | when null → "Not set"
  - "Guaranteed hours" → "40h a week" | "Not set"
  - "Paid time off" → "140h a year" | "Not set"
  - "Cancellations" → "Paid if within 24h of the start" | when null →
    **"No cancellation pay"** (an explicit agreement, not a missing one —
    never "Not set" here)
  - "Mileage" → "$0.45 a mile" | "Not set"
  - "PTO balance" (Phase 3) → "96h left this year" + `Small` muted "1 Jan – 31 Dec 2026"
- Footer: `Button` "Change terms" (default variant, full width).

"Not set" is the correct copy for a null term on this card. It is a statement
of the agreement, not a nag; do not render "$0.00" or "0h". (The proposal
document on the other three surfaces omits an unset row entirely rather than
printing "Not set" — AMENDED 2026-08-16, `screens-onboarding-terms-proposal.md`
§6.2 — but this card, `PayTermsGroups.tsx`, is deliberately not part of that
amendment.)

*(`valid_from` may be in the future, up to a 12-month horizon (D-16,
`screens-pay-terms.md` §6) — this superseded the original 2026-08-04
no-future-dating ruling. A future row is invisible to pricing until its date
arrives, and the card above gains a "Scheduled" card while one is pending;
the current-terms card otherwise stays the whole truth for today. "Terms are
never edited or removed — a change is a new record." stays as `Small` muted
copy above the History heading.)*

**2. History** — `H4` "History", then newest-first rows, `rounded-row bg-card
px-4 py-3` + `elevation.row`, `gap-2`:

- `Body font-medium tabular` — "$18.50/hr"
- `Small` muted — "From 1 Apr 2026 · set by Priya on 28 Mar"
- `Small` muted — the `note`, when present.

### Change flow — `PayChangeSheet` (`BottomSheetBase`, `sheetId="pay-change"`, `fitContent`)

Fields, `gap-4`, each `Label` + control:

1. **Hourly rate** — `Input`, `keyboardType="decimal-pad"`, currency symbol as a
   fixed leading adornment, normalised on blur ("18.5" → "18.50").
2. **Takes effect from** — this is the load-bearing control. Chips
   (`rounded-chip`, the selected treatment at `settings.tsx:238-247`):
   **"Today (4 Aug)"** (default), **"An earlier date"**, and **"A future
   date"**. The date field accepts any date, past or future, up to a 12-month
   future horizon (D-16, `screens-pay-terms.md` §6) — the service enforces the
   same bound. Backdating hint, `Small` muted, only when a past date is
   chosen and the affected week is already approved: **"Weeks that are already
   approved keep their approved totals."** A future date instead produces the
   "Scheduled" card described above.
3. **Overtime** — "Overtime after" (hours, numeric) + "Paid at" (multiplier,
   numeric, suffix "×"). Empty = no overtime; hint `Small` muted: **"Leave blank
   if there's no overtime rate."**
4. **Guaranteed hours a week**, **Paid time off a year (hours)**, **Mileage
   rate a mile** — live inputs from Phase 1; every value is stored on the
   arrangement now. Their downstream effects arrive later, and the hint says
   what the value *does*, not when: PTO → `Small` muted **"Granted each
   calendar year."**; Mileage → **"Used to price mileage on expenses."**
5. **Cancellations** — two chips: **"Paid if cancelled within…"** (reveals an
   hours input, numeric, default = the household's current
   `cancellation_paid_within_hours`) and **"No cancellation pay"**. A
   household window of **`0` pre-selects the "No cancellation pay" chip**
   (review finding 10 — the household column allows 0 = no pay; the
   arrangement models that as null, never 0). One chip is always selected —
   this term has no blank state; the setup flow (below) forces the choice
   once, kindly.
6. **Note (optional)** — `Textarea`, placeholder "e.g. Annual review".

**Mid-week consequence line.** Whenever the chosen date is not a Monday, render
directly under the date control, `Small`, `text-warning-strong`, no icon:

> **"This week will be paid at two rates: $18.50 up to Wednesday 3 September,
> then $19.50 from Thursday 4 September."**

Confirm button: **"Set new terms"**. On success dismiss + `showSuccessToast`
**"New terms saved"**. On failure the sheet stays open with the typed values
(the `ClockOutSheet` discipline, `NannyWeekView.tsx:92-96`).

### First-time setup — "Set up pay for {name}" (owner decision 7)

The same field set as the change sheet, presented once as a setup form rather
than a "change". Differences from the change sheet:

- **Full screen, not a sheet** — seven fields with a keyboard is past
  `fitContent` territory. Route `/settings/pay/setup/[carerId]`, same thin-route
  → `domains/pay/components/PaySetupScreen.tsx` shape as every other screen.
- Title `H1` **"Set up pay for Priya"**; subtitle `Small` muted **"What you've
  agreed. Priya can see her own terms, and Steadily can total each week for
  both of you."**
- Effective date defaults to **the day she joined the household** when that is
  in the past (so already-worked weeks price), else today. The field itself
  accepts a future date too, same as the change sheet (D-16).
- The cancellation chips default from the household's current window, but the
  form requires an explicit selection before save — this is the one term where
  silence breeds the dispute.
- Confirm: **"Save pay terms"**. Success → back + `showSuccessToast`
  **"Pay terms saved"**.

**Entry points:**

1. **Prompt card** on Manage household (`ManageHouseholdScreen`), shown to
   parents while any active nanny has no arrangement: `Card` + `elevation.card`,
   `Body font-medium` **"Finish setting up Priya"**, `Small` muted **"Add her
   pay terms so weeks can be totalled."**, `Button` **"Set up pay"** →
   the setup screen. One card per such nanny; disappears on save. No badge, no
   red — it's an invitation, not an error.
2. Every no-arrangement empty state in this spec (§2 States, §4.4 parent arm)
   routes its CTA here rather than to the change sheet.

**Manage household note (T14, supersedes review finding 10):** the arrangement's
`cancellation_paid_within_hours` is now the **only** cancellation window —
there is no household-level fallback. The duplicate household-level column is
removed from `ManageHouseholdScreen` entirely rather than kept as a fallback
control; a household with shifts but no arrangement pays nothing on a
cancellation (`screens-pay-terms.md` §4.1.1).

### States

| State | Treatment |
|---|---|
| Loading | `LoadingIndicator testID="pay-loading"` |
| Error | `ErrorState variant="network"` with `onRetry` (`src/components/custom/ErrorState.tsx`) |
| No arrangement yet | `EmptyState variant="inline"`, title **"No pay terms set yet"**, description **"Set an hourly rate and Steadily can total the week for both of you."**, action **"Set pay terms"** |
| No carer in household | `EmptyState`, title **"No nanny yet"**, description **"Invite your nanny, then set her pay terms here."**, action **"Invite"** → `/settings/invite` |
| Saving | Confirm button `disabled`, `LoadingButton` |

---

## 3. Surface B — "My pay" (nanny, read-only)

### Navigation

- Row in `settings.tsx`, nanny/helper branch, above "Time off":
  `testID="settings-my-pay"`, label **"My pay"**.
- Route `apps/mobile/src/app/(private)/settings/my-pay.tsx` →
  `domains/pay/components/MyPayScreen.tsx`.

### Layout

`H1` "My pay". Subtitle `Small` muted: **"What each family has agreed with you.
Only that family can see their own terms."** — this sentence is the anonymity
promise, stated once, where it reassures.

Then **one card per household she belongs to** (`useHouseholds`), each:

- `Body font-medium` — the household name (this family *is* nameable to her;
  the promise runs the other way).
- `H1 tabular` "£18.50" + `/hr`.
- The same six `AmountRow`s as §2, read-only.
- `metadataLabel` muted — "In effect since 1 Apr 2026".
- `Button variant="ghost"` **"See history"** → expands the history list inline
  (same row shape as §2, minus the actor's name — she does not need to know
  which parent typed it; keep "From 1 Apr 2026" and the note).

**Tone.** No "ask for a raise" affordance, no comparison to other families, no
market-rate commentary. The screen's job is that she never has to ask what was
agreed. Empty state, per family: title **"No pay terms yet"**, description
**"This family hasn't set your rate in Steadily yet. Your hours are still being
recorded."** — no CTA, no chasing copy.

Cross-family surfaces (§5) show **"1 family"**, never a name — from a
parent's view. A nanny-only cross-family surface is a documented exception;
see §5.2's scope carve-out.

---

## 4. Surface C — Earnings on the Hours screen

Both role views already compose `WeekTotal` in `ListHeaderComponent`
(`ParentWeekView.tsx:202`, `NannyWeekView.tsx:145`). Money is added there, not
on a new screen.

### 4.1 The money line

`WeekTotal.tsx` gains props `earnings: WeekEarnings | null` and
`isFrozen: boolean`, rendered as `WeekEarningsLine` immediately below the
existing `hours-total` row and above `payBoundary`:

```
Estimated gross                      £236.12  ›
```

- Label 13px `metadataLabel` `text-muted-foreground`: **"Estimated gross"**
  (open / submitted / queried) or **"Approved gross"** (approved).
- Amount `typography.h3` 20/28/600, `tabular`, `text-foreground`.
- The card owns the spacing: `CardContent` keeps `gap-1`; the money line adds
  `marginTop: 4`. No extra card, no divider.
- **`payBoundary` copy changes.** The current string
  (`hours.json:34`, "Hours only — pay is settled outside the app.") is now
  false in the first clause. Replace with:
  **"Steadily totals the pay; the payment itself happens outside the app."**

### 4.2 The breakdown sheet

Tap anywhere on the money line → `EarningsBreakdownSheet`
(`domains/timesheet/components/EarningsBreakdownSheet.tsx`, `BottomSheetBase`,
`sheetId="hours-earnings-breakdown"`, `fitContent`, `showCloseButton`).

Contents, `px-6 pb-4 gap-4`:

- `H4` — **"How this week adds up"**
- `Small` muted — "3 – 9 August · Estimated" *or* "…· Approved 10 August".
- `AmountRow` per line item, in this fixed order, omitting empty ones:

| Line | Label | Sub-line |
|---|---|---|
| regular | "Hours worked" | "38h 00m at £18.50" |
| regular (split) | "Hours worked" ×2 rows | "12h 00m at £18.50 (to Wed 3 Sep)" / "26h 00m at £19.50 (from Thu 4 Sep)" |
| overtime | "Overtime pay" | "3h 00m at £27.75 (1.5×)" |
| cancellation_paid | "Cancelled with short notice" | "4h 00m at £18.50 · paid under your cancellation policy" |
<!-- manual_adjustment is NOT an earnings line: the engine folds it into
     worked minutes (a clock-span correction of worked time), so a separate
     priced row would double-count it. Adjustments are visible in the hours
     record itself. (Amended after the engine implementation caught the
     double-count.) -->
| pto | "Paid time off" | "8h 00m at £18.50" |
| guaranteed_topup | "Guaranteed hours top-up" | "4h 00m to reach the agreed 40h" |

- Total row: `rounded-cell bg-muted px-4 py-3`, label `H4` **"Gross pay"**,
  amount `H4 tabular`.
- **Two "overtime"s must not coexist** (review finding 12): `WeekTotal`
  already renders an `overtimeLabel` — the worked-vs-scheduled *delta* — on
  the same card the money line joins. Once paid overtime exists, that delta
  must stop using the word: retitle its copy to the **"vs scheduled"** form
  (e.g. "2h over scheduled") so "Overtime pay" is the only "overtime" on the
  screen.
- When reimbursements exist: below the total, `Small` muted
  **"Expenses are listed separately and are not part of gross pay."**
- Footer `Small` muted, always: **"Based on the hours recorded in Steadily.
  Tax and deductions are handled by your payroll."**

### 4.3 Approve, and what freezes

Replace the direct-approve at `ParentWeekView.tsx:238-245` with an
`AlertDialog` (`ApproveWeekDialog`):

- Title: **"Approve 3 – 9 August?"**
- Body: **"You're approving 41h 00m and £236.12 gross for Amara. Approving locks
  both figures — if hours change later, the week reopens and the total is
  worked out again."**
- Amount echoed in the body as text, `tabular`, not as a hero number: this is a
  confirmation, not a receipt.
- Cancel: **"Not yet"** · Action: **"Approve the week"**.
- No-arrangement variant of the body: **"You're approving 41h 00m for Amara. No
  pay rate is set, so Steadily can't total the pay for this week."**
- Toast unchanged (`hours.json:14`).

After approval: the label flips to "Approved gross"; the figure comes from the
frozen snapshot; the breakdown sheet header reads "Approved 10 August". If the
D1 reopen path fires (new hours land in an approved week), the snapshot is
nulled server-side and the line reverts to "Estimated gross" — the client needs
no special case, but the reopen **must not** leave a frozen figure on screen;
add that to the wiring test.

### 4.4 No arrangement (never £0.00)

Where the money line would be, render instead:

- **Parent:** `Small` `text-muted-foreground` **"No pay rate set — Steadily
  can't total this week."** + `Button variant="ghost"` sized to 44pt,
  **"Set a pay rate"** → `router.push('/settings/pay')`.
- **Nanny:** `Small` `text-muted-foreground` **"Your family hasn't set a pay
  rate in Steadily yet, so there's no total here. Your hours are still
  recorded."** No button. She cannot fix it, so do not give her a control that
  implies she can.

Same treatment for the typed `no_arrangement` result on a past week.

### 4.5 States

| State | Treatment |
|---|---|
| Loading | Existing `LoadingIndicator`. **Do not** render a `£0.00` placeholder or a shimmer shaped like money — a skeleton number is indistinguishable from a real one at a glance. Omit the line until data arrives. |
| Earnings error (hours OK) | Money line renders `Small` muted **"Couldn't work out the total just now."** + ghost **"Try again"**. Hours must still render; a money failure never blanks the record. |
| Queried week | Money line label becomes **"Estimated gross"** with a second `Small` muted line **"Queried — the total may change."** Approve stays disabled per `isActionable` (`ParentWeekView.tsx:153`). |
| Zero hours | Hours show `0m` + existing `emptyWeek`. Money line omitted entirely (not `£0.00`), because nothing has happened yet. Exception: if a `guaranteed_topup` line exists, the money line renders and the breakdown explains why a zero-hours week still pays. |

---

## 5. Surface D — Paid time off

### 5.1 Parent: mark time off paid

Entry: `apps/mobile/src/app/(private)/settings/household-time-off.tsx`. Today
each row is a static `View` (`:50-65`) printing a raw `row.status`. Change to:

- Row becomes `AnimatedPressable`, `minHeight: spacing.minTouchTarget`,
  `rounded-row bg-card` + `elevation.row`.
- Line 1 `Body font-medium` — the existing formatted range.
- Line 2 — `StatusPill`: `variant="confirmed"` **"8h paid"** when a usage row
  exists, `variant="pending"` **"Not marked paid"** when not. (Deletes the raw
  status string, which was an audit-class defect.)
- Line 3 `Small` muted — the message, unchanged.

Tapping opens `MarkTimeOffPaidSheet` (`BottomSheetBase`,
`sheetId="pto-mark-paid"`, `fitContent`):

- `H4` **"Pay this time off?"**
- `Body` muted — "Amara, Mon 24 – Wed 26 August".
- **Hours to pay** — `Input`, `keyboardType="number-pad"`, pre-filled with the
  computed working overlap, hint `Small` muted **"Suggested from her usual
  hours that week. Change it if you agreed something else."**
- Before/after block, `rounded-cell bg-muted px-4 py-3`, `tabular`:
  **"Balance 96h now → 72h after"**
- Over-balance case: the after figure renders `text-warning-strong` and a
  `Small` line reads **"This is more than her remaining balance. You can still
  pay it — the balance will show as −8h."** (Warn, never block: the same
  judgement the availability clash already makes.)
- Confirm: **"Mark as paid"** · toast **"Marked as paid"**.
- Already-marked: the sheet opens read-only with `Body` **"Marked as paid on 26
  August — 8h."** and, since the ledger is append-only, a ghost **"Adjust"**
  that adds an adjustment row rather than editing (copy: **"Corrections are
  added as a new line, so the history stays true."**).

Balance also appears as the "PTO balance" `AmountRow` on §2's terms card.

### 5.2 Nanny: paid markers, anonymised

Two different surfaces, two different rules:

- **`/settings/my-pay` (household in scope)** — per-family balance card:
  `AmountRow` "Paid time off" → "96h left of 140h" + `Small` muted "1 Jan – 31
  Dec 2026".
- **`/settings/time-off` (person-scoped; `carer_time_off` has no household —
  `011_availability.sql`)** — `TimeOffRow.tsx` gains one `Small` line under the
  existing `StatusPill`:
  - none → **"Not marked paid"**
  - one → **"Paid by 1 family"**
  - many → **"Paid by 2 families"**
  - Never a household name, never a per-family amount, on this screen. This
    surface gets a LEAKCANARY-style test asserting no household name or id
    reaches it (plan, Phase 3 mobile).

**Scope carve-out (2026-08, user ruling).** The "never a name" promise above
protects the OTHER household **from a parent** — a family must never learn
another family's identity through Steadily. It does not protect a household's
name from the nanny herself: she already knows every family she works for by
name, offline, before she ever opens the app. A genuinely nanny-only
cross-family surface (gated so no parent role can ever reach it — see
`ScheduleShiftsScreen.tsx`'s `showCrossFamily`, which independently checks
`role === 'nanny'` even though the calendar-view switcher already hides the
option from a parent) may show real household names for exactly this reason.
`CrossFamilyRhythmView.tsx` (Schedule tab, calendar view 2d — a nanny's
two-week rhythm across her households) is the first surface built this way;
`/settings/my-pay` and `/settings/time-off` above are unchanged by this
carve-out and keep anonymising. Before naming households on any FUTURE
cross-family surface, confirm it is actually nanny-only end to end — a role
check on the surface's own render gate, not just on the tab/switcher that
offers it.

Empty/loading: balance omitted while loading (no `0h` placeholder); when the
arrangement has no `pto_entitlement_minutes_per_year`, the row reads
**"Not set"** and no balance is computed.

---

## 6. Surface E — Expenses & mileage

### 6.1 Nanny: add

Entry: a `Button variant="outline"` in `NannyWeekView`'s `ListFooterComponent`
(the view currently has none), label **"Add an expense"**, `testID="expenses-add"`.

`ExpenseAddSheet` (`domains/pay/components/ExpenseAddSheet.tsx`,
`BottomSheetBase`, `sheetId="expense-add"`, `fitContent`):

1. Kind toggle — two chips, `rounded-chip`, 44pt: **"Expense"** / **"Mileage"**.
2. **Date** — defaults to today; `HH:MM`-style typed control is not needed here,
   a date row consistent with `TimeOffDateRangePicker` is.
3. **What was it for** — `Input`, placeholder "e.g. Soft play tickets" /
   "e.g. Nursery run".
4. **Amount** (expense) — `decimal-pad`, currency adornment. **Miles**
   (mileage) — `decimal-pad`, suffix "miles", plus `Small` muted
   **"Worked out at £0.45 a mile when your family approves it."**; when no
   mileage rate is set: **"Your family hasn't set a mileage rate yet. You can
   still log the miles."**
5. Submit **"Send for approval"** · toast **"Sent to your family"**.

List: an `ExpenseRow` per item in the same week, in a footer card titled
**"Expenses"**, each row `Body` description + `Body tabular` amount (or
"12.4 miles" while pending with no rate) + `StatusPill`:
`pending` → **"Awaiting review"**, `confirmed` → **"Approved"**,
`declined` → **"Not approved"**. A declined row shows the parent's note beneath,
`Small text-muted-foreground`: **"Not approved: already paid in cash."** Rejected
rows stay visible — the record does not delete disagreements.

### 6.2 Parent: review

In `ParentWeekView`'s `ListFooterComponent`, above the approve actions, when
pending expenses exist for the week: a `rounded-row bg-card` + `elevation.row`
pressable, **"2 expenses to review · £34.80"**, `tabular`, chevron.

`ExpenseReviewSheet` (`BottomSheetBase`, `sheetId="expense-review"`): one card
per pending item — date, description, amount or "12.4 miles → £5.58", and two
buttons: **"Approve"** (default) and **"Not this one"** (`variant="ghost"`,
`text-destructive`), the latter revealing an optional `Textarea` **"Tell her
why (optional)"** before **"Send"**. Approving freezes the mileage amount
server-side; the sheet's figure must be the frozen one on refetch.

No-mileage-rate + approve → typed error; show `Small` `errorInline` treatment:
**"Set a mileage rate before approving mileage."** + ghost **"Set a rate"** →
`/settings/pay`.

### 6.3 On the statement

Reimbursements render in a **separate card**, after the day rows, before the
actions, in both roles:

- `H4` **"Reimbursements"**
- `AmountRow` per approved item.
- Subtotal row `rounded-cell bg-muted`: **"Total to reimburse"** — `£34.80`.
- `Small` muted, mandatory: **"Paid back in full — not wages, and not part of
  gross pay."**

Empty (no expenses this week): the card is not rendered at all.

---

## 7. Surface F — The weekly statement as a whole

Fixed order in both role views. This is the hierarchy contract:

1. **`WeekTotal` card** — week nav · carer name (parent) · `StatusPill` ·
   **hours `H1`** · **money line `H3`** · state caption · boundary line.
2. **Day rows** (`TimeEntryDayRow`, unchanged) — the evidence for line 1.
3. **Reimbursements card** — only when non-empty (§6.3).
4. **PTO note** — only when a `pto` line exists: `Small` muted
   **"Includes 8h of paid time off."**
5. **Query note** (parent, existing `hours-query-note`).
6. **Actions** — parent: Approve / Query. Nanny: "Add an expense".

Reading top to bottom the parent gets: *what week · what state · how many hours
· what that comes to · which days · what else is owed · what to do.* Money never
appears above the hours it derives from, and the reimbursement subtotal never
appears in the same visual block as gross.

---

## 8. Edge cases

| Case | Required behaviour |
|---|---|
| **Mid-week rate change** | Breakdown splits `regular` into two rows, each with its date span and rate (§4.2). The money line shows one total. The change sheet warned about this at authoring time (§2). Never average the two rates. |
| **Overtime and top-up in one week** | Legitimately coexist under the closure-only rule (overtime Mon–Thu, closure Friday): render both rows; the top-up sub-line carries the closure attribution. |
| **Guaranteed top-up in a zero-hours closure week** | Money line renders even with `0m` hours; breakdown's only line is "Guaranteed hours top-up — 40h 00m to reach the agreed 40h", sub-line "Your family was away this week." (Owner ruling: the top-up exists *only* for closure-day shortfalls, and only up to the scheduled hours those closure days lost.) |
| **Currency** | One currency per week, asserted server-side. If a week spans a currency change the API returns the error arm: money line reads **"This week spans a currency change — ask your family to check the terms."**, no number. Symbols always via `formatMoney`, never a hardcoded `£`. |
| **Queried timesheet** | §4.5. Estimated, caption "Queried — the total may change", approve disabled with the existing `waitingAfterQuery` sentence. |
| **Approved week that reopens** | Label reverts to "Estimated gross". Add `Small` muted **"Hours changed after approval, so this week is being worked out again."** |
| **Rejected expense** | Row stays, `declined` pill, reason shown, excluded from the reimbursement subtotal, not re-submittable — she adds a new one. |
| **Helper role** | Sees the parent statement read-only (`readOnly` at `ParentWeekView.tsx:68`), including gross. No approve, no expense review, no access to `/settings/pay`. |
| **Nanny with two families** | Hours/earnings are per active household (`useActiveHousehold`) and already switch with `HouseholdSwitcher`. Cross-family surfaces stay anonymised (§5.2). |
| **Deleted carer account** | `carer_id` goes null (migration 033 discipline); history rows fall back to `carer_display_name` (a snapshot column on every money table). Pay history must still render. |
| **Departed/deleted carer's unapproved week** | Renders hours-only with `Small` muted **"{Name} is no longer in this household, so this week can't be totalled."** — never the set-a-rate nudge, whose CTA the parent cannot complete (the service requires an active member). |
| **Week approved before earnings existed** | An `approved` week with no frozen snapshot (approved before the earnings update shipped) renders hours only — no money line at all. A live-computed figure must never appear under an "Approved" label. |
| **Long amounts** | `£1,234,567.89` must not truncate the label. `WeekEarningsLine` label gets `flex-1`, amount `flex-shrink-0` — the audit's `StatusPill` overflow (#29) is the failure mode to avoid. |

---

## 9. Implementation priority

| Surface | Core (ship first) | Polish (defer) |
|---|---|---|
| **A — Pay arrangement** | Current terms card, change sheet with rate + effective-from, **setup flow + prompt card**, history list, empty states | Note field, second-carer picker |
| **B — My pay** | One card per family with rate + terms + effective-since | Inline history, per-family PTO balance |
| **C — Earnings on Hours** | Money line with state label, no-arrangement arm, approve dialog showing gross | Breakdown sheet (still core if the week has >1 line item — an unexplained total is worse than none), error arm, reopen caption |
| **D — PTO** | Parent mark-paid sheet with before/after, balance on terms card | Nanny anonymised markers, adjustment flow, over-balance warning |
| **E — Expenses** | Nanny add sheet, status chips, parent review sheet | Reimbursement card on the statement, mileage freeze display, rejection notes |
| **F — Statement** | The fixed order in §7 | PTO note line, reimbursement subtotal styling |

The single highest-value increment is **C's money line plus the approve dialog**:
it is the first moment the product answers the question both parties opened it
for. A is its precondition; everything else deepens it.

---

## 10. Open questions — RESOLVED by the product owner, 2026-08-04

The rulings below were binding at the time of this 2026-08-04 ruling; the body
of this spec was amended to match (today-default effective date, cancellation
row + chips, first-time setup flow). **Rulings 4 and 5 have since been
superseded** — see the notes inline below — by D-16 (future `valid_from`) and
T14 (cancellation window has one home, no household fallback). `TIER0-PLAN.md`'s
"Owner decisions" section is the same list from the implementation side.

1. **Gross wording** — "gross or total is fine". "Gross" stays, with the
   payroll caption.
2. **Who sets pay** — one parent, any parent. No co-parent approval; nothing
   routes through `approvalGateService`.
3. **PTO year boundary** — calendar year for v1. Entitlement is set by the
   parent during nanny setup (a setup-flow field, §2).
4. **Scheduled future rate changes** — cut for v1 at the time of this ruling.
   **Superseded by D-16**: `valid_from` may now be in the future, up to a
   12-month horizon, with a Scheduled card and a nanny-facing scheduled-change
   line (`screens-pay-terms.md` §6). The change sheet's date control accepts
   a future date, not today-or-earlier only.
5. **Cancellation policy** — per-nanny, set during setup, with an explicit
   "No cancellation pay" option; a set window means cancellations within N
   hours of the start are paid. Pricing stays at the full effective rate
   (reduced cancellation rates remain out of v1). **Superseded by T14**: the
   per-nanny policy is now the arrangement's **only** cancellation window —
   the household-level window was removed entirely, not kept as a fallback
   (`screens-pay-terms.md` §4.1.1).
6. **Pending mileage** — unchallenged; spec's answer stands (miles only until
   approval, no indicative amount).

Additionally ruled: **mileage rate is a per-nanny setup field** (it already
was, §2's change sheet and setup flow), because the same family may have
different policies with different nannies — true of every term on the
arrangement, which is why all of them live per household-carer pair.
