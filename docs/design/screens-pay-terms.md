# Pay & terms — screen spec (Daylight v2)

Reads with [`daylight-v2.md`](./daylight-v2.md). Sibling specs:
[`screens-hours.md`](./screens-hours.md), [`screens-settings.md`](./screens-settings.md).

Owners: `apps/mobile/src/domains/pay/components/PayArrangementScreen.tsx`,
`PaySetupScreen.tsx`, `PayChangeSheet.tsx`, `MyPayScreen.tsx`, `AmountRow.tsx`,
`utils/termRows.ts`, `utils/payArrangementForm.ts`; plus the "why" surfaces in
`apps/mobile/src/domains/timesheet/components/` — `WeekEarningsLine.tsx`,
`EarningsBreakdownSheet.tsx`, `ApproveWeekDialog.tsx`.

Binding decisions: TRUST-AND-TERMS-PLAYBOOK.md §5 **D-3** (progressive groups),
**D-4/D-5** ("why" + fast path), **D-6** (salary framing), **D-7** (jurisdiction
presets + liability posture), **D-11** (single PTO pool), **D-12** (holidays),
**D-13** (recurring non-wage terms), **D-16** (scheduled future change), **D-17**
(pay frequency), **D-31** (acknowledgment + version history). Binding PRESERVE
rows: **T16**, **T18**, **P15**.

This is the screen where two people find out what they agreed. Every judgment
below is made on one question: if these two ended up in front of a payroll
service, a mediator, or each other on a Friday night, does this screen settle
the argument or start it?

---

## 1. What is wrong today

Grounded in the files, not the screenshots.

**1. The terms document has no author and no reader — it has two different
screens.** `buildTermRows` (`utils/termRows.ts:80–137`) exists precisely so the
parent's card and the nanny's card can never drift, and then the two screens
drift anyway around it: the parent gets "In effect since…" *above* the rate
(`PayArrangementScreen.tsx:214–218`), the nanny gets it *below the term rows*
(`MyPayScreen.tsx:105–109`); the parent's history is always-visible with setter
attribution (`:250–289`, `historyFromSetBy`), the nanny's is behind a ghost
toggle with the attribution stripped (`MyPayScreen.tsx:110–133`, `historyFrom`).
The employee sees a shorter, less attributed version of her own contract. T16
says "both-role identical term rows"; the rows comply and the document around
them does not.

**2. The history cannot show what changed.** Both history lists render exactly
one fact per row — the rate (`PayArrangementScreen.tsx:265–267`,
`MyPayScreen.tsx:126–128`). A change that raised guaranteed hours from 45 to 50
and left the rate alone renders as two consecutive identical `$28.00/hr` rows.
The append-only table is doing its job perfectly and the screen is throwing the
answer away. D-31 asks for "visible version history"; there is currently no
version history, there is a rate history.

**3. Nothing records that the nanny ever saw any of this.** There is no ack
column, no ack table, no ack surface. The `pay_terms_set` push exists and dies
in the notification tray. A parent can change the cancellation window on a
Tuesday and the app's own record cannot say whether the person it binds ever
read it (T15).

**4. `PayChangeSheet` is a nine-field form in a `fitContent` bottom sheet**
(`PayChangeSheet.tsx:260–466`) that re-asks every term in order to change one,
with no statement of what is about to change. This build adds daily overtime,
double time, seventh-day, holidays, holiday premium, stipends, pay frequency,
pay day, and five documentary terms. The sheet does not scale, and more
importantly it never scaled *conceptually*: a change to an employment agreement
should be shown as a change, not as a re-typed form.

**5. `PaySetupScreen` and `PayChangeSheet` are two divergent copies of the same
effective-date control** — the T10 gap, verbatim. Setup has no `dateInvalid`
error and no mid-week consequence line (`PaySetupScreen.tsx:333–343` versus
`PayChangeSheet.tsx:314–351`), and its Today chip renders
`todayISO.slice(5)` — a raw `"08-10"` (`PaySetupScreen.tsx:321`). The change
sheet is better and renders `"10 Aug"` (`payArrangementForm.ts:101–105`), which
is en-GB. Neither is en-US. `formatDisplayDateWithYear` (`:108–112`) gives
`"10 Aug 2026"`, `formatWeekdayLong` (`:93–98`) gives `"Friday 10 August"`, and
`terms.ptoBalanceCaption` in `en/pay.json` reads `"1 Jan – 31 Dec {{year}}"`.
Every date the pay domain prints is in the wrong locale for a US-first app.

**6. The mid-week warning fires for one term out of nine.**
`buildMidWeekConsequence` returns `null` unless the rate or currency moved
(`payArrangementForm.ts:285–287`) — its own doc comment says "other mid-week
term changes stay silent here by design" (`:274–275`). A guaranteed-hours change
made on a Wednesday silently re-prices the *entire* week, because the engine
reads `guaranteed_minutes_per_week` from the week's **last day** arrangement
(`earningsService.ts:658–666`) — as it does the weekly overtime threshold
(`:521, 545–547`). That is the single largest silent-consequence hole in the pay
domain and it is T11.

**7. The one-line "why" is omitted from exactly the weeks that need it.**
`singleRateSubline` (`WeekEarningsLine.tsx:136–153`) returns `null` the moment
any line carries a multiplier or a second rate, so the sub-line under the gross
appears on plain weeks and disappears on overtime weeks and raise weeks. The
rule ("if we cannot say it in one true clause, say nothing") is honest and it is
the wrong rule: the answer is to say the *structure* instead, which is always
true.

**8. Currency still defaults to GBP on the wire**
(`payArrangement.schema.ts:165`), and the terms card's PTO caption hardcodes a
1 Jan–31 Dec calendar year. Both are 1-B/D-11 territory; noted here because they
are visible on this screen.

---

## 2. Point of view — there is one terms document, and both people read the same one

This is my one "solving the wrong problem" call.

Today "Pay & terms" is a settings sub-page that displays a rate, and "My pay" is
a different settings sub-page that displays a smaller version of the same rate.
Neither is the agreement. The agreement is currently distributed across a card,
a sheet, a history list, and a push notification, and the only thing that knows
the whole of it is a Postgres row.

**Build the terms document.** One surface, one order, one vocabulary, rendered
identically for both roles. It has a header that states the rate, the weekly
equivalent, and the two state facts that matter (*in effect since when*, *seen
by whom and when*); a body of term groups in a fixed order; and a version
history where each row says **what changed**. The parent's fork is exactly two
things: an edit affordance on each group, and a "Change terms" action. The
nanny's fork is exactly one thing: the acknowledgment button. Everything else is
byte-identical, because the whole value of this screen is that neither party can
be shown a different contract than the other.

Three structural consequences, all of which pay for themselves:

- **`PayChangeSheet` becomes a screen, not a sheet**, and it is diff-first: you
  edit groups, then a sticky footer opens **one** review sheet that states the
  before → after of every changed term, the effective date, and the consequence.
  The effective date and its validation exist in exactly one component, so T10
  cannot recur. The consequence is computed from the diff, so T11 cannot recur.
- **Setup, change, and (later) 3-O's nanny proposal are one form** rendered in
  three modes. D-3's progressive groups are the form; what differs is which
  groups start expanded and what the footer does.
- **Acknowledgment and version history stop being features and become properties
  of the document.** They have somewhere obvious to live the moment the document
  exists.

Size: **L** overall. It decomposes: §4 (the form) and §7 (diff-first change) are
the L; §8 (ack + history) is M; §9–§11 (my pay, salary framing, the "why") are
M and can land independently in 3-U2.

---

## 3. The term inventory and where each term is stored

Every term this build must express, its group, and its home. Follow §3's
new-arrangement-field checklist for every row marked *new column*.

| Group | Term | Storage | Priced by |
|---|---|---|---|
| **Core** | Hourly rate | `rate_minor` + `currency` | engine |
| **Core** | Takes effect from | `valid_from` (future allowed, D-16) | `effectiveOn` |
| **Core** | Cancellations | `cancellation_paid_within_hours` — the **only** cancellation window (null = explicit no, no fallback) | `resolveCancellationPaid`, per shift start date |
| Overtime | Weekly overtime after / paid at | `overtime_threshold_minutes`, `overtime_multiplier` | engine, **week's last-day arrangement** |
| Overtime | Daily overtime after / paid at | *new columns* `overtime_daily_threshold_minutes`, reuses `overtime_multiplier` | 3-E2, per day |
| Overtime | Double time after (daily) / paid at | *new columns* `doubletime_daily_threshold_minutes`, `doubletime_multiplier` | 3-E2, per day |
| Overtime | Seventh consecutive day | *new columns* `seventh_day_multiplier` (null = no seventh-day rule), `seventh_day_doubletime_after_minutes` (null = no second tier); reuses `doubletime_multiplier` | 3-E2, per day |
| Guarantee | Guaranteed hours a week | `guaranteed_minutes_per_week` | engine, **week's last-day arrangement** |
| Time off | Paid time off a year | `pto_entitlement_minutes_per_year` (single pool, D-11) | `pto_ledger` |
| Time off | Sick days | no field — sick is a **label** on the time-off row (D-11, 3-E3) | draws the one pool |
| Holidays | Which holidays are paid | household-level list + per-family toggles (D-12, 3-E4) | 3-E4 |
| Holidays | Worked-holiday premium | *new column* `worked_holiday_multiplier` (null = no premium) | 3-E4 |
| Mileage | Mileage rate a mile | `mileage_rate_per_mile_minor` | at expense approval (044) |
| Outside wages | Recurring stipend / bonus | `terms.recurring[]` in the 1-D jsonb: `{ label, amount_minor, cadence: 'weekly'\|'monthly'\|'annual' }` | surfaced, excluded from gross (D-13) |
| Pay schedule | Pay frequency, pay day | *new columns* `pay_frequency`, `pay_day_of_week`/`pay_day_of_month` (D-17) | **presentation only** |
| In writing | Notice period | `terms.notice_period_days` | — |
| In writing | Probation | `terms.probation_days` | — |
| In writing | What the job covers | `terms.duties` (text) | — documentation only (§5.3) |
| In writing | Driving | `terms.driving` (text) | — |
| In writing | Live-in conditions | `terms.live_in` (text) | — |

**Why the seventh-day rule is not a boolean** (David, D2). California's seventh
consecutive day is two tiers, not one: the first 8 hours of that day are paid at
1.5× and everything beyond 8 hours at 2×. A `boolean` can only say "on", which
would have priced day seven at a flat 1.5× and underpaid every long seventh day
in the state the preset library exists for. The three-value shape above mirrors
the daily-overtime tier shape exactly — threshold, multiplier, second-tier
threshold — so the engine has one pattern to implement rather than two, and a
state with a single-tier seventh-day rule just leaves
`seventh_day_doubletime_after_minutes` null.

