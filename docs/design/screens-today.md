# Today — screen spec (Daylight v2)

Reads with [`daylight-v2.md`](./daylight-v2.md). Rungs L1–L4 and registers 1–4
are defined there.

Owner: `apps/mobile/src/domains/today/components/TodayScreen.tsx` and its cards.

---

## 1. What is on the screen today, and why it reads flat

The reference capture is the parent view at 15:15 on 10 Aug, one household, two
children, one carer who is **not** on the clock. Top to bottom:

1. `H1` "Today" (32/40/600).
2. `Small` muted "10 Aug · Household 1".
3. Two child chips.
4. `NannyLiveStatusCard` — white card, grey 8px dot, `H4` "H1 Nanny1", `Small`
   muted "Due 11:22 AM–7:22 PM".
5. `CoverCard` at `tone="attention"` — `#F9F3EC` ground, `Body weight="medium"`
   "H1 Child1 isn't fully covered", `Small` muted window line.
6. `HandoffChipsCard` — white card, `H4` "Morning handoff", five chips, an
   input, a muted hint.
7. `ThisWeeksShiftsCard` — `MetadataLabel` "Next up", carer name, then a row.

**Why it is hard to know what to focus on.** The screen's most consequential
statement — a child is not covered right now — is set in **16px medium** on a
ground that is 4% off white, while the least consequential card on the screen
("Morning handoff") is set in **18px semibold** on pure white and is by far the
tallest, busiest object in view. The eye goes to the handoff card because it is
big and full of chips. Anchors:

- `CoverCard.tsx:130` — `<Body weight="medium">{title}</Body>`
- `HandoffChipsCard.tsx:314` / `:175` — `<H4>{titleForPhase(...)}</H4>`
- `palette.ts:124` — `surfaceAttention` = `mixHex(card, warning, 0.10)` = `#F9F3EC`

Secondary problems visible in the same capture: nothing on the screen is a
*number* (the two times are 14px muted body); the grey dot beside "H1 Nanny1"
carries state that nothing else repeats, so it is colour-only; and the whole
screen is one flat field because the wash only exists while someone is clocked
in.

---

## 2. Layout, top to bottom

```
┌ ScreenWash  kind = isLive ? 'live' : 'brand'          absoluteFill, behind all
│
│  22px gutter, SCREEN_CONTENT_STYLE
│
│  ┌ HERO BAND ───────────────────────────── height 148, no card, on the wash
│  │  H1 "Today"                                    32/40/600  foreground
│  │  Small  "Monday 10 August · The Ahmeds"        14/21/400  mutedStrong
│  │                                    ┌──────────┐
│  │  [child chips row]                 │ spot art │  104×104, right-aligned,
│  │                                    └──────────┘  state-driven (§6)
│  └────────────────────────────────────────────────
│
│  gap 16
│  L1 slot        — attention owner, or nothing
│  L2 slot        — live / clock card
│  L3 stack       — routine cards, gap 12
│  L4 block       — "Next up", bare ground
└
```

The hero band is not a card. It has no ground of its own, no shadow, no radius —
it is the top of the wash, and the wash is what separates it from the cards
below. That is the Daylight rule applied to a header for the first time.

**Change to the date line.** It currently reads `10 Aug · Household 1`
(`TodayScreen.tsx:123–129`). Make the weekday explicit and the household
possessive: `Monday 10 August · The Ahmeds`. A screen called Today should say
which day it is without the reader counting. `formatDisplayDate` already exists;
this is a format string change in `domains/timesheet/utils/week.ts` plus the
`today` locale bundle. Colour: `mutedStrong`, 5.32:1 on the wash top — not
`mutedForeground`, which is 4.28:1 and fails (Rule M).

---

## 3. The same screenshot, rebuilt — how each card now reads

| Rung | Card | Ground | Elevation | Title | Chip |
|---|---|---|---|---|---|
| **L1** | `CoverCard` uncovered | `#F4EADC` | `cardProminent` | `H3` 20/28/650 | `chipPlum` + `AlertCircle` plum |
| **L3** | `NannyLiveStatusCard` (not live) | `#FFFFFF` | `card` | `H4` 18/27/600 | `chipCat3` rose + `User` |
| **L3** | `HandoffChipsCard` collapsed | `#FFFFFF` | `card` | `H4` | `chipCat3` rose + `MessageCircle` |
| **L4** | `ThisWeeksShiftsCard` | none | `row` per row | `MetadataLabel` 13/600 | none |

At a squint the L1 card is a warm ochre block with a heavier, larger headline
and a full-width plum button; the two L3 cards are white; the L4 block has no
card at all. **Four visibly different weights instead of one.** Card order is
unchanged — `TodayScreen.cardOrder.test.tsx` still passes.

