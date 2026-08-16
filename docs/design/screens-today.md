# Today — screen spec (Daylight v2)

Reads with [`daylight-v2.md`](./daylight-v2.md). Rungs L1–L4 and registers 1–4
are defined there.

Owner: `apps/mobile/src/domains/today/components/TodayScreen.tsx` and its cards.

---

## 1. What is on the screen today, and why it reads flat

The reference capture is the parent view at 15:15 on 10 Aug, one household, two
children, one carer who is **not** on the clock. Top to bottom:

1. `H1` "Today" (32/40/600).
2. `Small` muted-strong "Monday 10 Aug · Household 1" (weekday + short month).
3. State-driven spot art (104×104, `heroMood.ts`).
4. Two child chips.
5. `TodayCoverage` gap card at `tone="attention"` — `#F4EADC` ground, `IconChip`
   `tone="brand"`, `H3` 20/28/700 (`coverage.gap.titleOne`: "No one's with
   {{childName}} from {{start}} to {{end}}"), cause lines in `Small` muted-strong,
   filled `lg` cover actions.
6. `TodayCoverage` plan lines beneath — booked / arriving / finished rows on the
   bare ground (a `live` row is its own `tone="live"` card with `LiveDot`).
7. `HandoffChipsCard` — white card, `H4` "Morning handoff", five chips, an
   input, a muted hint.
8. `ThisWeeksShiftsCard` — `MetadataLabel` "Next up", carer name, then a row.

**What shipped fixes the old squint test.** The gap headline is now `H3` at
700 — heavier and larger than the handoff card's `H4` — on the v2 attention
ground (`#F4EADC`, `cardProminent`), with a filled plum button. Anchors:

- `TodayCoverage.tsx:302–304` — `<H3>{gapHeadline}</H3>`
- `TodayCoverage.tsx:292–296` — `IconChip tone="brand"` at L1
- `HandoffChipsCard.tsx:314` / `:175` — `<H4>{titleForPhase(...)}</H4>`
- `palette.ts` — `surfaceAttention` = `mixHex(card, warning, 0.18)` = `#F4EADC`

Secondary problems still visible in the same capture: nothing on the screen is a
*number* (plan-line times are 14px body); and the handoff card can still be the
tallest object when expanded — §3.3 still applies. The brand plum wash is on
every visit now (`ScreenWash kind="brand"`, apricot only while live).

---

## 2. Layout, top to bottom

```
┌ ScreenWash  kind = isLive ? 'live' : 'brand'          absoluteFill, behind all
│
│  22px gutter, SCREEN_CONTENT_STYLE
│
│  ┌ HERO BAND ───────────────────────────── height 148, no card, on the wash
│  │  H1 "Today"                                    32/40/600  foreground
│  │  Small  "Monday 10 Aug · The Ahmeds"           14/21/400  mutedStrong
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

**Date line — as built.** `TodayScreen.tsx:127–135` renders weekday (from the
`schedule` locale bundle) + `formatDisplayDate` + optional household name when
there is nothing to switch between: `Monday 10 Aug · The Ahmeds`. The long
month form (`August`) is deliberately deferred — `MONTH_ABBREVIATIONS` in
`domains/timesheet/utils/week.ts` are unlocalized English abbreviations used
app-wide, so a localized long month beside a localized weekday would mix
registers. Colour: `mutedStrong`, 5.32:1 on the wash top — not
`mutedForeground`, which is 4.28:1 and fails (Rule M).

---

## 3. The same screenshot, rebuilt — how each card now reads

| Rung | Surface | Ground | Elevation | Title | Chip |
|---|---|---|---|---|---|
| **L1** | `TodayCoverage` gap | `#F4EADC` | `cardProminent` | `H3` 20/28/700 | `chipPlum` + `AlertCircle` plum |
| **L2** | `TodayCoverage` live plan line | `#FDF5EF` | `liveCard` | `Body` + `LiveDot` | none |
| **L3** | `TodayCoverage` setup / plan lines | `#FFFFFF` or bare | `card` or none | `H4` / `Body` | `chipCat1` when demoted gap |
| **L3** | `HandoffChipsCard` collapsed | `#FFFFFF` | `card` | `H4` | `chipCat3` rose + `MessageCircle` |
| **L4** | `ThisWeeksShiftsCard` | none | `row` per row | `MetadataLabel` 13/600 | none |

At a squint the L1 card is a warm ochre block with a heavier, larger headline
and a full-width plum button; the two L3 cards are white; the L4 block has no
card at all. **Four visibly different weights instead of one.** Card order is
unchanged — `TodayScreen.cardOrder.test.tsx` still passes.

### 3.1 `TodayCoverage` — five states, gap at L1

`apps/mobile/src/domains/today/components/TodayCoverage.tsx` + `useTodayCoverage`.
`loading` renders nothing (screen skeleton carries the slot); `setup` is an L3
card; `noNeedToday` and `booked` are bare-ground plan lines; `gap` is the L1
owner. Live is not a separate card component — it is a `PlanLineView` row that
renders `Card tone="live"` inside the coverage stack (`TodayCoverage.tsx:61–73`).

Gap card (`TodayCoverage.tsx:277–402`):

```
Card tone={demoted ? 'default' : 'attention'}  p-5.5  gap-3
  Row: IconChip tone={demoted ? 'schedule' : 'brand'} icon=AlertCircle  gap-3
       H3 (or H4 when demoted)
       coverage.gap.titleOne — "No one's with {{childName}} from {{start}} to {{end}}"
  Small  cause lines (schedule bundle)              mutedStrong on attention
  Button size="lg" variant="default" full width     ask-to-cover deep link
  Button variant="secondary"                        parent-cover / "I've got it"
```

As built:
- Gap headline is `H3` 20/28/**700** (RN's `fontWeight` union only accepts
  hundreds — 650 does not typecheck without a cast; see `daylight-v2.md` §3.1).
- Cause lines use `mutedStrong` on the ochre ground (Rule M); demoted gap uses
  `mutedForeground` on white.
- When `demoted` is true: `tone="default"`, `H4`, `IconChip tone="schedule"`
  (`chipCat1`), ghost/sm cover button instead of filled `lg`. One prop, two
  rungs — wired from `TodayScreen.tsx:218` via `resolveAttentionOwner`.
- `setup` / `noNeedToday` / `booked` stay at L3 or bare ground. **Never colour
  an all-covered sentence green**: `success` on `surfacePositive` v2 is 4.26:1,
  under AA.

### 3.2 The plan lines — carer status inside `TodayCoverage`

The separate `NannyLiveStatusCard` this section originally specced was deleted
by the coverage-surface merge (bfde58f): carer status now renders as
**plan lines** inside `TodayCoverage.tsx` (`PlanLineView`) — bare rows on the
ground for `booked` / `arriving` / `finished`, and a full `Card tone="live"`
with `LiveDot` for a `live` row. One surface cannot contradict itself, which
was the point of the merge; the per-row `StatusPill` second channel this
section proposed remains open as a follow-up if the plan lines' wording ever
proves too quiet.

When any row is `live`, the plan line is a live card, the screen wash flips to
apricot, and `ClockInCard`'s 44px timer appears for the nanny. Unchanged — that
chord is the best thing in the app.

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
`PendingScheduleCard`, `TodayCoverage`, `HandoffChipsCard` (morning),
`ThisWeeksShiftsCard`. L1 candidates: uncovered care (`TodayCoverage` gap),
inbox.

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

## 7. Voice

The voice is named, factual, and addressed to the person reading. It may
acknowledge that something finished. It may never grade them on it, tell them
how to feel, or speak about them in the third person on their own screen.

**Still binding.**

- Name people. "Priya arrives at 11:22", not "carer scheduled".
- State facts and consequences, never verdicts about a person.
- No all-clear push. `docs/12-NEED-COVERAGE.md` §5's decision stands: nothing
  uncovered ⇒ silence, not an "all clear". That rule is about notification
  fatigue, not in-app tone.
- Sentence case. Times: `11:22 AM – 7:22 PM`, en dash, tabular.
- The nanny is never third-person on her own screen; the parent is never
  addressed as a manager. No "your staff", no "shift coverage rate", no
  "resource".

**Retired.**

- The blanket ban on acknowledgement. It was written against sentimentality
  and was over-applied to everything, including motion, colour and imagery
  which it never governed. The app may now state that something finished.
- The blanket ban on exclamation marks. One is allowed, in a moment-tier
  title only (Table A). Everywhere else, still none.

**The test that replaces the ban.**

> Say what happened, to the person it happened to, in the order they care
> about it. Never grade them on it.

- Passes: "Aisha worked 41 hours with you this week. Nothing unusual." — a
  fact, addressed to the reader, leading with what she did.
- Fails: "Great job approving on time!" — it grades the reader.
- Fails: "You're covered today · you can breathe" — it tells someone how to
  feel.

**Reference strings** (the only two `"!"` violations in the codebase; a
sibling stream amends them). They are existing confirmations being
de-exclaimed, not moment-tier titles:

- `schedule:sendSuccessTitle` `"Sent!"` → `"Sent."`
- `schedule:respond.acceptedToast` `"Accepted! Shifts have been added to your
  calendar."` → `"Accepted — the shifts are on your calendar."`

`apps/mobile/src/i18n/__tests__/voice-guard.test.ts` (added by that stream)
fails the build on any en/es value containing `"!"` outside a `moments.*`
key.

### Table A — milestone tiers

| Tier | Surface | Haptic | Motion | Confetti | Copy rule |
|---|---|---|---|---|---|
| **silent** | nothing — the screen just updates | none | none | no | no copy |
| **acknowledged** | inline confirmation on the surface that changed, or a toast only once a sheet has closed | `light` | `gentleRise` | no | state the fact in three words or fewer |
| **receipt** | a **persistent** positive-toned card, not a toast that vanishes | `achievement` | `gentleRise` | no | the figure and who it involves |
| **moment** | full-surface: illustration, the `Achievement` type rung, the milestone haptic crescendo | `milestone` | `celebrationPop` | one restrained pass | one exclamation mark permitted in the title |

### Table B — event to tier

| Event | Tier | Why |
|---|---|---|
| Terms agreed (both sides) | **moment** | the most consequential act in the product; today it silently drops you on a settings page |
| Nanny joins the household (BOTH sides) | **moment** | today she gets the best surface in the app and the parent gets a push and silence |
| First clock-in ever | **moment** | once per relationship |
| First week approved | **moment** | once per relationship |
| Later week approvals | **receipt** | the ritual, not the milestone |
| Week closed (her last scheduled shift has ended) | **receipt** | she has no submit act by design, so this is her closing beat |
| Clock-out | **receipt** | already built this way |
| Terms read / disagreement recorded / entry voided / correction saved / query sent | **acknowledged** | the write already happened; name it once |
| Everything else | **silent** | the screen updating is the confirmation; do not invent a beat |

Only four events ever reach moment tier and three of them happen once per
relationship — the confetti works precisely because it is almost never spent.