**Why recurring stipends live in the jsonb and not a child table.** T18's
constraint is that multi-rule *rates* need a child table because `effectiveOn`
must always resolve to exactly one row. A stipend list is not a rate rule — it
is part of the agreement the row *is*. Putting it in the row's own immutable
jsonb keeps append-only for free: a new arrangement row carries a complete,
frozen copy of the stipends agreed at that moment. A child table would have to
be re-pointed on every new arrangement row, and the first time somebody forgot,
a two-year-old approved week would silently acquire a stipend nobody agreed to.

---

## 4. Terms entry — progressive groups (D-3)

**One component, three modes — `PayTermsForm`.** This is the shared contract
with `screens-onboarding-terms-proposal.md`; both specs name the same component
so 3-U1 builds it and 3-O reuses it rather than forking a second terms form.

```
<PayTermsForm
  mode="setup" | "change" | "propose"
  allowFutureStart            // D-16; false in `setup`
  jurisdiction                // households.jurisdiction, drives §5's preset buttons
  value / onChange
/>
```

`setup` is the first-ever arrangement, `change` is a new arrangement over an
existing one, `propose` is 3-O's nanny-authored proposal (which inserts nothing
— D-35: the parent's acceptance is the write). The mode changes the header,
which groups start expanded, and what the footer does. Nothing else.

### 4.1 Layout

```
┌ ScreenWash kind="brand"                                  absoluteFill
│  BackRow
│  H1  "Set up pay for Marisol"        | "Change terms"     32/40/600
│  Body mutedStrong  <one sentence, mode-specific>
│
│  gap 16
│  ┌ REQUIRED CORE ─────────────── Card tone="default", always open
│  │  Label     "Hourly rate"
│  │  [ $ ] [ 28.00                        ]   Input, decimal-pad
│  │
│  │  Label     "Takes effect from"
│  │  [ Aug 11, 2026                              ]  date field
│  │  → EffectiveDateField owns the field, the error, the hints
│  │
│  │  Label     "Cancellations"
│  │  ( Paid if cancelled within… ) ( No cancellation pay )
│  │  Small mutedForeground  "Choose one — this is the one term with
│  │                          no blank state."
│  │  Small mutedForeground  ← only while "No cancellation pay" is chosen
│  │    "With no cancellation pay, a shift cancelled at any notice pays
│  │     nothing."
│  └────────────────────────────────────────────────────────
│
│  gap 12
│  MetadataLabel  "The rest of the agreement"      mutedForeground, on ground
│
│  ┌ TERM GROUPS ───────────────── Card tone="default", p-0, rows inside
│  │  ▸ [chip] Overtime            Not set                          ⌄
│  │  ▸ [chip] Guaranteed hours    50h a week                       ⌄
│  │  ▸ [chip] Paid time off       80h a year                       ⌄
│  │  ▸ [chip] Holidays            6 paid · 1.5× when worked        ⌄
│  │  ▸ [chip] Mileage             Not set                          ⌄
│  │  ▸ [chip] Outside wages       $200 a month health stipend      ⌄
│  │  ▸ [chip] Pay schedule        Every Friday, weekly             ⌄
│  │  ▸ [chip] In writing          4 of 5 filled in                 ⌄
│  └────────────────────────────────────────────────────────
│
│  ┌ sticky footer ──────────────────────────────────────────
│  │  Button size="lg" variant="default"  "Review this change"
│  └────────────────────────────────────────────────────────
└
```

Required core is a card of its own, always open, never collapsible. It is the
three terms with no honest blank state, and separating them from the expanders
is what makes the expanders safe to leave closed.

The consequence line under "No cancellation pay" (Marisol, M11) is the only
place in the form where choosing an option prints what the option costs. It
earns the exception because this is the one term the setup flow forces a choice
on precisely because silence breeds the dispute (T16), and a parent tapping the
quieter-sounding of two chips should not have to infer that it means a shift
cancelled twenty minutes before the start pays zero.

### 4.1.1 The cancellation window has one home (T14)

Per `attention-and-notifications.md` §6.1, the arrangement's
`cancellation_paid_within_hours` is now the **only** cancellation window. The
duplicate household-level column is removed from Manage Household, the shift
detail dialog and the `is_short_notice` pill both read the arrangement, and
`null` stays an explicit no **with no fallback** — the third arm of
`shiftChangeRequestCommandService.ts:176–192` (no arrangement → fall back to
`household.cancellation_paid_within_hours`) becomes "no arrangement → not paid",
which matches the never-fabricate rule everywhere else in this domain.

Two consequences for this form:

- **The hours field no longer prefills from the household.** Setup's seeding
  (`PaySetupScreen.tsx:138–142`) and the change sheet's fallback
  (`PayChangeSheet.tsx:173–178`) both go away, along with the
  `householdCancellationDefaultHours` prop threaded through
  `PayArrangementScreen` and the `defaultCancellationChoiceFromHouseholdWindow`
  helper. The chips start unselected and the field starts blank — which is what
  T16's forced choice always wanted, and the household prefill was quietly
  undermining by making one chip look pre-answered.
- **A household with shifts but no arrangement now pays nothing on a
  cancellation.** That is stricter than today and it is the correct default: an
  unset window is the absence of an agreement, and inventing one from a
  household setting nobody linked to this carer is how two people end up
  disagreeing about a number neither of them chose. The no-arrangement empty
  state already tells the parent to set terms.

### 4.2 `TermGroup` — the expander

New component, `apps/mobile/src/domains/pay/components/TermGroup.tsx`. Built on
the existing `Collapsible` (`src/components/ui/collapsible.tsx`, rn-primitives)
— no new dependency, no `Animated.View` with a `className`.

```
Header row (the whole row is the trigger)   min-height 56  px-4  py-3
  IconChip tone="hours"   24px, rounded-cell
  Body weight="medium"    "Overtime"                        foreground
  Small tabular           <collapsed summary> | "Not set"   mutedForeground, right
  ChevronDown 20          mutedForeground, rotates 180° on open, 180ms easing.out

Content                                     px-4  pb-4  gap-4
  <the group's fields>
  [ Use common defaults ]   ghost, self-start   (§5, Overtime group only)
```

Rules:

- **The collapsed summary is the term's real value, formatted exactly as the
  read-only document formats it.** A closed sheet must read as a complete
  contract; expanding is for editing, never for finding out what was agreed.
- **A group opens by default when it has a value, and stays closed when it does
  not.** Reviewing an existing arrangement therefore reads top-to-bottom as a
  document; setting up a new one reads as a short required form with optional
  additions. One rule, both behaviors, no mode flag.
- Rows sit inside **one** card. Eight separately-lifted rows read as eight
  decisions (`screens-settings.md` §2.1 made this same call and it holds here).
- The chip is `tone="hours"` (sage) for everything on this screen. This is a
  money surface; register 4 is wayfinding, and mixing families across a single
  contract's groups would imply a distinction that does not exist.
- No borders, no dividers between rows. Separation by light.
- Header row is the touch target at 56pt; the chevron is decoration and gets no
  separate press handler.

### 4.3 Group contents

**Overtime.** Four tiers. The instruction line sits directly under the first
one it applies to, not orphaned at the foot of the group.

```
Label "Weekly overtime"
  After [ 40 ] hours, paid at [ 1.5 ] ×
  Small mutedForeground  "Leave a row blank if it doesn't apply."
Label "Daily overtime"
  After [ 8 ] hours in a day, paid at [ 1.5 ] ×
Label "Double time"
  After [ 12 ] hours in a day, paid at [ 2 ] ×
Label "Seventh consecutive day"
  Paid at [ 1.5 ] ×, then [ 2 ] × after [ 8 ] hours
  Small mutedForeground  "A seventh day worked in the same week."
```

Empty threshold means the tier does not exist — the null-is-an-explicit-no rule,
unchanged. The multiplier field is disabled and greyed while its threshold is
blank, so a stored 1.5 never looks like a live promise.

**Guaranteed hours.** One field, one derived line.

```
Label "Guaranteed hours a week"      [ 50 ]
Body mutedStrong (derived, §10)
  "At $28.00/hr with overtime after 40h, a 50-hour week comes to $1,540.00."
```

**Paid time off.** One field. Per D-11 there is one pool.

```
Label "Paid time off a year (hours)"    [ 80 ]
Small mutedForeground
  "Granted each calendar year. Sick days draw from this same pool and are
   labeled as sick on the day."
```

**Holidays** (D-12, 3-E4). A list, not a field.

```
Small mutedForeground  "Which holidays are paid, and what a worked holiday pays."
  New Year's Day        [Switch on]
  Memorial Day          [Switch on]
  Independence Day      [Switch on]
  … (the federal set, seeded on the household)
Label "Worked-holiday premium"    Paid at [ 1.5 ] ×
Small mutedForeground  "Leave blank if a worked holiday pays the normal rate."
```

The list is household-level; the premium multiplier is on the arrangement (it is
a term of *her* employment, and a second carer may have a different one). The
group header's collapsed summary reads `"6 paid · 1.5× when worked"`.

**Mileage.** Unchanged field, corrected hint: "Used to price mileage on
expenses. Changing it does not re-price expenses that were already approved."
That sentence is true (`earningsService.ts:76` — the rate is stamped at 044's
approval write) and it is the kind of fact that stops an argument.

**Outside wages** (D-13). A repeatable row.

```
  Health stipend       $200.00      Monthly        [×]
  Holiday bonus        $500.00      Annual         [×]
  [ + Add a recurring payment ]     ghost, self-start
Small mutedForeground
  "These are paid outside the hourly wage. Steadily shows them on the week but
   never adds them to the week's gross."
```

Each row: label `Input`, amount `Input` with the currency prefix, cadence
`Select` (weekly / monthly / annual). Amounts are integer minor units like every
other amount in this app.

**Pay schedule** (D-17, presentation only).

```
Label "How often you pay"      ( Weekly ) ( Every two weeks ) ( Twice a month ) ( Monthly )
Label "Pay day"                ( Mon )( Tue )( Wed )( Thu )( Fri )( Sat )( Sun )   [weekly/biweekly]
                               [ 15 ] and [ last day ]                             [semi-monthly]
Small mutedForeground
  "This is how weeks are grouped for you to look at. Overtime is always figured
   week by week, whatever the pay schedule."
```

That last sentence is not decorative. FLSA computes overtime on the fixed
workweek regardless of pay period, and a family that assumes a biweekly period
averages hours has just built a wage claim. The app says so once, here.

**In writing** (T9). Five fields, no amounts.

```
Label "Notice period"           [ 4 ] weeks
Label "Probation"               [ 90 ] days
Label "What the job covers"     Textarea
  placeholder "e.g. Care for Mia and Theo, meals and cleanup for the kids,
               their laundry, school pickup."
Label "Driving"                 Textarea
  placeholder "e.g. School run in our car; mileage paid for errands."
Label "Live-in conditions"      Textarea   (only when the household says live-in)
```

"What the job covers" is documentation of the agreement and nothing more. It
feeds no pricing, selects no preset, and is never pre-filled (§5.3).