### 3.1 `CoverCard`, uncovered — the L1 spec

`apps/mobile/src/domains/today/components/CoverCard.tsx:123–182`.

```
Card tone={demoted ? 'default' : 'attention'}  p-5.5  gap-3
  Row: IconChip tone="brand" icon=AlertCircle   gap-3
       H3  "Ayla isn't covered right now"           foreground   13.28:1
  Body 16/24/400  mutedStrong                                     6.03:1
       "9:00–11:22 AM · a shift was cancelled"
  Button size="lg" variant="default" full width
       "Find cover"   → openSchedule()      (existing handler, unchanged)
```

Changes from current:
- `Body weight="medium"` → `H3`. **This one line is the largest single fix in
  the audit.**
- Window lines `text-sm text-muted-foreground` → `text-sm text-muted-strong`
  (Rule M).
- Add the explicit button. The card is a `Pressable` today, so the whole card
  taps through — but a tappable card with no visible affordance is not an
  action, it is a rumour. Keep the outer `Pressable` for the large target and
  add the button as the visible promise.
- Title copy: the current `cover.uncovered.titleOne` reads "H1 Child1 isn't
  fully covered". Drop "fully" — it hedges. If part of the window is covered the
  detail line already says which part.
- When `demoted` is true the card renders at L3: `tone="default"`, `H4`,
  `mutedForeground`, ghost link instead of the filled button, `chipCat1` in
  place of `chipPlum`. One prop, two rungs.

The `covered` / `noNeedToday` / `setup` states stay where they are —
`covered` at `tone="positive"` on the new `#E9EFEB` (13.55:1 for ink), the other
two at L3. **Never colour an approved/covered sentence green**: `success` on
`surfacePositive` v2 is 4.26:1, under AA.

### 3.2 `NannyLiveStatusCard` — L3 when nobody is live, L2 when someone is

`apps/mobile/src/domains/today/components/NannyLiveStatusCard.tsx`.

The state dot (`:89–93`) is currently the only carrier of `finished` /
`arriving` / `scheduled`. That is colour-only, and two of the three hues
(`success`, `warning`) are not cleared for text so nothing else can repeat them.
Give each row a **second channel**: a `StatusPill` in the matching variant.

```
Row: [dot 8px]  H4 carer name          [StatusPill]
     Small  detail  mutedForeground
```

| kind | dot | pill variant | pill label |
|---|---|---|---|
| `live` | `LiveDot` (apricot) | none — the whole card is `tone="live"` | — |
| `arriving` | `warning` | `pending` | "Arriving" |
| `finished` | `success` | `confirmed` | "Finished" |
| `scheduled` | `borderStrong` | `cancelled` (neutral) | "Scheduled" |

And make the time a figure, not prose. `Due 11:22 AM–7:22 PM` at 14px muted is
the single most-checked fact on this card and it is styled like a footnote.
Set the detail line to `Figure` (16/24, tabular) in `foreground`, with the word
"Due" dropped to a `metadataLabel` prefix. Tabular matters: these times sit in a
column when there are two carers.

When any row is `live`, the card already flips to `tone="live"`, the screen wash
flips to apricot, the shadow goes apricot and `ClockInCard`'s 44px timer appears
for the nanny. Unchanged — that chord is the best thing in the app.

### 3.3 `HandoffChipsCard` — L3, and smaller than it is

Collapsed (`:313–331`) this is right: `H4`, a one-line summary, a ghost "Add a
note". Expanded (`:173–222`) it becomes the tallest object on the screen and
outranks the L1 card by sheer area. Two changes:

- Add `IconChip tone="people"` to the title row so it reads as *its* card and
  not as the screen's subject.
- **Cap the expanded height.** The five suggestion chips wrap to two rows plus
  an input plus a hint plus a button — roughly 280pt. Show the first three chips
  and a "More" chip that reveals the rest. The morning-handoff auto-expand
  (before 10:00, nothing sent) is good behaviour and should stay; it just must
  not be able to become the biggest thing on a screen where a child is
  uncovered.
- Hint text `Tap what your nanny should know` is doing a job the chips already
  do. Delete it when any chip is selected.

### 3.4 `ThisWeeksShiftsCard` — L4, correct as built

`domains/schedule/components/ThisWeeksShiftsCard.tsx`. Bare ground,
`MetadataLabel` eyebrow, `rounded-row bg-card` rows with `elevation.row`, a
`StatusPill` only when the status is not `confirmed`, a text-link CTA. This is
exactly what L4 should be. **Do not touch it**, except:

- `MetadataLabel` picks up 600 weight from the token change automatically.
- The eyebrow reads "Next up" and the carer name renders as a second muted line
  below it (`:134–138`). Merge them: `Next up · Priya`. Two stacked muted lines
  under a 13px eyebrow is three levels of quiet in a row.

---

## 4. Persona differences

`TodayScreen.tsx` already forks on `canViewParentSchedule(onboarding.role)` and
`SETUP_ROLES.NANNY`. The rungs differ, the layout does not.

**Parent / helper** — hero band, child chips, `NeedsAttentionCard`,
`PendingScheduleCard`, `NannyLiveStatusCard`, `CoverCard`, `HandoffChipsCard`
(morning), `ThisWeeksShiftsCard`. L1 candidates: uncovered care, inbox.

**Nanny** — hero band, **no child chips** (the chip row is parent-gated at
`:132`, correct), `NeedsAttentionCard`, `PendingScheduleCard`, `ClockInCard`,
`AddMissedHoursCard`, `HandoffChipsCard` (evening), `ThisWeeksShiftsCard`.
L1 candidates: overdue clock-out, inbox.

`ClockInCard` is the nanny's anchor and is already the best-tuned card in the
app — the off-clock hero is an `H3` invitation, the on-clock state is the
four-part chord, and the overdue state correctly promotes to `attention` with a
filled button and *drops the apricot dot* because apricot means "working", not
"please close this out" (`ClockInCard.tsx:458`). Two v2 deltas only:

- Off-clock: the shift window `H3` "Due 11:22 AM – 7:22 PM" should be tabular.
  It is a time range being read against a clock.
- Overdue at L1: title goes `Caption semibold` → `H3`, matching every other L1.
  Currently the most urgent state the nanny can be in has a 14px title.

**Warmth check.** The nanny's card says "Ready when you are" and "Starting
early? Clock in whenever — we record what happened, not what was planned." That
is the right voice and none of it changes. The parent's L1 says "Ayla isn't
covered right now" — a fact about the schedule, not a verdict about the nanny.
Keep every uncovered-cause string attributing the cause to the *event* ("a shift
was cancelled"), never to a person.

---

## 5. States

| State | Treatment |
|---|---|
| **Loading** | `ScreenWash` + hero band render immediately from local data — the screen title and date need no network. Below it: one L1-shaped skeleton, two L3-shaped skeletons, one L4 row pair. Never a centred spinner on a tab a person opens ten times a day. |
| **Empty (no household)** | `EmptyState variant="inline"`, `illustrations.emptyToday` on a `chipPlum` circle, `H3` title, `body` description. Existing branch at `:211–220`. |
| **Empty (household, quiet day)** | Not an empty state. `NeedsAttentionCard` and `PendingScheduleCard` already render nothing when there is nothing — that decision (`TodayScreen.tsx:147–154`) is correct and must survive. A quiet day is: hero band, cover card at `positive`, handoff at L3, next-up at L4. |
| **Error** | Per-card. A failed shifts query must never blank the hero band or the clock-in button — `ClockInCard` already refuses to gate clock-in on the schedule query (`:560–566`), which is the right instinct generalised: **never let a read failure remove a write affordance.** |
| **Offline** | `OfflineBanner` above the hero band, not floating over it. |

---

## 6. Illustration — the state-driven spot

One asset slot, three variants, 104×104pt at the right of the hero band. It
changes with the day's shape, which is what stops it becoming wallpaper:

| Variant | When | Subject |
|---|---|---|
| `today-quiet` | no carer on the clock, none arriving within the hour | empty armchair, morning light, a mug |
| `today-here` | any `live` row | two abstract figures, one small, at a table |
| `today-done` | all of today's cover is `finished` | the same chair, evening light, a folded blanket |

Full art direction, sizes and prompts in [`art-direction.md`](./art-direction.md).
It sits behind the wash's fade and must be a transparent PNG — the wash gradient
passes underneath it.

---

## 7. Copy tone

- Name people. "Priya arrives at 11:22", not "carer scheduled".
- State facts about the schedule, never verdicts about a person. The existing
  decision to kill "You're covered today · you can breathe" in favour of
  `cover.allCovered` (`CoverCard.tsx:94–98`) was right; do not reintroduce
  reassurance copy.
- Sentence case, no exclamation marks, no emoji.
- Times: `11:22 AM – 7:22 PM` with an en dash and hair spaces, tabular.
- The nanny is never referred to in the third person on her own screen, and the
  parent is never addressed as a manager. No "your staff", no "shift coverage
  rate", no "resource".
