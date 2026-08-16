# Schedule — screen spec (Daylight v2)

Reads with [`daylight-v2.md`](./daylight-v2.md).

Owners: `apps/mobile/src/app/(private)/(tabs)/schedule.tsx` (role fork),
`src/domains/schedule/components/ScheduleShiftsScreen.tsx`,
`AgendaView.tsx`, `CrossFamilyRhythmView.tsx`, `SchedulePatternBanner`.

---

## 1. Point of view — this screen is the one that is closest to right

Schedule is the app's best-structured surface and the least in need of
reinvention. The `AgendaView` day-group + row model is correct, the decision to
stop letting `SchedulePendingScreen` take over the whole tab
(`schedule.tsx:5–11`) was the right call, and the uncovered row already does the
hardest thing in the product: it names a gap, names its cause, and offers two
different people two different ways to close it.

What it lacks is the same thing Today lacks — **one loudness setting.** A
confirmed shift, a pending shift, a cancelled shift and an uncovered window are
four rows of the same height, in the same 16px radius, differing by a pill and a
3px bar. And it lacks a screen anchor: there is no single figure that says how
much care this week actually adds up to, which is the number a parent opens this
tab to reconcile.

---

## 2. Layout

```
┌ ScreenWash kind="brand"                                    absoluteFill
│
│  ┌ HERO BAND ──────────────────────── no card, on the wash
│  │  H1 "Schedule"                              32/40/600
│  │  Small subtitle                             mutedStrong
│  │  Small lead line                            mutedStrong  ← role-forked
│  │  Small "Week of 10 Aug" mutedStrong         14/21 tabular
│  │  Figure "38h 30m this week"  28/34/700 tabular foreground   ← new anchor
│  └───────────────────────────────────────────────────────
│
│  WeekStrip                        (existing week-strip.tsx)
│  SchedulePatternBanner            (parent/helper only, when a pattern is live)
│  CalendarViewSwitcher             (agenda | rhythm — nanny only for rhythm)
│
│  FlashList: day groups
│     ┌ DayHeader (shared) "Monday · 10 Aug"     DayGroup 17/24/600
│     │                   "Today" chip when isToday
│     │                   "8h 00m"               Figure  tabular   right
│     ├ NowLine                    highlight     (today only, static)
│     ├ L1  uncovered row      surfaceAttention
│     ├ L2  live shift row     surfaceLive          (today only)
│     ├ L3  shift row          card + elevation.row
│     └ L4  resolved row       muted, no elevation
│
│  FAB / footer action: "Add a one-off shift"
└
```

**The week-total anchor is new and it is the highest-value addition on this
screen.** `AgendaView` already computes `totalMinutes` per day header
(`AgendaView.tsx:546–551`), excluding cancelled and declined. Summing those into
a week figure is arithmetic the screen has already done. Put it in the hero band
at `figure` 28/34/700 tabular. A parent reconciling the week against the Hours
tab currently has to add seven day totals by eye.

---

## 3. Row rungs

`AgendaView.tsx` already has the right predicates: `RESOLVED_STATUSES`
(cancelled, declined) and `NEEDS_ACTION_STATUSES` (pending, draft). v2 maps them
onto rungs instead of onto a 3px bar.

| Rung | Row | Ground | Elevation | Time text | Right side |
|---|---|---|---|---|---|
| **L1** | uncovered window | `surfaceAttention` `#F4EADC` | `cardProminent` | `Figure` tabular `foreground` | `pending` pill + inline actions |
| **L2** | shift in progress | `surfaceLive` `#FDF5EF` | `liveCard` | `Figure` tabular | `LiveDot` |
| **L3** | confirmed / pending shift | `card` | `row` | `Figure` tabular `foreground` | `StatusPill` when not confirmed |
| **L4** | cancelled / declined / parent cover | `muted` `#F0E9ED` | none | `Body` `mutedForeground`, strikethrough on resolved | `cancelled` / `declined` pill |

Changes to make:

- **Retire the 3px accent bar** (`AgendaView.tsx:353–368`). It is
  `warningStrong` — a hue the system has now formally decontented for anything
  but non-text marks — and it duplicates what the `pending` pill already says.
  A pending row is distinguished by its pill; that is enough at L3. Removing it
  also removes the `ROW_RADIUS = 16` magic constant at `:55`.
- **Keep the highlight border** on a focused uncovered row (`:234–236`, 2px
  `warningStrong`). It is a transient deep-link focus ring, not a status mark,
  and a ring is the one border Daylight allows for focus.
- Row time text is currently `Body tabular` — keep tabular, promote to `Figure`
  (16/24 tabular in `foreground`) so the time column reads as a column. This is
  a rename at the call site, not a size change; the point is that the *rest* of
  the row stops competing with it.
- Parent-cover rows stay at L4 on `bg-muted` with the "Ali is covering" line —
  correct as built. They carry no `StatusPill` (`:393`) which is also correct: a
  parent covering their own child is not a shift with a status.

### 3.1 The uncovered row at L1

`AgendaView.tsx:228–294`. Structurally right; the fixes are hierarchy and
Rule M:

```
View  rounded-row  p-4  bg-surfaceAttention  + elevation.cardProminent
  Row:  IconChip tone="brand" icon=AlertCircle
        H4 childName                              foreground   13.28:1
        StatusPill variant="pending"  "Needs cover"
  Small "9:00–11:22 AM · a shift was cancelled"   mutedStrong   6.03:1
  gap-2
  Button size="default" variant="default"  "Ask Priya to cover from 9:00"
  Button size="default" variant="secondary" "I've got it"
  Pressable text-primary  "These hours look wrong"
```

- `Body weight="medium"` → `H4` for the child's name.
- `text-muted-foreground` → `text-muted-strong` on the detail line (Rule M —
  `mutedForeground` on `#F4EADC` is 4.84:1, which passes, but the whole tinted
  family moves together and consistency here is worth more than the 0.3).
- Padding `p-3` → `p-4`. An L1 row carrying two buttons and a link at `p-3` is
  cramped against a 20px-radius neighbour.
- Add `elevation.cardProminent`. It is the only row on the screen that lifts.

### 3.2 Day-group header

`DayHeader` (`src/components/ui/day-header.tsx`) is the shared primitive —
`AgendaView` must not inline this markup. `DayGroup` (17/24/600) label on the
left, day total on the right as `Figure`. Two changes: the total gets `tabular`
(it is a column of figures down the page and currently is not), and the header
gets **8px more top padding** — `pt-4 pb-1` is 4:1 asymmetric, which glues each
header to the group above rather than the group below it. Use `pt-6 pb-2`.

Today's header additionally gets a `chipPlum` "Today" pill at
`metadataLabel` — the week strip says where you are, but the list scrolls
independently of it. TestIDs stay on the primitive:
`schedule-day-today-${localDate}` and `schedule-day-total-${localDate}`.

### 3.3 Now-line

The agenda is otherwise nine identical rows. `NowLine`
(`src/components/ui/now-line.tsx`) is a static apricot line inserted into
today's section — after the last shift that has already started, before the
next one; at the top of the section when nothing has started yet. It is
computed once per render from `Date.now()`, the same precedent as `LiveDot`
on a live shift row: **not a ticking clock**, no `setInterval`. One now-line
at most, and none on a week that does not contain today. `AgendaItem` carries
a `now` variant; FlashList `getItemType` / `keyExtractor` treat it like any
other row. TestID: `schedule-now-line`.

The screen hero band also carries a role-forked lead line under the subtitle
(`schedule:lead.nanny` / `schedule:lead.parent`, testID `schedule-lead`).

### 3.4 What a shift row carries

The row is still the same three visual modes (parent-cover / resolved / live)
at the same padding and rungs. What it was missing is **who is with whom**.
A parent opening their week used to see `09:00 – 17:00` and a status pill —
nothing that named the children or the carer.

`ShiftRow` now carries, left to right, without a new query:

- **Time range** — unchanged (`Figure` tabular, struck through when resolved).
- **Child chips** — one `ChildChip` per resolved `shift.shift_children`
  entry, coloured with that child's swatch. `AgendaView` already fetches
  `useChildren` for uncovered rows; it looks up `childrenById` and passes
  `{ id, name, colour }[]`. A shift with no children (or children the map
  cannot resolve) renders no chip row, so the height stays as it was.
- **Carer** — first name, as before, only once the household has 2+
  nanny/helper members. The same gate now also shows a small `PersonAvatar`
  beside the name, coloured from `membersByUserId`. A single-carer household
  still needs neither.
- **Status / live** — `StatusPill` or `LiveDot`, unchanged.

TestIDs: `schedule-shift-children-${id}`, `schedule-shift-avatar-${id}`,
plus the load-bearing set the extraction preserved
(`schedule-shift-${id}`, `-status-`, `-short-notice-`, `-live-`, `-carer-`,
`schedule-parent-cover-undo-${id}`).

---

## 4. Personas

**Nanny.** Lands directly on the calendar (`schedule.tsx:60–62`). Sees her own
shifts across every household she works for, and gets the `rhythm` view
(`CrossFamilyRhythmView`) which parents can never reach. That view's household
colour coding uses `categoryAccent1/2/3` with a neutral fallback past three
(`CrossFamilyRhythmView.tsx:53–56`) — this is register 4 used exactly as v2
intends, and it should stay. Two deltas:

- The rhythm legend dots become `IconChip`-sized (12px dot inside a
  `chipCat*` 24px rounded-cell) so household identity is a chip a reader can
  match, not a 8px dot.
- The AM/PM/Eve column headers are `Caption` today; make them `metadataLabel`
  13/600 so the grid has a spine.

**Parent / helper.** Same calendar, plus `SchedulePatternBanner` above it and
the uncovered-row actions (`showUncoveredActions`). The banner is the screen's
L1 when a pattern is `pending` or `declined`: `surfaceAttention`,
`cardProminent`, `H3` title, filled primary. When the pattern is `accepted` it
drops to L4 — a bare `MetadataLabel` line, or nothing at all. A banner that
announces a settled state every day is the thing that trains people to stop
reading banners.

---

## 5. States

| State | Treatment |
|---|---|
| **Loading** | Hero band and week strip paint immediately. List: three day-group skeletons, each a `DayGroup`-height bar plus two row-height bars — shaped like what arrives. |
| **Empty (no role yet)** | Existing `EmptyState` + `illustrations.emptySchedule` (`schedule.tsx:47–58`), now on a `chipPlum` circle, `H3` title. |
| **Empty (week with no shifts)** | Not a full-screen empty state. Day headers still render for the week (`weekDates` already drives this); each empty day shows a single `Small mutedForeground` "Nothing scheduled" row on bare ground. The week's shape is information. |
| **Away band** | `bg-muted` row, `Body weight="medium" mutedForeground` "Away" + the message. Correct as built (`AgendaView.tsx:658–673`). Add a `Plane` icon in an `IconChip tone="people"` so it is not a grey rectangle among grey rectangles. |
| **Error** | `ErrorState variant="network"` with retry, replacing the list only — the hero band and week strip stay, because they are still true. |

---

## 6. Copy tone

- The uncovered cause always attributes to the event: "a shift was cancelled",
  "Priya declined", "nobody is booked". Never "Priya failed to".
- "Ask Priya to cover from 9:00" — name the person, name the time. The existing
  `cover.askToCover` interpolation already does this; keep it.
- "I've got it" is the parent taking the shift themselves. It is warm, first
  person, and exactly right. Keep it.
- Statuses are sentence case single words: Confirmed, Pending, Declined,
  Cancelled, Short notice.

**Voice:** `docs/design/screens-today.md` section 7 governs all copy in this screen, including the milestone-tier tables.

---

## 7. Illustration

One asset: `schedule-empty` (existing `empty-schedule.png`, restyled to the v2
palette), 240×240pt at `variant="default"`, 160×160pt inline. No hero
illustration on this tab — the week strip and the week figure are the visual
anchor, and a decorative image above a dense list is the thing that pushes the
first real row below the fold.