---

## 5. Jurisdiction presets (D-7)

### 5.1 Where the state lives and where the preset is applied

`households.jurisdiction` (1-B) is set at household onboarding and editable in
Manage household. It is a property of the family, not of the arrangement.

**Presets never lead.** There is no "Start from a template" screen and no
template picker above the form. Per D-3, a preset offers itself **from inside
the group it would fill**: when the household has a jurisdiction and that
jurisdiction has something to say about a group, the group's expanded content
ends with a ghost button:

```
[ Use common defaults ]     ghost, self-start
```

At launch (§5.4) only the Overtime group carries this. Nothing else does.

**Applying a preset fills fields; it never saves anything.** After applying, the
fields are ordinary edited fields — the parent can change any of them, and the
change footer treats it as one edit like any other. The group says so, in a line
under the filled fields:

```
Small mutedStrong
  "Most common values are populated — check each one and update anything
   that doesn't match what you've agreed."
```

That line is the D-7 posture stated where the values actually land, rather than
only in the confirm sheet the parent has already dismissed. It says what the
numbers are (a starting point) and whose job the checking is (theirs), without
implying the app has assessed their household.

### 5.2 The liability moment

Tapping the preset button opens a confirm sheet (`BottomSheetBase`, never a bare
`Modal`). This is the D-7 posture and it is mandatory.

```
┌ BottomSheetBase  fitContent ─────────────────────────────
│  H4      "Common overtime defaults"
│  Body    "Overtime after 8 hours in a day and 40 in a week, at 1.5×.
│           Double time after 12 hours in a day, at 2×.
│           A seventh consecutive day worked is paid as overtime."
│
│  Small mutedStrong
│           "The most common values — a starting point, not legal advice.
│            Check each one against what you've agreed.
│            Reviewed Aug 2026."
│
│  Row     [✓] Body "I'll check these terms are right for our family."
│                                       Checkbox, 44pt row target
│
│  Button size="lg"  "Use these defaults"      disabled until checked
│  Button variant="ghost"  "Cancel"
└──────────────────────────────────────────────────────────
```

Copy rules for this sheet:

