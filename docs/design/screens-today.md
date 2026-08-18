# Today — screen spec (Daylight v2)

Reads with [`01-LAWS.md`](./01-LAWS.md) (rungs L1–L4 and registers 1–4) and
[`00-FOUNDATIONS.md`](./00-FOUNDATIONS.md) (tokens, components). Voice and
copy tone live in [`02-VOICE.md`](./02-VOICE.md).

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
│  │                                    ┌──────────┐ ⚙︎
│  │  [child chips row]                 │ spot art │  104×104, right-aligned,
│  │                                    └──────────┘  state-driven (§6)
│  └────────────────────────────────────────────────
│
│  gap 16
│  PinnedSlot     — attention owner; on an ordinary day the clock (nanny) or
│                   TodayCoverage at default tone (parent / helper). Empty
│                   only for a role with neither: a past-member nanny.
│  L2 slot        — live / clock card
│  feed           — child chips (parent), then moment cards (nanny-joined /
│                   joined-household, first clock-in, first week-approved)
│                   before NeedsAttention, then attention / routine cards.
│                   Moments are never slot occupants.
│  L3 stack       — routine cards, gap 12
│  L4 block       — "Next up", bare ground
└
```

The hero band is not a card. It has no ground of its own, no shadow, no radius —
it is the top of the wash, and the wash is what separates it from the cards
below. That is the Daylight rule applied to a header for the first time.

**The gear at the band's trailing edge** is `SettingsHeaderButton`
(`testID="header-settings"`), passed as `ScreenHeader`'s `trailingAction`.
Since WP-C, Settings is a pushed screen rather than a tab, and this is the
only way into it from Today — so it is navigation chrome, outside Rule H's
three band elements (`01-LAWS.md` §C), and it must survive any rework of this
band.

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

### 3.1 `TodayCoverage` — six states, gap at L1

`apps/mobile/src/domains/today/components/TodayCoverage.tsx` + `useTodayCoverage`.
`loading` renders nothing (screen skeleton carries the slot); `error` is an
`InlineRetry` line (see below); `setup` is an L3 card; `noNeedToday` and
`booked` are bare-ground plan lines; `gap` is the L1 owner. Live is not a
separate card component — it is a `PlanLineView` row that renders
`Card tone="live"` inside the coverage stack (`TodayCoverage.tsx:61–73`).

**`error` — the read that failed.** This surface owns the parent's pinned slot
on an ordinary day, so a silent `null` there is indistinguishable from a quiet
day and reads as reassurance nobody computed
(`docs/CROSS-CUTTING-DEFECT-PATTERNS.md` §B). It renders `InlineRetry`
(`today-coverage-retry`) with `errors:network` and a retry that refetches only
the sources that actually failed — no card, no ground, no attention tone, and
the `footer` still folds in beneath it. `useTodayCoverage` puts error ahead of
loading: a query retrying over a failed attempt is both `isPending` and
`isError`, and checking loading first hides the retry button for good.

**The day bar.** A `SplitTrack` (`today-coverage-day-bar`) at the top of the
plan-lines block in both `booked` and `gap`: today, left to right, as who has
it — `primary` for a nanny, `primaryLight` for parent cover, `warning` for a
gap. Built by `buildDayBar` off the SAME `COVERING_SHIFT_STATUSES` filter as
everything else on this surface, so a pending ask never paints over the gap
that produced it. The plan lines say it in words; the bar says it in a glance.

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
  hundreds — 650 does not typecheck without a cast; see `00-FOUNDATIONS.md` §4).
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

Above both feeds sits `CrossFamilyStrip` — outside the ScrollView's card
column, never a `Card`, and null on the common day. Below it, `PinnedSlot`
holds at most one item, chosen by `resolveSlotOccupant`. Everything named
below that is not the slot occupant renders in the feed at default tone; most
of these cards gate themselves and render `null` on an ordinary day, so the
list is the order they appear in, not the number of cards anyone sees.

**Parent / helper** — hero band, child chips, **nanny-joined moment** (when a
nanny joined in the last 7 days and the parent has not seen it — both sides of
the relationship get a moment, not a push-and-silence), `InviteWaitingCard`
(live household, no active nanny), **`WeeklyHoursNotSetCard`**,
`NeedsAttentionCard`, `PendingOfferCard` (a live offer he wrote),
`TermsProposalCard`, `PendingScheduleCard`, `SendMyTermsCard`,
`EmergencyContactPromptCard`, `ThisWeekCard`, `TodayCoverage` (with
`HandoffChipsCard` folded in as its footer, morning). L1 candidates: uncovered
care (`TodayCoverage` gap), a blocking sent offer, terms awaiting an answer,
inbox. The joined moment is a feed card, never a slot occupant.

On an ordinary day — nothing on the ladder — his slot is not empty: it holds
`TodayCoverage` at default tone (`slotOccupant: 'coverage'`), footer and all,
and the feed mount is skipped. Hers is the clock, his is today's cover; the
one thing he opened the app for should not sit below the week card. The
handoff fold travels with the surface wherever it is mounted, so the chips are
never both folded in and standing alone. The one exception is the `gap` rung,
which stays footerless in the slot (`coverageGap`) with the chips as their own
feed row — a card that loud gets the slot to itself.

**Nanny** — hero band, **no child chips** (the chip row is parent-gated at
`:543`, correct), `JoinedHouseholdCard` (her arrival), first clock-in moment
(on the clock, joined recently, unseen), first week-approved moment (exactly
one of her timesheets is approved, unseen), `NeedsAttentionCard`,
`TermsProposalCard`, `PendingScheduleCard`, **`NoWeekYetCard`**,
`SendMyTermsCard`, `EmergencyContactPromptCard`, `ClockInCard`,
`ThisWeekCard`, `HandoffChipsCard` (evening). L1 candidates: the clock-in
block, overdue clock-out, inbox. Moment cards are feed-only.

`AddMissedHoursCard` and `ThisWeeksShiftsCard` are no longer top-level cards
on either side. They are children of `ThisWeekCard`, which is #9's merge as a
composition: it labels them with one eyebrow and decides which a given viewer
sees (her week is her pay → Hours; his is the plan → Schedule). The nanny-only
children drop for a past member, for the same reason `ClockInCard` does.

**The two schedule-gap cards.** `WeeklyHoursNotSetCard` (parent) and
`NoWeekYetCard` (nanny) are the two halves of one fact: terms are agreed and
no usual week exists. Both live in `domains/schedule/components/`, both are
`Card tone="default"` at L3, both take no props and render `null` on an
ordinary day, and — this is the load-bearing part — **neither is a slot
occupant.** Nothing is blocked and nobody is waiting on a reply, so neither
touches `attentionOwner.ts` or `slotOccupant.ts`: per that module's rule for
the next rung, *a rung that displaces nothing is not a rung, it belongs in the
feed.* Promoting either one would displace an overdue clock-out or an
uncovered child, and neither is worth that.

- `WeeklyHoursNotSetCard` is `InviteWaitingCard`'s successor **in its feed
  slot**: that card hides the instant a nanny is active and this one requires
  it, so the two are mutually exclusive by construction and the parent's eye
  lands in the same place at the same point in the story. It is suppressed on
  the render `NannyJoinedMomentCard` fires — the moment gets that screen to
  itself. Three variants (`setup` / `draft` / `declined`). Dismiss key
  `weeklyHoursNotSet:{householdId}:{carerUserId}:{reason}`, and the reason
  token is the re-arm mechanism: dismissing `none` must not suppress a later
  `declined`, because "you haven't set a week" and "she declined the week you
  sent" are different facts. No time decay — the parent is the only actor
  here, so there is nobody for it to be waiting on. There is no "Not now":
  there are exactly two honest answers to "when does she work?", and the
  ghost button is the second one — it records the dismissal *and* opens the
  one-off shift screen in the same tap.
- `NoWeekYetCard` sits beside `PendingScheduleCard` and is mutually exclusive
  with it (a `pending` pattern is that card's to speak for). It is purely
  informational and **has no "nudge the family" button**, deliberately:
  `attention-and-notifications.md` §2.3(c) already refused a push for this
  exact reason ("a buzz about her employer's inaction is a nudge she cannot
  act on"), and §2.4(a) names the failure mode as "the app manufactured a
  story where I'm flaky". Its CTAs are both `ghost` — a filled plum button is
  the grammar of "you owe someone this", and she owes nobody anything. The one
  that does work is about her **own** availability; the other only hides the
  card. It is gated on **zero shifts assigned to her in the next 14 days**, so
  a household genuinely running on one-off shifts never sees it. Dismiss key
  `noWeekNanny:{householdId}:{weekStartISO}` — hiding it holds for that week
  only, so it reappears at most once a week. It never counts and never
  escalates: the moment it counts it is a grievance meter.

`NannyJoinedMomentCard` forks on the same fact — its `bodyAgreed` used to
promise "She can clock in from her first shift" when there was neither a week
nor a first shift, so an agreed-but-unscheduled relationship now gets
`bodyAgreedNoWeek` and a `ctaSetWeek`. `ThisWeeksShiftsCard`'s empty line forks
by persona and by whether a schedule was ever sent — that line is the
permanent quiet tier, the thing still true once the dismissible card is gone.

**Vocabulary.** "The usual week" stays the in-flow noun. Only the ~6 discovery
strings changed, and they name the *act* ("Set the weekly hours") rather than
the object. Renaming the feature to "weekly schedule" was considered and
rejected: the tab is already called Schedule, so that would put three things
called schedule on one screen, and "weekly" is a lie about the shipped
fortnightly option (`INTERVAL=2`, "Every other week").

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

Full art direction, sizes and prompts in [`03-ART-DIRECTION.md`](./03-ART-DIRECTION.md).
It sits behind the wash's fade and must be a transparent PNG — the wash gradient
passes underneath it.

---

## 7. Voice

Moved to [`02-VOICE.md`](./02-VOICE.md) — it governs copy on every screen, not
just this one. The two Today-specific reference strings that used to be
de-exclaimed here (`schedule:sendSuccessTitle`, `schedule:respond.acceptedToast`)
and the milestone tier tables now live there.
