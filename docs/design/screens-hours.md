# Hours — screen spec (Daylight v2)

Reads with [`01-LAWS.md`](./01-LAWS.md) and [`00-FOUNDATIONS.md`](./00-FOUNDATIONS.md).

Owners: `apps/mobile/src/domains/timesheet/components/HoursScreen.tsx`,
`HoursHeroBand.tsx`, `WeekTotal.tsx`, `WeekMoneyCard.tsx`, `NannyWeekView.tsx`,
`ParentWeekView.tsx`, `TimeEntryDayRow.tsx`, `WeekEarningsLine.tsx`,
`PaidStateSection.tsx`.

This is the screen where the app is a record between two parties. Everything
here is judged on whether hours and money are unambiguous, legible, and hard to
misread — warmth is secondary and precision is not negotiable.

> **As shipped (Daylight v2).** The full statement rebuild in §1–§5 landed:
> `HoursHeroBand.tsx` owns the H1, week nav, the 40/48/700 tabular figure,
> a role-resolved lead sentence, a per-day bar chart, a worked-vs-scheduled
> track, and the delta caption; `WeekTotal.tsx` slimmed to the status card only (it
> renders nothing when it has nothing to say about the agreement);
> `WeekMoneyCard.tsx` merges `WeekEarningsLine` and the paid state
> (`PaidStateCard` was renamed `PaidStateSection` — it no longer renders a
> card); `TimeEntryDayRow` is the ledger row with the `editedMarker` key.
> Two content deviations from this spec: the money card keeps "Estimated
> gross"/"Approved gross" (docs/11-MONEY.md requires the state label beside an
> amount), and the rate sub-line renders only when the whole week priced at a
> single rate with no overtime multiplier — a week crossing a raise has no one
> true "× rate", so it is omitted and the breakdown sheet says the rest.

---

## 1. Point of view — `WeekTotal` is a screen wearing a card

This is my one "solving the wrong problem" call, and it belongs here.

`WeekTotal.tsx`'s own module doc lists **eleven conditional bands stacked inside
a single `CardContent`** (`WeekTotal.tsx:68–86`): week nav, carer name row,
status pill row, parent status headline, query note, total + overtime, empty-week
note, approved-appreciation line, earnings line, reopened-reason caption,
approved-lock caption *or* reopen button, pay-boundary explainer, actions note,
primary action, secondary action. Fifteen possible children, all flat siblings,
all separated by `mt-3` / `mt-4`, all inside one 20px-radius white rectangle.

That is not a card. A card is one idea. This is the entire week statement, and
because everything in it is a flat sibling at roughly the same weight, the two
things that actually matter — **the hours figure** and **what state the agreement
is in** — have no more visual claim than the pay-boundary explainer beneath them.
A carer opening this screen to check "did they approve my week and what am I
owed" reads six lines of similarly-weighted text to find out.

**The screen I would build instead: a statement, not a card stack.**

```
HERO BAND     the figure and the agreement state, on the wash, no card
  ─────────────────────────────────────────────
STATUS CARD   L1 or positive — the one thing to do or the settled fact
  ─────────────────────────────────────────────
WEEK CLOSED   nanny receipt — closing beat; no submit act by design
  ─────────────────────────────────────────────
DAY ROWS      L3 — what happened, per day
  ─────────────────────────────────────────────
MONEY CARD    L3 — gross, breakdown link, paid state
  ─────────────────────────────────────────────
EXTRAS        L4 — expenses, reimbursements, export
```

Five blocks, each with one job, in the order a person actually asks the
questions: *how much*, *is it settled*, *from what*, *worth what*, *anything
else*. `WeekTotal` keeps its role as the **status card only** and sheds nine of
its fifteen children to blocks that already exist or are trivially split out.

This is an **L**-sized change and it is the single biggest credibility win
available in the app. Everything else in this document is S or M and can ship
without it.

---

## 2. Layout

```
┌ ScreenWash kind="brand"                                  absoluteFill
│
│  ┌ HERO BAND ──────────────────────────── no card, on the wash
│  │  H1 "Hours"                                     32/40/600
│  │  WeekNavHeader   ‹  10–16 Aug  ›   tabular, mutedStrong, 44pt targets
│  │  [parent] Body  carer name
│  │  Small          lead sentence   hours:lead.nanny | hours:lead.parent
│  │
│  │  SignatureHeroBold  "38h 30m"   40/48/700 tabular foreground  11.29:1
│  │  MetadataLabel      "14m over scheduled"  13/18/600 mutedStrong
│  │  WeekBars           one bar per day, today emphasised
│  │  SplitTrack         worked vs scheduled (omitted when there is no roster)
│  └──────────────────────────────────────────────────────
│
│  gap 16
│  ┌ STATUS CARD ─────────── L1 | positive | default  (WeekTotal, slimmed)
│  ┌ WEEK-CLOSED RECEIPT ─── nanny only (`ReceiptCard`, persistent)
│  ┌ DAY ROWS ────────────── L3  TimeEntryDayRow ×n
│  ┌ MONEY CARD ──────────── L3  WeekEarningsLine + PaidStateCard
│  ┌ EXTRAS ──────────────── L4  expenses, reimbursements, export
└
```