- The disclaimer is `Body` in `mutedStrong`, not `Caption` in `mutedForeground`.
  Text that transfers responsibility for a legal outcome is not allowed to be
  the smallest, faintest text on screen. (Same argument as
  `screens-settings.md` §3's delete-account consequence lines.)
- The checkbox sentence is first-person and specific — "I'll check these terms
  are right for our family" — not "I understand" and not "I agree to the terms
  and conditions." It names the action the family is taking on.
- **The confirmation is recorded, not just displayed.** Applying a preset writes
  `terms.preset = { id, version, applied_at, confirmed_by }` into the
  arrangement's jsonb. The parent's terms card and the version history then both
  say "Common defaults applied Aug 11" — so if the figures are ever disputed,
  the record says they came from a preset and who took responsibility. The
  stored `id`/`version` still identify *which* preset, for anyone reading the
  row; the rendered string does not name a state (§5.4).
- **Every preset carries a human review date, and the UI shows it.** A preset
  whose `reviewed_on` is more than 12 months old renders "reviewed Aug 2026" in
  `warningInk` and the group offers it with the same disclaimer. Statutory
  thresholds move; a preset library with no staleness signal is a liability the
  disclaimer does not actually cover.

### 5.3 One preset — the duties question is cut

> **Owner decision, 2026-08-11.** Verbatim: *"dont even ask this question. this
> should be deferred. I don't want to get into legalese about nanny work versus
> domestic worker."* The earlier draft asked whether the nanny spends more than
> a fifth of her time on non-childcare work, and branched the CA preset on the
> answer. Cut entirely — no question, no two arms, no `terms.duties_scope`
> storage.

**The preset is one set of values**, derived from CA Wage Order 15. That
derivation is documented here because the build needs the legal basis; it is
**never named in the UI** (§5.4):

| Term | Default |
|---|---|
| Daily overtime | After **8h** in a day, at 1.5× |
| Weekly overtime | After **40h** in the workweek, at 1.5× |
| Double time | After **12h** in a day, at 2× |
| Seventh consecutive day | 1.5×, then 2× after 8h |

That arm is the single default because it is the more protective of the two and
the more commonly correct for a full-time nanny. A household whose arrangement
genuinely sits elsewhere edits the fields — which is what §5.1 already says
every preset value is for.

The "In writing → What the job covers" textarea (§4.3) stays, purely as
documentation of what was agreed. It feeds nothing, selects nothing, and is
never pre-filled by a preset.

### 5.4 One preset library, and no state name in the UI

> **Owner decision, 2026-08-11**, amending D-7's eleven-jurisdiction list and
> reversing this section's earlier labelling requirement. Verbatim: *"Don't
> mention California defaults anywhere at all for that matter."*

**One preset ships**, the §5.3 values, offered to every household regardless of
jurisdiction. There is no state picker in front of it and no second preset to
choose between.

**No user-visible string names a state.** Not the button, not the sheet, not the
history row, not a hint, not a tooltip, not an accessibility label. The strings
are:

| Surface | Copy |
|---|---|
| Group button | "Use common defaults" |
| Confirm sheet title | "Common overtime defaults" |
| Confirm sheet disclaimer | "The most common values — a starting point, not legal advice. Check each one against what you've agreed. Reviewed Aug 2026." |
| Prefill line under the fields | "Most common values are populated — check each one and update anything that doesn't match what you've agreed." |
| Terms card and history row | "Common defaults applied Aug 11" |
| The nanny's copy | the same history row, same words |

**The split, stated so nobody re-derives it wrongly:** this spec documents that
the figures come from CA Wage Order 15 (§5.3) because the build needs the legal
basis and the reviewer needs to know what they are reviewing. The preset data
file still carries `jurisdiction: 'CA'` for that reason. **What is banned is the
user-visible string** — a parent never reads a state name, so the app never
appears to have assessed which state's law applies to their household. That
appearance is the liability D-7 exists to avoid, and naming the state was
creating it rather than disclaiming it.

The D-7 liability posture is otherwise **unchanged**: the confirm sheet, the
"a starting point, not legal advice" line, the first-person responsibility
checkbox, and the recorded `terms.preset` confirmation all stand exactly as
§5.2 specs them.

The `reviewed_on` gate (§5.2) stays as the mechanism for adding jurisdictions
later: a preset file with no dated human review does not render its button, so a
future state lands as data without a client release and without anyone deciding
to skip the review step. If a second preset ever ships, this section is where
the naming question gets re-opened — two unlabelled presets cannot both be
"common defaults".

**The preset content is a content task with a named human owner and a review
date, not a design task, and it is not something an implementation session
should invent from memory.** Each preset is a data file with
`{ id, jurisdiction, version, reviewed_on, reviewed_by, values }`. Shipping a
preset whose figures nobody verified is worse than shipping none, because the
disclaimer buys legal cover and buys no trust at all — the first family whose
$1,540 week comes back from payroll as $1,596 never believes the app again
(David, §2c).

---

## 6. Scheduled future change (D-16)

`valid_from` may now be in the future. `effectiveOn` already resolves "greatest
`valid_from <= date`", so a future row is invisible to pricing until its date
arrives — the engine change is a test-coverage obligation
(`effectiveOnParity.test.ts` plus future-row cases), not a rule change.

The date field (§7.2) accepts a future date like any other. The no-future-dates
guard in `buildCreatePayArrangementRequest` (`payArrangementForm.ts:180`) is
removed and replaced with a horizon bound (a future `valid_from` more than 12
months out is refused, same shape of check, opposite direction).

When a future row exists, the terms document gains an **L1 card above the terms
card**:

```
┌ Card tone="attention"  cardProminent  p-5.5  gap-3 ──────
│  Row  IconChip tone="brand"
│       H3  "New terms start Sep 1"                    foreground
│  Body mutedStrong
│       "$30.00/hr, up from $28.00. Guaranteed hours go from 45 to 50."
│  Row  Button variant="ghost" "Edit"    Button variant="ghost" "Cancel this"
└──────────────────────────────────────────────────────────
```

This is the screen's one L1 while it exists, and the terms card below stays L3 —
the current terms are still the settled fact, and the scheduled change is the
one thing that has not happened yet. Per §5.2 of daylight-v2 the promotion moves
ground, elevation, title size, and gains actions: four channels.

State words for the scheduled row:

| Situation | Word |
|---|---|
| `valid_from` in the future | **Scheduled** for Sep 1 |
| `valid_from` today or past, no `valid_to` | **In effect** since Aug 10 |
| `valid_to` set (member removed, 065) | **Ended** Aug 30 |

"Cancel this" is not a delete. The table is append-only (T16) and stays that way:
cancelling a scheduled change appends a new row identical to the currently-in-
effect terms with `valid_from` = the scheduled date, which supersedes it via the
`created_at desc` tie-break (T18's mechanism, used for exactly what it is for).
The history then shows both: the change was scheduled, and then it was called
off. The confirm copy says so: "The scheduled change won't take effect. Both the
change and this cancellation stay in the history."

### 6.1 A cancelled raise is announced as a cancelled raise (Marisol, M4)

A scheduled change that is called off must **not** reuse the generic
`pay_terms_set` body. To the person it was promised to, "your terms changed" and
"the raise you were told about in August isn't happening" are not the same
sentence, and sending the first when the second is true is the app quietly
taking the employer's side.

New push type, `pay_terms_scheduled_change_cancelled`, registered in
`PUSH_NOTIFICATION_TYPES` with an audience-map row (A11's map is total — a
missing entry fails typecheck, which is the safety net here):

```
Title  "A change to your terms was called off"
Body   "The new rate that was set to start Sep 1 isn't happening. Your
        current terms stay as they are."
```

No figures in the push body, matching A8. The ack card (§8.3) and the history
row both name it in the same words, and the history row reads "Scheduled change
for Sep 1 called off" rather than showing a diff against terms that never took
effect.

Two smaller cases the same rule covers: a scheduled change that is **edited**
before its date announces as an edit ("the change starting Sep 1 was updated"),
not as a new change; and a scheduled change whose date has already passed cannot
be cancelled at all — it is in effect, and changing it is an ordinary §7 change
with an ordinary consequence line.

---

## 7. Changing terms — diff-first

### 7.1 The flow

`/settings/pay/[carerId]/change` — a full screen (not a sheet), the same group
components as §4, seeded from the current arrangement. Its sticky footer is one
button: **"Review this change"**, disabled while nothing has changed and while
any field is invalid.

The button opens `TermsChangeReviewSheet` — the single place the effective date,
the validation, and the consequence live.

```
┌ BottomSheetBase  fitContent ─────────────────────────────
│  H4  "Review this change"
│
│  MetadataLabel  "What changes"
│    Hourly rate            $28.00  →  $30.00
│    Guaranteed hours       45h a week  →  50h a week
│    Daily overtime         Not set  →  After 8h, at 1.5×
│
│  MetadataLabel  "Takes effect from"
│    [ Aug 12, 2026                              ]  date field, today by default
│    Small text-destructive
│      "Enter a real date."                            ← invalid
│    Small mutedForeground
│      "Weeks that are already approved keep their approved totals."  ← backdated
│
│  ┌ Card tone="attention" ─────────── consequence, §7.3
│  │ Small mutedStrong  <the consequence sentences>
│  └──────────────────────────────────
│
│  Label "Note (optional)"     [ e.g. Annual review          ]
│  Small mutedForeground
│    "Terms are never edited or removed — this is added as a new record,
│     and Marisol is told about it."
│
│  Button size="lg"  "Set new terms"
└──────────────────────────────────────────────────────────
```

The before → after rows are `AmountRow`-shaped but two-valued: old value in
`mutedForeground`, arrow, new value in `foreground` semibold tabular. A term
going from unset to set reads `"Not set → After 8h, at 1.5×"`; a term being
cleared reads `"After 8h, at 1.5× → Not set"` — and never `"→ $0.00"` (T16).

### 7.2 T10 closed by construction

Extract `EffectiveDateField`
(`apps/mobile/src/domains/pay/components/EffectiveDateField.tsx`) owning the
field, `dateInvalid`, the backdating hint, and the future-date hint.
`PaySetupScreen`, `TermsChangeReviewSheet`, and 3-O's proposal form all render
that one component. The parity gap cannot re-open because there is nothing left
to diverge.

**One date field, not three pills** (owner, 2026-08-11). The earlier draft had
`( Today ) ( An earlier date ) ( A future date )` with a text input appearing
under the second and third. That is a mode selector in front of a value, and it
made the two dates a parent actually types — a backdate and a scheduled raise —
each cost a tap before they cost a date.

```
Label  "Takes effect from"
[ Aug 12, 2026                                   ]
```

- **Defaults to today.** The common case is already answered and needs no tap.
- **Any date is selectable**, past or future, in one interaction.
- **Every guardrail is unchanged.** Invalid calendar dates are refused
  (`isValidCalendarDate`, `payArrangementForm.ts:73–82`); the backdating hint
  fires on any past date; §7.3's consequence fires on any date that is not the
  household's week start; §7.4's backdated-reduction protection fires on any
  past date **however it was chosen** — it keys on the resolved date, never on
  which control produced it; the 12-month future horizon (§6) bounds the other
  end. Dropping the pills removed a mode, not a check.
- `PaySetupScreen`'s raw `todayISO.slice(5)` chip label (`:321`) disappears with
  the chips. The field renders `formatDisplayDateWithYear`.

Use the platform date picker rather than a typed `YYYY-MM-DD` string: it cannot
produce an invalid calendar date, which removes the format error as a routine
occurrence rather than merely handling it. The validation stays regardless —
the field is not the only writer, and the command service checks server-side
anyway.

Date formatting, en-US, in `payArrangementForm.ts` (`:25–63`, `:93–112`):

| Function | Today | Becomes |
|---|---|---|
| `formatShortDate` | `10 Aug` | `Aug 10` |
| `formatDisplayDateWithYear` | `10 Aug 2026` | `Aug 10, 2026` |
| `formatWeekdayLong` | `Friday 10 August` | `Friday, August 10` |
| setup's Today chip | `08-10` (`PaySetupScreen.tsx:321`) | chip deleted; the date field renders `Aug 11, 2026` |
| `terms.ptoBalanceCaption` | `1 Jan – 31 Dec {{year}}` | `Jan 1 – Dec 31, {{year}}` |

Keep the hand-rolled month arrays. Reordering three template literals is a
three-line change with no ICU risk; routing these through `Intl.DateTimeFormat`
is optional and gated on the same Hermes ICU check T13 raises for
`Intl.DisplayNames`. Do not couple a locale fix to an ICU investigation.

### 7.3 T11 closed by construction — a consequence for every term

`buildMidWeekConsequence` is replaced by `buildTermsChangeConsequence(previous,
next, effectiveDateISO, weekStartsOn)`. It fires whenever **any** term changed
and the effective date is **not** the household's week start — which means
`isMonday` (`payArrangementForm.ts:86–89`) becomes
`isWeekStart(dateISO, weekStartsOn)` and takes 3-E1's `households.week_starts_on`.
That is a hard cross-slice dependency: with D-8's Sunday default and a hardcoded
`isMonday`, every Sunday change would warn wrongly and every Monday change would
stay silent.

The sentences are per-term and each one is **true of the engine as it actually
behaves**, verified against the code:

| Changed term | Consequence sentence |
|---|---|
| Hourly rate | "This week is paid at two rates: $28.00 up to Tuesday, August 11, then $30.00 from Wednesday, August 12." |
| Currency | "Changing currency partway through a week means Steadily can't total that week. It will show the hours and no figure until the week is whole again." |
| Weekly overtime, guaranteed hours | "Overtime and guaranteed hours are figured from the terms in effect on the **last day** of the week, so this whole week — including Monday and Tuesday — uses the new ones." |
| Daily overtime, double time, seventh day | "Daily overtime is figured day by day, so these apply from Wednesday, August 12 onward. Monday and Tuesday keep the old ones." |
| Cancellations | "Cancellation pay is decided against each shift's own start date, so shifts already cancelled keep what they were owed." |
| Mileage | "Mileage already approved keeps the rate it was approved at. Only new approvals use $0.67." |
| Paid time off | "The yearly grant changes now. Time off already marked paid isn't recalculated." |
| Holidays, premium | "Holidays already worked and approved keep what they paid." |
| Outside wages, pay schedule, in writing | *no consequence line* — nothing already priced changes. |

The weekly-overtime / guaranteed-hours line is the important one and it is
currently silent. Anchors: `earningsService.ts:521` (`lastDayArrangement`),
`:545–547` (threshold), `:658–666` (guaranteed) — the code already documents
"the week is one unit"; the screen has simply never said it out loud.

Whenever any consequence sentence renders, one more is appended, always last
(David, D5):

> "A change partway through a week means this week's total may not match what
> your payroll service works out. Check the week before you send it."

That sentence costs nothing and pre-empts the exact moment David described as
the point he stops believing the app: two numbers that disagree, with no warning
that they were going to. Saying it in advance turns a discrepancy into an
expected consequence of a choice he made.

The consequence block renders on a `tone="attention"` card inside the review
sheet, `Small` in `mutedStrong` (Rule M: `mutedForeground` fails AA on
`surfaceAttention`). Multiple sentences stack; they never merge.

### 7.4 Backdating into a worked week (Marisol, M1) — **walk-away fix**

The gap: `valid_from` may be backdated, the engine reads the weekly overtime
threshold and the guaranteed hours from the week's **last day** arrangement
(`earningsService.ts:521, 545–547, 658–666`), and an unapproved week recomputes
freely. So a parent can backdate a rate cut or a guarantee reduction into a week
Marisol has already worked, and everything the app currently tells her is a
figure-less `pay_terms_set` push and a button inviting her to acknowledge it.

Her framing is the one that settles the design: *"if the app can compute the
parent's consequence line it can compute mine."* It already computes both — the
parent's review sheet prices the consequence, and the nanny's copy of the same
change simply does not show it.

**The rule.** A change is a **backdated reduction** when `valid_from` is earlier
than today *and* any unapproved week in the affected range prices lower under
the new terms than under the old. That is a server-side comparison — the engine
re-prices each affected unapproved week both ways — because it is the same
computation the week response already performs, and a client that guessed at it
would eventually guess differently from the engine.

Three consequences, all mandatory:

**(a) It pushes as a backdated change, not as a generic one.** New type
`pay_terms_backdated`, registered with its own audience-map row:

```
Title  "Your terms were changed back to Aug 3"
Body   "This changes weeks you've already worked. Open Steadily to see
        which ones."
```

Still no figures in the body (A8), and the type is **exempt from nothing** —
this is not child-safety-adjacent, so quiet hours apply normally (A4/D-28).

**(b) The parent's review sheet names the weeks before the change is sent.**
Above the existing consequence card:

```
┌ Card tone="attention" ───────────────────────────────────
│  Small mutedStrong  "This changes 2 weeks Marisol has already worked."
│    Aug 3 – Aug 9   (50h)   $1,540.00  →  $1,430.00
│    Aug 10 – Aug 16 (44h)   $1,288.00  →  $1,196.00
│  Small mutedStrong
│    "Marisol is told these weeks changed and by how much."
└──────────────────────────────────────────────────────────
```

The worked figures above are a backdated rate cut from $28.00 to $26.00 under
the California defaults (§5.3): the 50-hour week goes `40×28 + 10×42` →
`40×26 + 10×39`, and the 44-hour week goes `40×28 + 4×42` → `40×26 + 4×39`.
Both are checkable by hand, which is the standard every example in this spec is
held to (§10.1).

The last line is the honest part: the parent learns, at the moment of the
decision, that this is not a silent edit. Approved weeks are excluded from the
list entirely — they are frozen and keep their approved totals, which the
existing backdating hint already says.

**(c) The nanny's sheet shows the same table, with the same figures.** Not a
summary of it, not a count of affected weeks — the identical before → after
rows, in §8.3's read-only sheet, above the diff. Both people read one table.

State words on every figure (P15): each row's amounts carry **Estimated** —
these are unapproved weeks and the totals can still move.

If no unapproved week prices lower, none of this renders. A backdated *raise*
is an ordinary change with an ordinary consequence line; the affected-weeks
table is a reduction affordance, not a backdating affordance, because a raise
that reaches back does not need to be defended against.

---

## 8. Acknowledgment and version history (D-31)

### 8.1 The record

New table, append-only like everything else in this domain:

```
pay_arrangement_acks
  arrangement_id  uuid  not null  references pay_arrangements(id)
  carer_id        uuid  not null
  acknowledged_at timestamptz not null default now()
  unique (arrangement_id, carer_id)
```

An ack is a *different fact about* an immutable row, written later by a
different person — so it is a row of its own, never a column on
`pay_arrangements` (which has no update path and must not grow one).

Only the carer the arrangement is for may write one. There is no un-acknowledge.

### 8.2 What the word means — a refinement of D-4's vocabulary

D-4 extends the state-word vocabulary to terms as "**Agreed** + date". Applied to
a parent-authored arrangement, that word overclaims: the parent wrote these
terms, the nanny pressed a button saying she read them, and rendering that as
"Agreed" turns a receipt into consent. On a screen whose entire purpose is that
nobody can later be told they agreed to something they did not, that is the
exact failure mode to avoid.

So the vocabulary forks, precisely:

| Word | Means | Where it appears |
|---|---|---|
| **In effect** since {date} | These terms are what prices the week now | every terms document |
| **Scheduled** for {date} | A future `valid_from` exists | §6 |
| **Ended** {date} | `valid_to` set (065) | past members |
| **Seen** by {name} on {date} | The carer acknowledged this version | D-31 ack |
| **Not seen yet** | No ack row for the current version | D-31 ack |
| **Agreed** {date} | A proposal one party made and the other accepted | **3-O only** (D-35) |

Money keeps Estimated / Approved / Recorded, untouched (P15).

This is a deliberate reading of D-4 rather than a literal one, and it still
wants an owner's yes or no — see the owner-decision flags in the Persona review
appendix.

**Marisol endorsed this unprompted** (M7): she said she would fight for the
distinction. That is the strongest evidence available that the literal reading
of D-4 would have misfired on exactly the person the acknowledgment exists to
protect — the word "Agreed" on a button she pressed to dismiss a card is the
sentence an employer quotes back at her.

### 8.3 The nanny's acknowledgment moment

Not a blocking modal. A change to someone's pay is important; it is not an
emergency, and an app that seizes the screen over money the moment she opens it
is an app she opens less.

Three coordinated surfaces, per the one-owner-per-item rule (B3):

1. **Push**, on every change (D-31): "Your terms with the Ahmeds changed" — no
   figures in the push body, matching A8's discipline for approved amounts.
2. **Inbox row**, deep-linking to My pay.
3. **An L1 card at the top of My pay**, and nowhere else:

```
┌ Card tone="attention"  cardProminent ────────────────────
│  Row  IconChip tone="brand"
│       H3  "Your terms changed on Aug 10"
│  Body mutedStrong
│       "Your rate went from $28.00 to $30.00 an hour, and guaranteed
│        hours from 45 to 50."
│  Button size="lg" variant="default"  "See what changed"
└──────────────────────────────────────────────────────────
```

"See what changed" opens the same before → after sheet the parent saw in §7.1,
read-only, with the note the parent wrote and the person who set it.

**It carries the §7.3 consequence card too, not just the diff** (Marisol, M6).
The sentence that says "this whole week — including Monday and Tuesday — uses
the new terms" is the single most useful line in the change, and showing it only
to the person making the change is how the app ends up having explained the
consequence to exactly one of the two people it lands on. Where §7.4's
affected-weeks table applies, that renders here as well, with the same figures.

Its footer:

```
  Button size="lg"                "I've seen these terms"
  Button variant="ghost"          "I don't agree with this"
  Small mutedForeground
    "This records the date you saw them. It isn't an agreement to them, and
     it doesn't give anything up."
```

### 8.3.1 The dissent row (Marisol, M3) — **owner decision, extends D-31**

> **Extends D-31**, which specifies acknowledgment, change notifications, and
> version history. Adding a dissent record is beyond that decision's letter.
> Designed here; flagged for the owner. Marisol's position is that an ack with
> no way to say "no" is a signature box.

"I don't agree with this" writes a row into the same append-only table, with a
`kind` discriminator:

```
pay_arrangement_acks
  arrangement_id  uuid  not null
  carer_id        uuid  not null
  kind            text  not null  check (kind in ('seen', 'disagreed'))
  note            text  null       -- optional, 280 chars
  created_at      timestamptz not null default now()
  unique (arrangement_id, carer_id, kind)
```

The unique key gains `kind`, so a carer may record both — seeing something and
disagreeing with it are different facts, and one does not retract the other.

Tapping it opens a small sheet: `H4` "Tell them what's wrong", a `Textarea`
(optional), and a confirm. Copy under the field:

> "This is recorded with the date and your family sees it. It doesn't change
> the terms, and it doesn't stop them applying — it puts your side on the
> record."

**It blocks nothing.** The terms stay in effect, the week keeps pricing, no
approval is gated. That is the whole reason it is safe to ship: it is a record,
not a veto, so it cannot deadlock a household the way a queried week can (P2).

The parent sees it as a third pill state on the header — `declined` variant,
"Disagreed Aug 11" — and as a line in the history row. No notification-storm
risk: one push, same as any other, routed to the parent.

**Why this ships with the ack rather than waiting for 3-O.** 3-O's proposal
mechanism is the real answer — a nanny who disagrees should be able to counter
with terms, and D-35 makes the parent's acceptance the binding act. But 3-O is
the last slice in the build and lands after the ack does. Shipping an
acknowledgment button with no dissent path, even for one release, means the
first thing this app ever asks a nanny to do about her pay is confirm she has
seen it — and Marisol's whole recorded objection is that the app takes the
family's side by design. A ghost button and one table row is the cheapest
possible refutation of that, and it stays useful after 3-O as the lightweight
option next to a full counter-proposal.

That second sentence is load-bearing and must not be softened into
reassurance-speak. A nanny who has been burned (Marisol, §2c) will assume any
button on a pay screen is a waiver unless the app says plainly that it is not.
After tapping, the card is replaced by the ordinary document header carrying
"Seen Aug 11".

**The ack is never required to see anything.** All terms, all history, and every
figure stay fully readable before and after. An acknowledgment gate on a
worker's view of her own contract would be the single most damaging thing this
build could ship.

### 8.4 What the parent sees

On the terms document header, a `StatusPill` beside "In effect since Aug 10":

| Ack state | Pill | Copy |
|---|---|---|
| Ack exists for the current version | `confirmed` | "Seen Aug 11" |
| No ack for the current version | `pending` | "Not seen yet" |
| A `disagreed` row exists (§8.3.1) | `declined` | "Disagreed Aug 11" |

A disagreement outranks a "seen" in the header — if both rows exist, the pill
reads "Disagreed Aug 11" and the history row carries both dates. Tapping it
opens her note. This is the one place a `declined`-variant pill appears on a pay
screen, and it means what it says: a person recorded an objection, not that the
app refused anything.

That is the whole treatment. **No nudge, no reminder button, no "Ask Marisol to
confirm".** The fact is reported; chasing an employee for a receipt on terms the
employer wrote is a dynamic this app does not build. If the parent wants to
know, the pill already told them.

### 8.5 Version history that says what changed

Replace the rate-only rows (`PayArrangementScreen.tsx:250–289`,
`MyPayScreen.tsx:117–142`) with L4 rows on the bare ground:

```
MetadataLabel  "History"                          mutedForeground
Small mutedForeground
  "Terms are never edited or removed — a change is a new record."

┌ rounded-row  bg-card  px-4 py-3  elevation.row ──────────
│  Body weight="medium"   "From Aug 10, 2026"
│  Small mutedForeground  "Rate $28.00 → $30.00 · Guaranteed 45h → 50h"
│  Small mutedForeground  "Set by David Chen on Aug 10 · Seen Aug 11"
│  Small mutedForeground  "Annual review"            ← the note, when present
└──────────────────────────────────────────────────────────
┌ ────────────────────────────────────────────────────────
│  Body weight="medium"   "From Jan 1, 2026"
│  Small mutedForeground  "Common defaults applied"
│  Small mutedForeground  "Set by David Chen on Dec 28 · Not seen"
└──────────────────────────────────────────────────────────
```

The diff line is computed client-side by the same `buildTermsDiff` that powers
§7 — one function, three call sites (review sheet, ack sheet, history), so the
history can never describe a change differently from how it was reviewed. The
oldest row has no predecessor and reads "First terms set" rather than a diff
against nothing.

Newest first (matching P15's payments-history ordering; the week ledger's
oldest-first is a different object and stays as it is). Rows are collapsed to
three lines with `ExpandableText` on the note.

**Both roles get this list, in full, with the setter attribution and the ack
line.** The nanny's ghost "See history" toggle (`MyPayScreen.tsx:110–116`) is
deleted — a person's own contract history is not progressive disclosure.

---

## 9. My pay (nanny)

`MyPayScreen` renders one terms document per household, using the same
components §4 and §8.5 define, in view mode.

```
┌ ScreenWash kind="brand"
│  BackRow
│  H1 "My pay"
│  Body mutedStrong
│    "What each family has agreed with you. Only that family can see
│     their own terms."                                     ← keep verbatim
│
│  per household:
│  ┌ HEADER (no card, on the ground) ─────────────────────
│  │  H4  "The Ahmeds"
│  │  SignatureHeroBold "$30.00" 40/48/700 tabular  + Body mutedStrong "/hr"
│  │  Body mutedStrong  "$1,540.00 a week at 50 guaranteed hours"
│  │  Row  StatusPill confirmed "In effect since Aug 10"
│  │       StatusPill confirmed "Seen Aug 11"
│  └───────────────────────────────────────────────────────
│  ┌ TERMS CARD ─── L3, the same groups, flat rows, no expanders
│  ┌ HISTORY ────── L4, §8.5, always visible
└
```

The only structural difference from the parent's screen is the absence of edit
affordances and the presence of the ack button when unacknowledged. Past
households keep their cards with the header reading **"Ended Aug 30"** — the pay
she is still owed by a family she left is exactly what this screen is for
(`MyPayScreen.tsx:156–163` already gets this right; do not regress it).

### 9.1 Arrival from an accepted proposal

Agreeing terms is the most consequential act in this product. It used to close
the accept sheet and `router.replace` straight onto My pay (nanny) or Pay &
terms (parent) — the least feedback of any moment in the app, a silent
teleport onto a settings page.

Accept now stays on `ProposalReviewScreen` and swaps the review body for a
`MomentCard` (`pay:moments.termsAgreed.*`, illustration `emptyPay`,
`testID="terms-agreed-moment"`). The card names the counterparty, the rate, and
the start date. The CTA (`testID="terms-agreed-continue"`) is what continues to
My pay / Pay & terms. This is in-screen state, not a new route: a failed accept
never shows the moment, and the sheet stays open with the box still checked.

---

## 10. Salary framing (D-6) — and the trap in it

D-6's worked example is `"$1,400/wk guaranteed = $28 × 50h"`. **That arithmetic
is wrong for most of the arrangements this build is adding**, and shipping it
would be the highest-cost small mistake in the whole project.

With overtime after 40h at 1.5×, 50 guaranteed hours at $28.00 is
`40 × 28 + 10 × 42 = $1,540.00`, not `$1,400.00`. Under the CA Wage Order 15
arm, a 50-hour week worked as five 10-hour days is
`40 × 28 + 10 × 42 = $1,540.00` again but distributed differently, and a week
containing a 13-hour day adds double time on top. **A naive rate × hours
multiply is forbidden anywhere in this app.** It is precisely David's stated
trust-killer: "the day the app says $1,540 and payroll says $1,596, I believe
payroll forever."

The rule:

- The weekly equivalent is **computed through the same overtime rules the engine
  uses**, or it is not shown. Concretely: the arrangement response carries a
  server-computed `weekly_equivalent_minor`, produced by the engine's own
  day-and-week splitter over the guaranteed minutes, so it cannot drift from
  what the week actually prices. It does not get its own client-side formula.
  **Guard note** (David, D4): a future reviewer will look at one server field
  feeding one label and propose "simplifying" it to `rate × hours` on the
  client. That refactor is forbidden and the reason belongs next to the code —
  a comment on `weekly_equivalent_minor` naming this section, because the
  simplification is only wrong on arrangements with overtime, which means it
  will pass every test written against a no-overtime fixture.
- It renders **only** when both a rate and guaranteed hours exist. No guarantee
  → no line. Never a fabricated figure (T16).
- Because a daily-overtime arrangement's answer depends on how the hours fall
  across days, the computed figure assumes an even spread and **says so**:

```
Body mutedStrong
  "$1,540.00 a week at 50 guaranteed hours"
Small mutedForeground                                    ← only when daily OT is set
  "Assumes five 10-hour days. Longer days add daily overtime."
```

- The label is never the word "salary". This is an hourly arrangement with a
  guarantee; calling it a salary invites an exempt-employee assumption that is
  wrong for essentially every nanny in the US.

Where it appears: the terms document header (both roles), the guaranteed-hours
group's derived line (§4.3), and the setup screen's live preview as the parent
types.

### 10.1 The non-duplication invariant (David, D3)

Once daily and weekly overtime both exist, the first thing an implementation can
get wrong is counting one hour twice. Five 10-hour days is **40 regular + 10
overtime**, never 40 + 20 — the 10 hours are daily overtime *and* they are the
hours above 40 in the week; they are the same hours.

**The rule, stated so 3-E2 can implement it directly:** split each day into its
tiers first (regular / daily overtime / double time). Then compute the week's
overtime obligation on the **regular minutes only** — the minutes that have not
already been paid a premium. Weekly overtime never re-examines an hour that a
daily tier already promoted. Double time is never demoted by a weekly rule.

Named test, in the `earningsService.test.ts` case table:

> `'an hour is never both daily and weekly overtime'` — CA Wage Order 15
> arrangement, five 10-hour days: expect `regular 2400m`, `overtime 600m`,
> `doubletime 0m`, gross `$1,540.00`. Fails at `40 + 20` and at any total
> above 50 hours of priced minutes.

Two more cases that pin the boundaries, using this spec's canonical week:

| Week | Expected split | Gross at $28.00/hr |
|---|---|---|
| 5 × 10h = 50h | 40 reg + 10 OT | $1,540.00 |
| 4 × 10h + 1 × 13h = 53h | 40 reg + 12 OT + 1 DT | $1,680.00 |
| 5 × 8h = 40h | 40 reg | $1,120.00 |

The 53-hour row is the one worth checking by hand, because it is where the two
systems could disagree and do not: daily tiers give `4 days × 2h = 8h` overtime
plus, on the 13-hour day, `4h` overtime (hours 8–12) and `1h` double time; total
premium hours `13`. Weekly says 53 − 40 = 13 hours above the threshold. Same
thirteen hours, reached two ways — which is exactly why the engine must pick one
path and not add them.

**Every worked example in this spec uses these three weeks.** A figure invented
for one section is a figure some implementation session will encode literally.

---

## 11. The "why" system (D-4 / D-5)

### 11.1 The collapsed one-liner

Replace `singleRateSubline` (`WeekEarningsLine.tsx:136–153`) with
`earningsStructureLine(earnings)`, which is **always** producible because it
describes structure rather than asserting a single rate. Using §10.1's
53-hour week:

```
53h = 40 reg + 12 OT + 1 DT
```

Built by walking `earnings.lines`, summing minutes per kind, in
`EARNINGS_LINE_ORDER`. It survives a new line kind by construction (1-A's
tolerant client gives unknown kinds a generic label; the structure line prints
the label it was given), which closes one of §2.5's three silent sites for free.

Rendered under the gross in `WeekEarningsLine`, `Small` `mutedForeground`,
tabular, replacing the sub-line that disappears today on exactly the complicated
weeks. The single-rate case keeps its more readable form
(`"38h 30m × $12.00"`) — one true clause beats a decomposition when one exists.

When the previous week matches, append the fast-path clause:

```
53h = 40 reg + 12 OT + 1 DT · nothing unusual this week
```

The clause is computed **server-side**, next to the engine that already has both
weeks, and arrives as one boolean on the week response. Do not compute it
client-side from a second week fetch — that is an extra round trip on every
Hours load to answer a question the server can answer for free, and two
implementations of "same" is one implementation too many.

### 11.1.1 What the fast path should actually test (David, D7) — **owner decision**

> **Refines D-5**, which specifies "same structure as last week". Recommending a
> different predicate behind the same idea; the decision's intent is preserved,
> its literal wording is not.

D-5's condition — same line kinds, same minute split, same rates — is
byte-identical structure. David's objection is empirical and it holds: under
California daily overtime, the split moves whenever a day runs long, so two
ordinary 50-hour weeks worked as `5 × 10h` and `4 × 11h + 1 × 6h` produce
different structures and the fast path goes dark. A reassurance that only fires
on metronome weeks is a reassurance that never fires for the persona it was
written for.

Recommended predicate — **"nothing unusual this week"**, true when all of:

- no time entry was edited or added after the fact (`editedMarker` absent on
  every day row),
- every shift priced was on the household's usual pattern (no off-pattern or
  ad-hoc shift),
- no open query on the week (`status !== 'queried'`),
- no expense or reimbursement attached,
- no arrangement change took effect inside the week (a split week is by
  definition unusual, §7.3),
- and the week's gross is within a small band of the trailing four-week median
  — the one numeric test, which catches a week that is quietly double the usual
  without pretending to know why.

Every one of those is a fact the server already has. The clause then means what
a parent actually wants it to mean on a Friday: *nothing here needs your
attention.* Structure-identical weeks are a subset of it.

Copy changes with the predicate — "nothing unusual this week", not "same
structure as last week", because the new claim is broader and the old wording
would be a promise about arithmetic the predicate no longer makes.

**If the owner keeps D-5 literally**, the structure line still ships; only the
clause narrows, and the honest expectation is that a CA household with daily
overtime sees it perhaps one week in four.

Below it, the existing "See the breakdown" link is unchanged and still opens the
expansion.

### 11.2 The expansion

`EarningsBreakdownSheet` is already the right sheet. Two additions:

- **Every line label becomes pressable and opens the glossary** (§11.3).
  `AmountRow` gains an optional `onLabelPress`; a label with a handler renders
  with a 1px dotted underline in `mutedForeground` and an `info` a11y hint. This
  is the only place in the app a label is pressable, and the affordance must be
  visible or it is decoration.
- **The terms that produced each line are named.** Under the overtime row's
  existing sub-line, one more: "Your terms: overtime after 40h, at 1.5×." The
  breakdown currently explains the arithmetic; it should also point at the
  clause. That is the whole of D-4's "why": the figure, the arithmetic, the
  clause.

### 11.3 The glossary — ship last

**Priority note** (David, D10). D-4 requires a glossary and it stays in scope,
but it is the lowest-value item in this section and it ships **last** within
3-U2. His argument is sound: §11.2's "Your terms: overtime after 40h, at 1.5×"
caption answers the question a parent is actually asking at the figure ("why is
this number what it is"), and a definition of the phrase "double time" is a
different, rarer question. If the slice runs short, the captions ship and the
glossary slips — that ordering is deliberate and is not a licence to cut it.

One sheet, `TermsGlossarySheet`, one static key → `{ term, definition }` map in
`hours.json` under `glossary.*`. Opened from any pressable label. Entries at
launch: overtime, daily overtime, double time, seventh day, guaranteed hours,
top-up, paid time off, cancellation pay, mileage, outside wages, gross, workweek.

Definitions are two sentences, plain, and describe **this app's behavior**, not
the law:

> **Guaranteed hours.** The least you're paid for in a week, even if fewer
> hours are worked. If the week comes up short, the difference is added as a
> top-up at your hourly rate.

No links out, no legal citations, no "consult a professional" boilerplate — the
disclaimer lives at the preset moment (§5.2), where the responsibility actually
transfers.

### 11.4 The approve-dialog fast path (D-5)

`ApproveWeekDialog` already branches its body by key
(`ApproveWeekDialog.tsx:73–85`). Add the structure line to the `ok` body and one
new variant for the matching-structure case:

Both bodies use §10.1's 53-hour week, and the hours in the sentence, the
structure line, and the gross all describe the same week (David, D8 — the
earlier draft approved 41h and then explained a 50h structure; examples get
implemented literally, so they have to sum):

```
approveDialogBody
  "You're approving 53h 00m for Marisol and freezing $1,680.00.
   53h = 40 reg + 12 OT + 1 DT."

approveDialogBodyNothingUnusual
  "You're approving 53h 00m for Marisol and freezing $1,680.00.
   53h = 40 reg + 12 OT + 1 DT. Nothing unusual this week."
```

The gross stays text inside the sentence, tabular, not a hero figure — this is a
confirmation, not a receipt, and that existing distinction is right. David's
Friday is thirty seconds when the last line says nothing is unusual and he reads
no further; the weeks where it does *not* say that are exactly the weeks worth
his attention. The dialog must never make that claim on a week where it is not
exactly true — a fast path that is occasionally wrong is worse than no fast
path, because it trains the reader to skip the one week that mattered.

---

## 12. Pay records both people can take elsewhere (D-29)

D-29 already decided the export pack. Both personas independently named its
absence as a condition of trusting anything else here, so this section pins the
decision to surfaces rather than re-deciding it. Implementation is 3-U3; the
contract lives here because the figures come from the terms this spec defines.

### 12.1 The nanny's pay record (Marisol, M5)

Her framing: a record she can only obtain by asking her employer for it is not
her record. Every figure below already exists in a frozen approved week —
nothing new is computed, it is assembled and handed over.

**Generated by her, from My pay, without asking anyone.** One button,
"Download a pay record", offering a week, a date range, or a year.

Per week, one document:

```
Week of Aug 3 – Aug 9, 2026            Approved Aug 10
The Ahmeds · Marisol Reyes

Hours          53h 00m
  Regular      40h 00m   at $28.00        $1,120.00
  Overtime     12h 00m   at $42.00 (1.5×)   $504.00
  Double time   1h 00m   at $56.00 (2×)      $56.00
  Top-up            —                            —
Gross                                      $1,680.00

Mileage        18 miles at $0.67             $12.06   (paid outside wages)
Outside wages  Health stipend               $200.00   (paid outside wages)

Paid           $1,680.00 on Aug 12 · Bank transfer
Still owed     $0.00
```

Rules that make it a record rather than a screenshot: it exports **frozen
snapshots only** — an unapproved week is refused, not estimated (P15's export
discipline, "export stricter than screen"); state words on every figure; the
"paid outside wages" tags are load-bearing, since reimbursements and stipends
are excluded from gross by construction and a document that silently added them
would misstate her taxable wages; and a corrected payment (D-20) shows **both**
rows and the true balance, never a netted single line.

Year mode adds a YTD gross and a per-week table. It computes no tax and says so
in one line: "Steadily doesn't work out tax. Your payroll service does that."

### 12.2 The parent's payroll handoff (David, D12)

His condition for trusting the numbers at all, and the reason is mechanical: he
retypes figures into a payroll service every pay period, and a total he cannot
decompose into the columns that service asks for is a total he has to re-derive
by hand — at which point he is checking the app rather than using it.

Two additions to the week CSV, both driven by terms this spec defines:

**Per pay period, not only per week** (D-17). The pay-schedule group already
records frequency and pay day, so periods are derivable. A biweekly household
exports one file covering both weeks with the weeks still itemised — overtime
stays computed per workweek inside it (§4.3's standing warning), and the export
header says so, because a payroll service that averages two weeks produces a
wage claim.

**Hour classes in separate columns**, never one blended figure:

```
week_start, week_end, carer, regular_minutes, daily_ot_minutes,
weekly_ot_minutes, doubletime_minutes, holiday_minutes,
holiday_premium_minutes, pto_minutes, topup_minutes,
gross_minor, currency, reimbursements_minor, outside_wages_minor,
period_start, period_end, approved_at
```

Daily and weekly overtime are separate columns even though §10.1 guarantees they
never double-count — payroll services ask for them separately, and collapsing
them means David has to split them back out from a rule he would have to trust
us about.

**Year-end totals per employee**, one page: gross by class, total paid,
reimbursements, outside wages, and the household's own identifiers. This is the
FSA / Form 2441 job and it happens once a year in a hurry.

Both exports refuse a week that cannot be priced rather than exporting a zero —
the same refuse-don't-clamp rule as everything else that touches money here.

---

## 13. Personas

**Parent** (`PayArrangementScreen`). Authors the terms, applies presets, takes
the D-7 responsibility, schedules changes, sees the ack pill. Reaches the screen
from Settings → Your household → Pay, from the `PaySetupPromptCard`, and from
`WeekEarningsLine`'s no-arrangement nudge (`WeekEarningsLine.tsx:229–239`). A
co-parent restricted by `approval_mode='owner_only'` is a scheduling concern
(S4), not a pay concern — pay writes are `WRITE_ROLES` and both see the same
screen.

**Nanny** (`MyPayScreen`). Reads everything the parent reads, in the same order,
with the same words, plus the acknowledgment. Cannot edit. Under 3-O she gains a
"Propose a change" entry point that authors a proposal through this same form
(D-35: her proposal is not an arrangement; the parent's acceptance inserts the
row).

**Helper.** No access to either screen. `MyPayScreen`'s existing not-available
state (`MyPayScreen.tsx:189–216`) is correct and stays; D-21 tightens the
server side to match.

### 13.1 Who can read whose rate — stated, because it was not (Marisol, M2)

Her walk-away condition, and she was right that this spec did not say it:

> **A carer reads her own arrangement and no one else's.** In a household with
> two nannies, neither can see the other's rate, terms, history, acknowledgment,
> or any figure derived from them. Parents read all of them. A helper reads
> none.

This is **D-21**, and it is enforced server-side — RLS *and* service scope, not
a client filter. The distinction matters and the spec states it in these words
because "the app doesn't show it to her" and "the app won't give it to her" are
different promises, and only the second one survives a screenshot of an API
response. Today's gap (P4/P8) is exactly that: the client narrows and the
household-scoped read does not.

Consequences for the surfaces here:

- `PayArrangementScreen`'s carer picker (`:409–419`) is parent-only and stays
  so. A nanny reaching `/settings/pay/[otherCarerId]` gets the opaque
  not-found, never an empty state that confirms the person exists.
- `MyPayScreen` is scoped to `userId` from the auth store
  (`MyPayScreen.tsx:164`) and the server must scope identically rather than
  trusting that parameter.
- Nothing on either screen aggregates across carers — no household pay total,
  no comparison, no "your other nanny's terms" affordance, ever.

Marisol's stated stake in this is not abstract: "one screenshot in a nanny
Facebook group and this app is done." A wage-visibility leak between two
employees of the same family is the failure this domain does not recover from.

**Past member.** Read-only, header reads "Ended {date}", history intact. Same
rule as `screens-hours.md` §6: the screen *says* the person is no longer with
the household rather than silently omitting the buttons.

---

## 14. States

| State | Treatment |
|---|---|
| **Loading** | Header paints the carer name and the H1 immediately (both local). The rate slot is a `40 × 140` skeleton bar; the terms card is three row skeletons; the history is two. Never a full-screen spinner — `PayArrangementScreen.tsx:157–159` currently blanks the entire screen including its own title. |
| **PTO balance still loading** | The balance row renders a blank value, never "Not set" and never a fabricated "0h". `termRows.ts:65–78`'s three-valued handling is exactly right and must not be simplified. |
| **No arrangement (parent)** | `EmptyState` with `empty-pay`, "Set pay terms" CTA. Never a $0.00 anywhere on the screen (T16). |
| **No arrangement (nanny)** | "This family hasn't set your rate in Steadily yet. Your hours are still being recorded." No CTA — she cannot complete it, and a button she cannot use is worse than none. |
| **No jurisdiction on the household** | Groups render with no preset buttons, and Manage household shows an unobtrusive row: "Where you are · Not set". The terms form never blocks on it. |
| **Preset stale** (`reviewed_on` > 12 months) | The review date renders in `warningInk`; the preset is still offered with the same disclaimer. |
| **Error** | `ErrorState variant="network"` with retry, replacing the terms card only. The header (name, and the rate if already cached) stays — a failed history read must never make the current rate look unknown. |
| **Offline** | `OfflineBanner` above the header. The document reads from cache in full. The change footer is disabled with "You're offline — this'll save when you're back." No terms write is ever queued optimistically: an arrangement that appears to be saved and is not is a wage dispute with a timestamp. |
| **Submit refused** | Inline error inside the review sheet, never a toast (GOLDEN #40), and every typed field survives — the existing `ClockOutSheet` discipline (`PayChangeSheet.tsx:15` documents it; keep it). |
| **Ack write fails** | The button returns to its unpressed state with an inline error. Never optimistic: "seen" is a legal-ish fact about a person and must not be claimed before the server has it. |
| **Terms just agreed** | Accepting a proposal no longer `replace`s straight to My pay / Pay & terms. The same screen swaps to a `MomentCard` naming the counterparty, the rate, and the start date (§9.1). The CTA then continues to the role's terms surface. A failed accept never shows it. |

---

## 15. Copy tone

- **Facts about the agreement, never verdicts about a person.** "Not seen yet",
  never "Marisol hasn't confirmed". "$28.00 → $30.00", never "You gave Marisol a
  raise".
- **Null is a sentence, not a gap.** "No cancellation pay" is an agreement
  (`termRows.ts:121`); "Not set" is the absence of one. Never conflate them, and
  never nag about either (T16).
- **Never a fabricated figure.** No `$0.00` for an unset term, no weekly
  equivalent without a guarantee, no gross for a week that cannot be priced.
- **Say the number, then say what it is** — `screens-hours.md` §8's rule, same
  here: "$30.00" then "/hr", not "Hourly rate: $30.00" as a headline.
- **Sentence case everywhere. Tabular everywhere a figure appears**, including
  the collapsed group summaries, since they form a right-aligned column.
- **No reassurance copy.** Not "Don't worry", not "You're all set!", not "Great
  choice". The one place warmth is allowed is the appreciation line on an
  approved week, which lives on the Hours screen and is already the best string
  in the app.
- **en-US throughout**: `$`, `Aug 10, 2026`, `Jan 1 – Dec 31`, "vacation" only
  if a state statute uses it (this build says "paid time off"), "workweek" as
  one word when naming the FLSA concept.

**Voice:** `docs/design/screens-today.md` section 7 governs all copy in this screen, including the milestone-tier tables.

---

## 16. Blast radius

**New components** (`apps/mobile/src/domains/pay/components/`):
**`PayTermsForm.tsx`** (§4 — the shared three-mode form; 3-O reuses this exact
component and `screens-onboarding-terms-proposal.md` names it too — one
contract, not two forms), `TermGroup.tsx`, `EffectiveDateField.tsx`,
`TermsChangeReviewSheet.tsx`, `AffectedWeeksTable.tsx` (§7.4, rendered in both
the parent's review sheet and the nanny's ack sheet), `PresetConfirmSheet.tsx`,
`TermsDocument.tsx` (the shared header + groups + history, rendered by both role
screens), `TermsHistoryList.tsx`, `AckCard.tsx`, `DissentSheet.tsx` (§8.3.1,
if the owner takes it).

**Rewritten**: `PayArrangementScreen.tsx`, `MyPayScreen.tsx`,
`PaySetupScreen.tsx`; `PayChangeSheet.tsx` becomes a screen and is renamed.

**New utils**: `utils/termsDiff.ts` (`buildTermsDiff`,
`buildTermsChangeConsequence`), `utils/presets/` (the data files),
`utils/weeklyEquivalent.ts` (formatting only — the figure is server-computed).

**Changed utils**: `payArrangementForm.ts` (en-US date order; `isMonday` →
`isWeekStart`; future-date bound replaces the future-date refusal;
`defaultCancellationChoiceFromHouseholdWindow` **deleted**, §4.1.1),
`termRows.ts` (grows to the full term set and gains group keys).

**Deleted — the household cancellation window** (T14, §4.1.1): the field and its
save-diff in `ManageHouseholdScreen.tsx:179, 271–272`; the
`householdCancellationDefaultHours` prop chain through
`PayArrangementScreen.tsx:109, 127, 298–299, 425–426`,
`PaySetupScreen.tsx:90–91, 138–148` and `PayChangeSheet.tsx:67, 109, 173–181`;
the third fallback arm in `shiftChangeRequestCommandService.ts:176–192`; and
`cancellation_paid_within_hours` on `household.schema.ts:94, 110`. The column
stays in the table (nothing is dropped mid-build) and simply loses every
reader — 041:104 already flags it deprecated.

**Timesheet domain** (the "why", 3-U2): `WeekEarningsLine.tsx`
(`earningsStructureLine`), `EarningsBreakdownSheet.tsx` (glossary hooks + terms
clauses), `ApproveWeekDialog.tsx` (fast path), `AmountRow.tsx`
(`onLabelPress`), new `TermsGlossarySheet.tsx`.

**Server**: `pay_arrangement_acks` migration (with §8.3.1's `kind` column) +
endpoints; the new arrangement columns per §3, including §3's three-value
seventh-day shape; `weekly_equivalent_minor` on the arrangement response (one
call); the §7.4 backdated-reduction
comparison (re-price each affected unapproved week both ways);
`nothing_unusual` on the week earnings response (§11.1.1); the preset data
files.

**New push types**, each needing a `PUSH_NOTIFICATION_TYPES` entry, an
audience-map row (A11's map is total — a missing row fails typecheck), a prefs
group, and a route-map target: `pay_terms_backdated` (§7.4),
`pay_terms_scheduled_change_cancelled` (§6.1), and the parent-facing dissent
notice (§8.3.1). All three are additive and none is quiet-hours exempt. These
belong in `attention-and-notifications.md`'s matrix — **cross-spec: that doc
owns the matrix rows, this one owns the copy.**

**Exports** (3-U3, §12): nanny per-week and per-year pay record; week CSV gains
the hour-class columns and pay-period grouping; year-end per-employee totals.

**i18n**: every new key in `en/pay.json` **and** `es/pay.json`, plus
`hours.json`'s `glossary.*` in both. Tests cannot catch a missing key (`t()`
echoes keys under test) — this is a manual sweep, per §0.6.

**Cross-slice dependencies to schedule around**:
`isWeekStart` needs 3-E1's `households.week_starts_on`; the overtime group's
daily/double-time and seventh-day fields need 3-E2's columns and §10.1's
non-duplication invariant; the holidays group needs 3-E4; §12's exports are
3-U3; the preset library's content needs a human reviewer before any of it
ships; 3-O consumes `PayTermsForm` unchanged.

---

## Persona review

Marisol and David reviewed this spec in role (§2c definitions). Every point is
folded or rebutted below; nothing was dropped silently. **Four points conflict
with or extend a §5 decision and are folded as flagged recommendations — the
owner decides, and until then §5 governs.**

### Marisol (nanny, Austin, TX)

| # | Point | Verdict | What changed |
|---|---|---|---|
| M1 | **Walk-away.** A backdated rate or guarantee cut lands in an already-worked unapproved week; she gets a figure-less push and an ack button. "If the app can compute the parent's consequence line it can compute mine." | **Fold** | New **§7.4**. A backdated *reduction* is detected server-side (re-price each affected unapproved week both ways), pushes as its own `pay_terms_backdated` type naming that it reaches back, and renders an affected-weeks before → after table — the **same table, same figures** — in both the parent's review sheet and her ack sheet. Approved weeks excluded (frozen). A backdated raise gets none of it. |
| M2 | **Walk-away.** The spec never says whether a household's second carer can read her rate. | **Fold** | New **§13.1**, stated in those words: a carer reads her own arrangement and no one else's; parents read all; helpers none; enforced server-side in RLS *and* service scope, not by a client filter. Cites D-21 and P4/P8. |
| M3 | The ack ships with no voice — add "I don't agree with this", dated, blocking nothing, same release as the ack. | **Fold, flagged — extends D-31** | New **§8.3.1**. Second ghost action beside the ack; `pay_arrangement_acks` gains a `kind in ('seen','disagreed')` discriminator and an optional note; unique key gains `kind` so both facts can coexist. Blocks nothing, gates nothing, cannot deadlock (unlike a queried week, P2). Parent sees a `declined` pill, "Disagreed Aug 11", which outranks "Seen". Argued for shipping with the ack rather than waiting for 3-O. |
| M4 | A cancelled scheduled change must be announced as such, not as a generic `pay_terms_set`. | **Fold** | New **§6.1**. New push type `pay_terms_scheduled_change_cancelled` with its own copy ("The new rate that was set to start Sep 1 isn't happening"). Also covers the edit case and refuses cancellation of an already-effective change. |
| M5 | No self-serve pay stub — a record she can only get by asking her employer is not her record. | **Fold** | New **§12.1**. Nanny-generated, from My pay, no ask: per-week document with hours split by class, gross, mileage and stipends tagged "paid outside wages", paid-against and balance; year mode with YTD. Frozen snapshots only, refuses unapproved weeks, corrections show both rows. Pins D-29 to a surface; built in 3-U3. |
| M6 | The read-only "See what changed" sheet must carry the §7.3 consequence card, not just the diff. | **Fold** | **§8.3** amended. The consequence card and, where it applies, §7.4's affected-weeks table both render in her sheet. Explaining a consequence to only one of the two people it lands on was the defect. |
| M7 | Seen ≠ Agreed — she would fight for it. | **Endorsed** | **§8.2** records the endorsement. The distinction was already this spec's call against D-4's literal wording; her agreement strengthens the flag below rather than changing the design. |
| M8 | The §5.3 duties fork is right. | **Endorsed, then DEFERRED by owner 2026-08-11** | Folded as designed, then cut with the duties question (§5.3). Her endorsement stands on the record. The CA preset is now one set of values (Wage Order 15 — the more protective arm), which is the outcome she would have wanted from the fork in the common case. |
| M9 | The §10 weekly-equivalent fix is right. | **Endorsed** | No change beyond D3/D4 below. |
| M10 | The §8.5 diff history is right. | **Endorsed** | No change. |
| M11 | Add a consequence line under the "No cancellation pay" choice. | **Fold** | **§4.1**. "With no cancellation pay, a shift cancelled at any notice pays nothing," rendered only while that chip is selected, with a note on why this term earns the exception. |

### David (parent, San Jose, CA)

| # | Point | Verdict | What changed |
|---|---|---|---|
| D1 | Show the weekly dollar delta between the two CA arms before the parent picks; record the choice as a dated row both parties read. | **Folded, then DEFERRED by owner 2026-08-11** | Was folded as §5.3.1/§5.3.2 (both figures in the sheet, engine-computed per arm, classification recorded in the history). Cut when the owner cut the duties question — with one CA preset there are no arms to compare and no choice to record. **His dissent stands on the record**: he argued a parent who is not shown the consequence answers the classification again, differently, the first time payroll prices the week. Revisit if the classification question ever returns. |
| D2 | A `seventh_day_overtime` boolean cannot carry CA (1.5× first 8h, 2× beyond). | **Fold** | **§3** field model replaced: `seventh_day_multiplier` + `seventh_day_doubletime_after_minutes`, reusing `doubletime_multiplier` — the same three-value shape as the daily tiers, so 3-E2 implements one pattern. **§4.3**'s switch becomes three fields. A boolean would have underpaid every long seventh day in the one state the preset library exists for. |
| D3 | State the overtime non-duplication invariant as an engine rule with a named test. | **Fold** | New **§10.1**. Rule stated implementably (split the day first, then compute weekly overtime on regular minutes only); named case `'an hour is never both daily and weekly overtime'`; three canonical weeks with hand-checked figures, including the 53h week where daily and weekly reach the same 13 premium hours by different routes. **All worked examples in the spec now use these three weeks.** |
| D4 | Guard the server-computed weekly equivalent against being "simplified" back to client-side `rate × hours`. | **Fold** | **§10** guard note: the refactor is forbidden and the reason belongs in a code comment, because the simplification is only wrong on arrangements *with* overtime and will pass every no-overtime fixture. |
| D5 | The mid-week warning should say the week may not match what payroll computes. | **Fold** | **§7.3**. Appended as the last consequence sentence whenever any consequence renders. Pre-empts the exact moment he described as the point he stops believing the app. |
| D7 | "Same structure as last week" will rarely fire under CA daily overtime — redefine as "nothing unusual this week". | **Fold, flagged — refines D-5** | New **§11.1.1**. Recommended predicate: no edited entries, no off-pattern shifts, no open query, no expenses, no mid-week terms change, and gross within a band of the trailing four-week median. All facts the server already has. Copy changes to "nothing unusual this week" because the claim is broader. If the owner keeps D-5 literally, the structure line still ships and the clause simply fires perhaps one week in four. |
| D8 | §11.1/§11.4's example doesn't sum (41h approved, 50h structure). | **Fold** | **§11.1** and **§11.4** rewritten onto §10.1's 53h week: 53h = 40 reg + 12 OT + 1 DT, $1,680.00, consistent across the structure line, both dialog bodies, and the §12.1 pay record. He is right that examples get implemented literally. |
| D10 | The glossary is overblown; §11.2's captions answer the real question. | **Fold, downgraded** | **§11.3** marked ship-last within 3-U2, with the captions prioritised above it. **Not cut** — D-4 requires a glossary, so the spec reorders rather than contradicting §5. |
| D11 | Launch with CA + generic-federal only; the other states get no preset button. | **Fold — ACCEPTED and gone further, owner 2026-08-11** | **§5.4**. Cut to **one preset**, amending D-7's eleven-jurisdiction list. An interim version required every preset value to be labelled "California defaults"; the owner **reversed that same day** — no user-visible string names a state at all. The values are unchanged; only the labelling is. `reviewed_on` stays as the mechanism for adding jurisdictions later. |
| D12 | Payroll handoff: per-pay-period export with hour classes in separate columns, plus year-end per-employee totals. | **Fold** | New **§12.2**. Pay-period grouping from D-17's frequency/pay-day fields, with weeks still itemised and a header stating overtime is computed per workweek; explicit column list separating daily OT, weekly OT, double time, holiday, holiday premium, PTO, top-up; year-end totals for the FSA / Form 2441 job. Pinned to 3-U3 under D-29. |

### Owner decisions — all resolved 2026-08-11

The four flags raised at the persona gate are closed. None is open.

| Flag | Outcome |
|---|---|
| **"Seen" vs "Agreed" as the terms state word** (§8.2, reads D-4 non-literally; endorsed by Marisol M7) | **Accepted.** Ship "Seen". "Agreed" stays reserved for 3-O proposals where a second party actually accepted. No longer an open question. |
| **The dissent row** (§8.3.1, extends D-31, Marisol M3) | **Accepted as recommended.** Ships with the ack. |
| **Fast-path predicate** (§11.1.1, refines D-5, David D7) | **Accepted as recommended.** "Nothing unusual this week" replaces byte-identical structure. |
| **Preset library scope** (§5.4, David D11) | **Accepted and taken further** — one preset, amending D-7. Labelling reversed by the owner the same day: no state name in any user-visible string (§5.4). |

Two further owner decisions from the same review, applied above and not
previously flagged by either persona:

1. **The duties/classification question is cut** (§5.3) — with §5.3.1's dollar
   delta and the `terms.duties_scope` storage. Deferred, not rejected; David's
   dissent is recorded against D1.
2. **The effective-date pills become one date field** (§7.2) — default today,
   any date selectable, every guardrail unchanged.
3. **No state name in user-facing copy** (§5.4) — the values stand, the label
   goes. Spec prose still documents the CA Wage Order 15 derivation because the
   build needs the legal basis; the UI never shows it.

### Raised and deliberately not designed here

- **The domestic-worker classification** (§5.3). Deferred by the owner on
  2026-08-11 and deliberately not designed around: there is no hidden field, no
  inferred arm, and no copy anywhere that hints at the distinction. If it
  returns, D1 and M8 above are the starting point.
- **3-O overlap.** M8's "disputable classification" and M3's dissent row are both
  weaker forms of what D-35's proposal mechanism does properly. Neither is a
  substitute; both exist because 3-O lands last.
- **Notification matrix rows.** §6.1, §7.4 and §8.3.1 introduce three push types.
  Copy lives here; the matrix rows (audience, timing, quiet-hours stance,
  deep-link target) belong to `attention-and-notifications.md`, which owns that
  table.