**Week-closed receipt.** There is deliberately no carer-facing submit act
(timesheet.schema.ts PRODUCT DECISION). When her last scheduled shift of the
current week has ended and she has hours on the clock, a persistent positive
`ReceiptCard` (`hours-week-closed-receipt`) sits directly under `WeekTotal` as
her closing beat. It does not fire on an approved week — `WeekTotal`'s
appreciation block already owns that settled fact.

**The figure moves out of the card and into the hero band.** It is the answer to
the question the tab exists for; it does not need a container. At
`signature.heroBold` 40/48/**700** (up from 600) tabular on the wash it reads at
11.29:1 and is unambiguously the largest thing on the screen — which, on a
screen about how many hours were worked, it should be.

**The bars and the track are data, not decoration.**
[`03-ART-DIRECTION.md`](./03-ART-DIRECTION.md) still forbids a hero *image* on Hours:
an illustration beside a number someone is paid on costs credibility. A bar
per day of *her own hours*, and a worked-vs-scheduled track, are the same
record as the figure — they turn the total into a week she can see at a
glance. They do not ship while the week is still loading (the figure slot is
a skeleton; charting a fabricated week would be the same lie as painting
`0m`). `WeekBars` / `SplitTrack` live under the figure; the lead sentence
(`hours:lead.nanny` / `hours:lead.parent`) sits above it.

If the L-sized restructure in §1 is not taken, the minimum viable version is:
**move only the figure and the week nav into the hero band, and leave the rest of
`WeekTotal` as-is.** That is an S change and captures most of the hierarchy win.

---

## 3. The status card (L1 / positive / default)

`weekTotalTone()` (`WeekTotal.tsx:198–206`) already derives the right tone and
its logic is correct — keep it exactly:

| Timesheet status | Viewer | Tone | Rung |
|---|---|---|---|
| `approved` | either | `positive` `#E9EFEB` | settled fact |
| `queried` | either | `attention` `#F4EADC` | **L1** |
| `submitted` | parent | `attention` | **L1** |
| `submitted` | nanny | `default` | L3 |
| open / none | either | `default` | L3 |

What changes is what those tones *look like*, per the v2 ladder:

```
Card tone={weekTotalTone(...)}  p-5.5  gap-3
  Row: IconChip tone="brand"|"hours"
       H3  <the sentence>                            foreground
       [StatusPill]  (nanny viewer only — unchanged)
  Body  <the detail / query note>                    mutedStrong
  Button size="lg" variant="default"  <primary>      (parent: Approve)
  Button variant="ghost"              <secondary>    (parent: Query)
```

- The parent's status headline is a `MetadataLabel` today
  (`WeekTotal.tsx:350–354`) — 13px. **The sentence telling a parent they owe an
  approval is the smallest text in the card.** It becomes `H3`.
- The nanny's `StatusPill` stays for queried / not-submitted / approved-adjacent
  states (P0-5 was right to add it) and inherits the new AA-passing fills —
  `confirmed` is now `#DEE7E2` / `#2F5A42` at 6.25:1, up from 4.10:1.
- **Submitted, nanny viewer: the pill is gone.** "With the family" told her the
  week had left her hands, not whether anyone had opened the hours her rent
  depends on — five minutes and five days read the same. A three-step timeline
  (`hours-status-timeline`) replaces that pill: hours logged (done), opened by
  the household (done when `parent_viewed_at` is set, otherwise the not-opened
  wording), waiting for approval (pending). The parent viewer never sees it —
  they *are* the opening. Queried keeps the pill; approved keeps the
  appreciation block.
- `Approve` at `size="lg"`, full width, `variant="default"`. `Query` as
  `ghost` with `text-destructive` — correct as built.
- Never colour an approved sentence green: `success` on `surfacePositive` v2 is
  4.26:1. Approved sentences are `foreground` on the green ground (13.55:1). The
  ground carries the meaning; the words stay readable.

### 3.1 The appreciation line

`hours-approved-by-note` (`WeekTotal.tsx:392–411`) — "Approved by the Ahmeds on
14 August. £462.00." This is the best-written string in the app and it should be
promoted, not buried as the sixth band. On an `approved` week it becomes the
status card's `Body`, directly under the `H3`, with the amount in `figure`
tabular on its own line. And the existing rule stands and must never be relaxed:
**the money clause is omitted, never fabricated, when the total is not known**
(`docs/11-MONEY.md`).

---

## 4. Day rows (L3)

`TimeEntryDayRow.tsx`. This is a ledger and it must read like one.

```
rounded-row  bg-card  px-4  py-3  + elevation.row   min-height 56
  Left   MetadataLabel  "Mon 11"          13/18/600  mutedForeground
         Figure         "9:02 AM – 5:31 PM"  16/24 tabular  foreground
         Small          "30m break"        14  mutedForeground   (when > 0)
  Right  Figure         "7h 59m"           16/24 tabular  foreground  right-aligned
```

Non-negotiables for this block:

- **Every figure tabular, right edge aligned.** Seven day totals in a column
  that do not share a decimal position is the definition of a number that
  doesn't read as a number.
- A row that is still running shows `LiveDot` + `surfaceLive` ground. Register 3
  is valid here — someone genuinely is on the clock.
- A corrected entry carries a `metadataLabel` "Edited" marker. Who changed a
  recorded hour, and when, is the thing two parties argue about; the record
  should say so on the row, not only in a sheet.
- An approved week's rows lose their press affordance entirely rather than
  showing one that will be refused. `onEditEntry={readOnly ? undefined : ...}`
  already does this (`NannyWeekView.tsx:360`) — keep it, and add a
  `metadataLabel` lock line once per list, not per row (`approvedLockNote`
  already exists at the card level; do not duplicate it down the list).

---

## 5. The money card (L3)

`WeekEarningsLine` + `PaidStateCard`, currently the ninth band of `WeekTotal`
and a separate footer card respectively. Merge into one L3 card:

```
Card tone="default"  p-5.5  gap-3
  Row: IconChip tone="hours" icon=Wallet
       H4  "Estimated" | "Approved"
  Figure  "£462.00"   28/34/700 tabular    ← the amount reads as an amount
  Small   "38h 30m × £12.00"  mutedForeground
  Pressable text-primary  "See the breakdown"     → EarningsBreakdownSheet
  ── (gap-4, no divider) ──
  Small   "Paid £462.00 on 16 Aug"  |  "£462.00 still owed"
```

`docs/11-MONEY.md` governs every figure here. Reimbursements stay in their own
card (they are not wages) — that separation is correct and stays.

The one visual rule this card must obey: **the gross amount and the hours figure
never appear at the same size.** Hours is the hero band at 40; gross is 28. If
they match, a reader glancing at the screen cannot tell which number is money.

---

## 6. Personas

Both roles get the same skeleton; the fork is who acts.

**Nanny** (`NannyWeekView`) — her own week, her own total, her own status
(timeline on a submitted week, pill otherwise), her corrections, her expenses,
her paid state. She never sees an Approve button
and never sees another carer's hours (the `currentUserId` filters at `:282–284`
and `:159–161` fail *closed*, which is the correct instinct for a money screen
and must not be softened). When her last scheduled shift of the current week
has ended and she has hours, the week-closed receipt under `WeekTotal` is her
closing beat — there is no submit button, by design.

**Parent** (`ParentWeekView`) — the carer's name above the figure, Approve and
Query as the card's actions, reopen on an approved week. `readOnly` for helpers
and past members.

**Past member.** `isReadOnly` strips every write. The screen must *say* so
rather than just showing nothing: one `metadataLabel` line under the hero band —
"You're no longer with this household. Your record stays here." Silently
missing buttons reads as a bug on a screen about money.

---

## 7. States

| State | Treatment |
|---|---|
| **Loading** | Hero band paints with the week label immediately (it is derived locally). Figure slot shows a `40×140` skeleton bar, then three day-row skeletons. Never a full-screen spinner — the current `LoadingIndicator` at `HoursScreen.tsx:222–226` blanks the whole tab including the title. |
| **Empty week** | Hero figure shows `0m` in `mutedForeground`, and `hours-empty-week` explains it. Existing behaviour (`WeekTotal.tsx:379–386`) is right; it just moves into the hero band. |
| **Hours error** | `ErrorState variant="network"` + retry replaces the list. |
| **Earnings error, hours OK** | Day rows and the hours figure stay; the money card degrades to a retry line. This split already exists (`NannyWeekView.tsx:268–277`) and is exactly right — **a money read failing must never make the hours look wrong.** |
| **Offline** | Banner above the hero band. Corrections queue; the screen never claims a figure is settled while a write is pending. |

---

## 8. Copy tone

- The weekly approve dialog opens with what she did (`{{name}} worked {{hours}}`), then the figures, then what locks — same data and the same six-way ladder, opposite register.
- Say the number, then say what it is. "38h 30m" then "this week", not "Total
  hours worked this week: 38h 30m".
- Status sentences are written from the reader's side. The nanny's week is "With
  the family", never "Ready for your approval" — `timesheetPillLabel`'s role
  fork (`WeekTotal.tsx:225–239`) already gets this right and is a model for the
  rest of the app.
- Never grade anyone. No "on time", no streaks, no percentage of shifts covered.
  This is a record, not a performance review.
- Amounts always carry their currency symbol and always come from `formatMoney`.

**Voice:** [`02-VOICE.md`](./02-VOICE.md) governs all copy in this screen, including the milestone-tier tables.

---

## 9. Illustration

`empty-hours` only, at `variant="inline"` 160×160pt, for a week with no entries
at all. No hero illustration — on the money screen the figure is the hero, and
an image beside it would be the one place in this app where decoration sits next
to a number someone gets paid on.

That ban is about *images*, not about the week's own numbers. The per-day bars
and the worked-vs-scheduled track in the hero band are the hours themselves,
drawn as a shape. They are the same data as the figure, not a picture next to
it.
