# Daylight v2 — the design system

Status: spec. No code in this document has been written. Every change names the
file it lands in.

Scope: light mode only. Dark mode is authored in `palette.ts` and hard-disabled
by `useColorScheme`; it is **out of scope** for v2 and must not be designed here.
Any new palette key still needs a `dark` entry to satisfy the parity test — set
it to the nearest existing dark value and mark it unverified, exactly as the
current file does.

---

## 1. Verdict — evolve

Keep Daylight. The bones are not the problem: the 8pt grid with its deliberate
22px gutter, the 20/16/14/12 radius scale, the Figtree weight-only type ramp,
the opaque pre-mixed surface-tint system, and — most importantly — the
`resolveAttentionOwner` T1 arbitration are all better than most shipping apps
have. Replacing the palette would throw away a working hierarchy engine to fix a
problem the palette isn't causing.

The problem is that **Daylight only has one loudness setting.** Every surface is
a white 20px card, on a warm grey ground, separated by the same shadow, padded
to the same 22px, headed by an 18px semibold title over a 14px muted line. The
one vivid hue in the system — apricot — is correctly reserved for the live
clock, and nothing was ever promoted to take its place for everything else. So
the tinted "attention" ground came out at 10% ochre-in-white (`#F9F3EC`), a 4%
deviation from the card beside it, and the T1 card ended up with a *smaller
title* than the routine card below it (the gap headline rendered `<Body
weight="medium">` — 16/24/500 — while `HandoffChipsCard.tsx` rendered `<H4>` —
18/27/600; fixed in v2, the headline is now `H3` in `TodayCoverage.tsx`). The
user's complaint was literally true and it was measurable.

v2 keeps every Daylight commitment (warm ground, separation by light, sentence
case, tabular figures, apricot-for-live-only, no custom font) and adds the two
things the system never had: **a brand register that is allowed to be loud, and
a four-rung loudness ladder that the T1 arbitration already knows how to drive.**

---

## 2. Colour

### 2.1 What does not change

`background #F5F1F2`, `foreground #2A1F2B`, `card #FFFFFF`, `primary #5B3E5D`,
`highlight #E8823C`, the `gray50–900` plum-tinted ramp, `categoryAccent1–3`,
`border`, `input`, `ring`, `scrim`. Semantic hues `success #4A7A5C`,
`warning #C08A3E`, `destructive #A85145`, `shortNotice #C4693A` keep their
values — they change *role*, not value (see 2.4).

### 2.2 New tokens

All land in `apps/mobile/lib/design-tokens/palette.ts` (`light` block), get a
`PALETTE_CSS_VARS` entry, and are surfaced through `useThemeColors()`. CSS var
names follow the existing kebab convention.

| Key | CSS var | hex | HSL (`css`) | What it is |
|---|---|---|---|---|
| `mutedStrong` | `muted-strong` | `#5F5461` | `291 7% 35%` | Secondary text **on any tinted ground**. See 2.3. |
| `surfaceAttention` *(revalue)* | `surface-attention` | `#F4EADC` | `35 52% 91%` | `mixHex(card, warning, 0.18)` — was `0.10`/`#F9F3EC`. |
| `surfacePositive` *(revalue)* | `surface-positive` | `#E9EFEB` | `140 16% 93%` | `mixHex(card, success, 0.12)` — was `0.08`/`#F1F4F2`. |
| `surfaceCritical` | `surface-critical` | `#F3E7E5` | `9 37% 93%` | `mixHex(card, destructive, 0.14)`. New card tone `critical` (declined / expired / failed). |
| `washPlum` | `wash-plum` | `#DFD8DD` | `317 10% 86%` | Top stop of the screen wash — `mixHex(background, primary, 0.14)`. |
| `successInk` | `success-ink` | `#2F5A42` | `147 31% 27%` | Pill/label text on green fills. |
| `warningInk` | `warning-ink` | `#6E4E1C` | `37 59% 27%` | Pill/label text on ochre fills. |
| `shortNoticeInk` | `short-notice-ink` | `#7E3C1B` | `20 65% 30%` | Pill/label text on terracotta fills. |
| `pillSuccess` | `pill-success` | `#DEE7E2` | `147 16% 89%` | Opaque pill fill. |
| `pillWarning` | `pill-warning` | `#F1E5D5` | `34 50% 89%` | Opaque pill fill. |
| `pillDestructive` | `pill-destructive` | `#EFE0DE` | `7 35% 90%` | Opaque pill fill. |
| `pillShortNotice` | `pill-short-notice` | `#F4E4DC` | `20 52% 91%` | Opaque pill fill. |
| `chipPlum` | `chip-plum` | `#EBE8EC` | `285 10% 92%` | Icon-chip ground, `mixHex(card, primary, 0.12)`. |
| `chipCat1` | `chip-cat1` | `#EDEAEF` | `276 14% 93%` | Icon-chip ground, lavender. |
| `chipCat2` | `chip-cat2` | `#EAEFED` | `156 14% 93%` | Icon-chip ground, sage. |
| `chipCat3` | `chip-cat3` | `#F5ECEE` | `347 31% 94%` | Icon-chip ground, rose. |

**Deliberately not new:** the destructive pill/label ink. `errorInlineText`
`#7A392F` already exists and is the exact value wanted (8.56:1 on card, 6.68:1
on its own fill). Reuse it; do not add a `destructiveInk`.

**Deprecated, not deleted:** `warningStrong #9C6E2E`. It measures **3.77:1** on
the new `surfaceAttention` (it was already 4.07:1 on the old one). It is not
cleared for text anywhere. Its two live call sites —
`AgendaView.tsx:236` (highlight border) and `AgendaView.tsx:366` (3px accent
bar) — are *non-text* uses and may stay. Add a comment on the token saying so.

### 2.3 The `mutedStrong` rule (this is a correctness fix, not a preference)

`mutedForeground #6E6270` is fine on white (5.76:1) and on the plain ground
(5.14:1). It **fails AA for small text on every tinted ground v2 introduces**:

| Pair | Ratio | |
|---|---|---|
| `mutedForeground` on `washPlum` | **4.28:1** | fails |
| `mutedForeground` on live wash `#F3DFD5` | **4.48:1** | fails |
| `mutedStrong` on `washPlum` | 5.32:1 | passes |
| `mutedStrong` on live wash | 5.58:1 | passes |
| `mutedStrong` on `surfaceAttention` v2 | 6.03:1 | passes |
| `mutedStrong` on card | 7.17:1 | passes |
| `mutedStrong` on ground | 6.40:1 | passes |

**Rule M:** any `Small` / `Caption` / `MetadataLabel` that sits on a wash, on
`surfaceAttention`, `surfacePositive`, `surfaceCritical` or `surfaceLive` uses
`text-muted-strong`, not `text-muted-foreground`. On plain `card` and plain
`background`, `mutedForeground` stays. This is one class swap per call site and
it is the price of the wash.

### 2.4 Accent architecture — resolving apricot scarcity

This is the tension the brief names, so it gets an explicit answer. v2 splits
colour into **three registers with disjoint meanings.** A hue may only ever
speak in its own register.

**Register 1 — Brand (plum family). Says: "this is Steadily."**
`primary #5B3E5D`, `primaryLight #7C5A7F`, `primaryDark #40293F`, `washPlum`,
`chipPlum`. Carries: the screen wash, the active tab, primary buttons, link
text, the neutral icon chip. Brand colour never means "something is wrong" and
never means "something is happening" — which is exactly why it is safe to be the
loudest thing on a calm screen. **Today plum is nearly invisible in the app**
(tab icons and two link labels); promoting it is free excitement that costs the
semantic vocabulary nothing.

**Register 2 — Status (semantic family). Says: "here is the state of an
agreement."** `success`/`successInk`, `warning`/`warningInk`,
`destructive`/`errorInlineText`, `shortNotice`/`shortNoticeInk`, and their
`surface*` and `pill*` grounds. Confirmed / pending / declined / short notice /
approved / queried. Never decorative, never a category label.

**Register 3 — Live (apricot). Says: "a person is on the clock right now."**
`highlight #E8823C`, `surfaceLive`, the apricot `liveCard` shadow, the apricot
screen wash, `LiveDot`. **Unchanged and still exclusive.** Apricot appearing
anywhere else remains a defect. Its contrast is 2.53:1 on `surfaceLive` and
2.73:1 on card — it is never text, in any register.

**Register 4 — Category (accents 1–3). Says nothing about state; it is
wayfinding only.** `categoryAccent1 #6A4C77` lavender, `2 #4C7A6A` sage,
`3 #A85E6E` rose, plus their new `chipCat*` grounds. Deployed as **icon-chip
hues keyed to card identity** — schedule things are lavender, hours/money things
are sage, people/handoff things are rose. Because they carry no state claim, a
reader can never be misled by them; they exist so that four white cards are
distinguishable at a squint. This is the Fi move, and it is the cheapest
hierarchy in the whole spec.

The rule that makes this hold: **a card may show at most one register-2 colour
and at most one register-4 colour, and never both a status tint and a category
chip in the same colour family.** If a card is `tone="attention"`, its icon chip
drops to `chipPlum` — the ochre ground is already carrying the message.

### 2.5 Icon-chip contrast

| Icon hue on its chip ground | Ratio |
|---|---|
| `primary` on `chipPlum` | 7.54:1 |
| `categoryAccent1` on `chipCat1` | 6.05:1 |
| `categoryAccent2` on `chipCat2` | 4.20:1 |
| `categoryAccent3` on `chipCat3` | 4.03:1 |

Accents 2 and 3 are below 4.5:1. That is **acceptable for a 16px stroked icon
and forbidden for text** — icons are non-text content under WCAG 1.4.11 and need
3:1, which both clear. Do not put a label in `categoryAccent2` or `3` on its own
chip.

---

## 3. Typography

Figtree Variable stays. It is bundled, centrally applied via
`src/components/ui/typography/factory.tsx`, and covers 300–900; there is no
justification that beats "it already works."

### 3.1 Deltas in `apps/mobile/lib/design-tokens/typography.ts`

| Token | Before | After | Why |
|---|---|---|---|
| `figure` **(new)** | — | `28 / 34 / 700`, tabular | The missing rung. Card-level numbers (a week total inside a routine card, a day total, an amount) have nowhere to live between `h3` 20 and `signature.heroBold` 40. |
| `h3` | `20 / 28 / 600` | `20 / 28 / 700` | T1 card titles. The spec wanted 650 (the variable axis covers it), but RN's `fontWeight` type is a closed union of hundreds — 650 does not typecheck without a cast, so 700 shipped, documented on the token. |
| `metadataLabel` | `13 / 18 / 500` | `13 / 18 / 600`, `letterSpacing: 0.1` | Eyebrows must read as structural, not as faint body. Still sentence case — no uppercase. |
| `timer` | `44 / 48 / 500` | `44 / 48 / 500` | Unchanged. Do not touch it. |
| `signature.heroBold` | `40 / 48 / 600` | `40 / 48 / 700` | It is the Hours screen's anchor figure. At 600 it does not out-weigh an `h1` two lines above it. |

`displayLarge`, `display`, `h1`, `h2`, `h4`, all `body*`, `caption`, `label`,
`button*`, `dayGroup` are unchanged. Add matching entries to
`typographyClasses` (`figure: 'text-[28px] leading-[34px] font-bold'`).

### 3.2 Rules

- **Every figure is tabular.** Timers, hour totals, money, day totals, week
  ranges, clock times in a column. `Figure` and `Timer` already take `tabular`;
  the new `figure` token must default it on in the factory.
- **A title is never smaller than the title of a less important card.** This is
  the rule `CoverCard` breaks today. Enforced by the ladder in §5.
- Sentence case everywhere. `settings.tsx:243` renders `{lang.toUpperCase()}` —
  that is the only UPPERCASE label left in the app and it should become the
  language's own endonym in sentence case (`English`, `Español`).

---

## 4. Surface, elevation, radius, wash

### 4.1 Radius — unchanged

card 20 / row 16 / button 14 / cell 12 / chip 999, in
`apps/mobile/tailwind.config.js`. The one addition: **icon chips use
`rounded-cell` (12px)**, not `rounded-full`. A rounded square reads as a UI
affordance; a circle reads as an avatar, and this app has real avatars
(`person-avatar.tsx`) that must not be confused with a decorative icon.

### 4.2 Elevation — retune, do not extend

`apps/mobile/lib/design-tokens/elevation.ts`. `cardProminent` is currently
`0 2 4 / 0.06` + `0 18 36 -14 / 0.24` against `card`'s `0 1 2 / 0.05` +
`0 10 24 -12 / 0.20`. On device that is not a perceptible tier.

| Style | Before | After |
|---|---|---|
| `card` | `0 1 2 0 ink/0.05`, `0 10 24 -12 ink/0.20` | unchanged |
| `cardProminent` | `0 2 4 0 ink/0.06`, `0 18 36 -14 ink/0.24` | `0 2 6 0 ink/0.08`, `0 24 48 -16 ink/0.34` |
| `liveCard` | apricot `0 1 2 / 0.12`, `0 14 30 -12 / 0.42` | unchanged — it is the only coloured shadow and it stays that way |
| `row` | `0 1 2 0 rgba(0,0,0,0.05)` | `0 1 2 0 ink/0.05` — use the plum-tinted ink like every other style; pure black is a leftover |

No new elevation tier. `cardProminent` stays neutral ink deliberately: a second
coloured shadow would dilute the live signature.

### 4.3 The screen wash — the single biggest visual move

`washGradient()` already exists in `elevation.ts` and already does exactly the
right thing: apricot at 0.16 alpha at the top, fading to 0 at 62%, applied as a
`LinearGradient` over `StyleSheet.absoluteFill` behind the ScrollView
(`TodayScreen.tsx:94–104`). It renders **only when someone is on the clock**, so
for the other 16 hours of the day every screen in the app is flat warm grey.

**Generalise it.** Replace `washGradient(mode)` with:

```
screenWash(mode, kind: 'brand' | 'live') -> { colors: [string, string], locations: [0, 0.62] }
```

- `kind: 'brand'` → `primary` at alpha `0.14` → `0`. Top stop resolves to
  `#DFD8DD` over the ground.
- `kind: 'live'` → `highlight` at alpha `0.16` → `0`. **Byte-identical to
  today's `washGradient` output** — the live signature does not change.

Keep `washGradient(mode)` as a thin `screenWash(mode, 'live')` alias so the
existing Today call site and its tests (`TodayScreen.wash.test.tsx`) keep
passing on the same values.

Then apply the brand wash to **all four tabs**, above the scroll content, behind
the H1. `Today` swaps `brand` → `live` when `useHouseholdIsLive` is true; the
other three never do. Contrast on the top stop: `foreground` 11.29:1,
`mutedStrong` 5.13:1, `primary` 6.80:1.

Blast radius: `elevation.ts`, `TodayScreen.tsx`, `HoursScreen.tsx`,
`app/(private)/(tabs)/schedule.tsx`, `app/(private)/(tabs)/settings.tsx`. Five
files, one new component (`<ScreenWash kind>` in
`src/components/ui/screen-wash.tsx`) so the `LinearGradient` + `absoluteFill` +
`pointerEvents="none"` incantation exists once.

> **Platform note.** `LinearGradient` is not a Reanimated `Animated.View`, so
> `className` on it is permitted — but keep it inline-styled anyway, for the same
> reason the current code does: the colour comes from `useThemeColors()`.

### 4.4 Card tones — before → after

`src/components/ui/card.tsx`. `CardTone` gains one member: `'critical'`.

| tone | ground before | ground after | elevation after | Means |
|---|---|---|---|---|
| `default` | `#FFFFFF` | `#FFFFFF` | `card` | Routine. |
| `attention` | `#F9F3EC` | `#F4EADC` | `cardProminent` | The one thing to do. |
| `live` | `#FDF5EF` | `#FDF5EF` | `liveCard` | Someone is working. Untouched. |
| `positive` | `#F1F4F2` | `#E9EFEB` | `card` | A settled fact. |
| `critical` **(new)** | — | `#F3E7E5` | `card` | Declined, cancelled, expired, refused. Not "urgent" — `attention` owns urgency. |

Still **no borders on cards** and still no accent bar — the removal note in
`card.tsx:22–27` stands, and the 4px-bar rendering defect it documents is real.

---

## 5. The hierarchy law

### 5.1 Four rungs, and what each one is allowed

| Rung | Name | Surface | Title | Body | Action | Icon chip | Cap |
|---|---|---|---|---|---|---|---|
| **L1** | The one thing | `tone="attention"` (or `critical`), `cardProminent` | `H3` 20/28/700 `foreground` | `body` 16/24/400 `mutedStrong` | filled `variant="default"`, full width | `chipPlum` + `primary` icon | **Exactly one per screen** |
| **L2** | Live | `tone="live"`, `liveCard`, apricot wash | `Caption` semibold `highlight` + `Timer` 44 tabular | `Small` `mutedStrong` | `outline` | `LiveDot`, no chip | At most one; can coexist with L1 |
| **L3** | Routine | `tone="default"`, `card` | `H4` 18/27/600 `foreground` | `Small` 14 `mutedForeground` | `ghost` or none | `chipCat*` + accent icon | Unlimited |
| **L4** | Context | no card — bare ground | `MetadataLabel` 13/18/600 `mutedForeground` | `Figure`/`Small` rows on `rounded-row bg-card` + `elevation.row` | text link | none | Unlimited, always last |

**The law:** at most one L1 exists on a screen at a time, and it is chosen by
`resolveAttentionOwner` (`src/domains/today/utils/attentionOwner.ts`) —
already-built machinery with a test-enforced ranking (overdue clock-out >
uncovered care > inbox). A card that loses arbitration passes `demoted` and
renders at **L3**, which is what `tone="default"` already means. v2 changes
nothing about the arbitration; it changes what winning *looks like*, from a 4%
tint shift to a full rung.

**The squint test, stated numerically.** At L1 vs L3 the deltas are: ground
lightness 91% vs 100% (9 points, was 95% vs 100%), shadow opacity 0.34 vs 0.20,
title size 20 vs 18 and weight 700 vs 600, plus a filled plum button that L3
never has. Four channels, not one. At L2 vs L3: apricot ground, apricot shadow,
a pulsing dot, and a 44px tabular timer — the existing four-part chord, retained
verbatim.

### 5.2 Multi-channel, never colour-only

Every state change in the app must move **at least two** of {ground, elevation,
type weight/size, iconography, copy}. This is the rule that already governs the
live chord; v2 extends it to attention and critical. Concretely: `tone` alone is
never enough — a card that goes to `attention` must also raise its title to `H3`
and gain (or promote) an action.

---

## 6. Component restyle specs

### 6.1 `IconChip` — new, `src/components/ui/icon-chip.tsx`

The single highest ratio of hierarchy-per-line-of-code in this spec.

```
28 × 28, rounded-cell (12px), items-center justify-center
background: chipPlum | chipCat1 | chipCat2 | chipCat3   (opaque token, never an alpha class)
icon: lucide, size 16, strokeWidth 2, colour primary | categoryAccent1|2|3
```

Prop: `tone: 'brand' | 'schedule' | 'hours' | 'people'`. Sits as the first child
of a card's title row, `gap-3` to the title, vertically centred on the title's
cap height. Never on an L1 card in a category hue (see 2.4).

Assignments: schedule/shift/calendar → `schedule` (lavender `#6A4C77`);
hours/money/timesheet → `hours` (sage `#4C7A6A`); people/handoff/household →
`people` (rose `#A85E6E`); anything brand-level or L1 → `brand` (plum).

### 6.2 `Card` — `src/components/ui/card.tsx`

- Add `'critical'` to `CardTone`; map to `colors.surfaceCritical` + `elevation.card`.
- Retune `attention` / `positive` grounds per 4.4 (values come from `palette.ts`;
  the component itself only reads `useThemeColors()`, so this is a one-line
  palette change plus one new branch).
- Add an optional `title` + `icon` slot? **No.** Cards compose their own headers
  today and changing that is an L-sized refactor for no hierarchy gain. Call
  sites add `<IconChip>` themselves.

### 6.3 `StatusPill` — `src/components/ui/status-pill.tsx`

Two defects, both real:

1. **Every variant fails AA today.** `success` on `bg-success/15` is 4.10:1,
   `warningStrong` on `bg-warning/15` is 3.87:1, `destructive` 4.35:1,
   `shortNoticeStrong` 4.04:1 — at `text-xs` (12px), which needs 4.5:1. These
   pills are the app's entire vocabulary for "who agreed to what."
2. **Alpha fills are wrong on tinted cards.** `bg-success/15` composites against
   whatever is behind it. A confirmed pill inside a `tone="attention"` card
   currently mixes green into ochre, not into white, so its measured ratio is
   not the ratio anyone computed. GOLDEN-FIXES #19 already says shadowed
   surfaces need opaque backgrounds; the same argument applies here.

Fix — opaque fills, deeper inks:

| variant | fill before | fill after | text before | text after | ratio after |
|---|---|---|---|---|---|
| `confirmed` | `bg-success/15` | `bg-pill-success` `#DEE7E2` | `text-success` | `text-success-ink` `#2F5A42` | **6.25:1** |
| `pending` | `bg-warning/15` | `bg-pill-warning` `#F1E5D5` | `text-warning-strong` | `text-warning-ink` `#6E4E1C` | **6.11:1** |
| `declined` | `bg-destructive/15` | `bg-pill-destructive` `#EFE0DE` | `text-destructive` | `text-error-inline-text` `#7A392F` | **6.68:1** |
| `cancelled` | `bg-muted` | `bg-secondary` `#EDE5EA` | `text-muted-foreground` | `text-muted-strong` `#5F5461` | 6.24:1 |
| `short-notice` / `outside-hours` | `bg-short-notice/15` | `bg-pill-short-notice` `#F4E4DC` | `text-short-notice-strong` | `text-short-notice-ink` `#7E3C1B` | **6.66:1** |

Geometry unchanged: `rounded-chip px-3`, `FILLED_CHIP_PADDING_Y`, `text-xs
font-semibold`, sentence case, `self-start`. Keep it filled — do not outline.

### 6.4 `Button` — `src/components/ui/button.tsx`

Mostly right. Three changes:

- `default` gains a pressed-state ground rather than opacity: `active:bg-primary-dark`
  instead of `active:opacity-90`. Opacity on a plum button over a plum wash
  reads as a render glitch.
- `outline` uses `border-1.5 border-border` `#E5DDE2` — 1.16:1 against the
  card. Move to `border-border-strong` `#D2C5CD` (1.45:1). Still quiet, actually
  visible. Ghost buttons keep their border allowance per the direction.
- `lg` is `native:h-14` (56px) and is the correct size for an L1 primary action.
  Make `size="lg"` the documented default for any L1 card action; `default`
  (48px native) for L3.

`secondary`, `destructive`, `ghost`, `link` unchanged.

### 6.5 `Chip` / `ChipToggle`

The handoff chips (`HandoffChipsCard.tsx:84–87`) are `bg-secondary` unselected,
`bg-primary` selected — that is correct and is one of the few places plum
already earns its keep. Keep it. Add only: selected chips get
`fontWeight: 600` (they currently share `weight="medium"` with unselected), so
selection is weight + fill, not fill alone.

### 6.6 Tab bar — `src/app/(private)/(tabs)/_layout.tsx`

Currently active = `colors.primary` tint, inactive = `mutedForeground`, on the
platform default bar. Add, in `screenOptions`:

- `tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }` — the labels sit at
  the platform default 10/400 and read as an afterthought under a 24px icon.
- `tabBarStyle: { backgroundColor: colors.card, borderTopWidth: 0 }` plus
  `elevation.card` inline — the bar currently sits on a hairline, which is the
  one place in the app a rule survived from the Ledger direction. Separation by
  light, here too.
- Active icon `strokeWidth: 2.25`, inactive `1.75`. Weight, not just hue.

Do **not** add a badge dot to the Today tab. Inbox count already lives in
Settings and a second unread affordance is how a calm app stops being calm.

### 6.7 `WeekStrip` / `WeekNavHeader`

`week-strip.tsx`, `week-nav-header.tsx`. Selected day: filled `bg-primary` pill
with `text-primary-foreground` (9.16:1). Today-but-unselected: `chipPlum` ground
with `primary` numeral (7.54:1). Other days: `mutedForeground` numeral on no
ground. Day-of-week initials at `metadataLabel` 13/600. All numerals tabular.
Chevrons in `WeekNavHeader` need a 44pt hit target — confirm `hitSlop`.

### 6.8 Empty states — `src/components/ui/empty-state.tsx`

Keeps its illustration. Two changes: the illustration gets a **`chipPlum`
circular ground at 1.6× the art's width** behind it so a transparent PNG has
something to sit on instead of floating on grey; and the title moves from `H4`
to `H3` with the description at `body` `mutedForeground`. See
`art-direction.md` for the art itself.

### 6.9 Skeletons — `skeleton-card.tsx`, `skeleton-shimmer.tsx`

`skeletonBase #EFE7EC` → `skeletonHighlight #F9F5F7` is a 3% sweep; on device it
reads as a static grey block. Widen to `skeletonBase #EDE5EA` (`secondary`) →
`skeletonHighlight #FFFFFF`. Shimmer period 1200ms, `easing.inOut`. Critically:
**a skeleton must match the rung it will become** — an L1 skeleton is a tall
tinted block, an L3 skeleton is a white card, an L4 skeleton is two bare rows.
Loading state that lies about hierarchy is why apps feel like they "pop" on load.

### 6.10 `MomentCard` and `ReceiptCard`

Toolkit cards for later streams. Do not invent a third delight surface.

**MomentCard** (`src/components/ui/moment-card.tsx`) — the L1 celebration.
Default-tone `Card`, illustration on a `chipPlum` circle at 1.6× the art
width (same ground as EmptyState), `Achievement` title, `Body`, optional
`Button size="lg"`. Confetti is owned by `useMilestone('moment', key)`.

**ReceiptCard** (`src/components/ui/receipt-card.tsx`) — the calm confirmation.
`Card tone="positive"`, `IconChip tone="hours"` with `CircleCheck`, `H3`
title, optional `Body`, optional `dots` slot. Haptic owned by
`useMilestone('receipt', key)`. New receipts go through this component so
the haptic has exactly one owner.

Motion tiers (`lib/animations/useMilestone.ts`):

| Tier | Haptic (`HAPTIC_PATTERNS`) | Easing | Confetti |
|---|---|---|---|
| `silent` | none | none | no |
| `acknowledged` | `encouragement` | `gentleRise` | no |
| `receipt` | `achievement` | `gentleRise` | no |
| `moment` | `milestone` | `celebrationPop` | yes (off under reduced motion) |

`useMilestone` fires the haptic once per key (module-scope set) and returns
`{ easing, showConfetti }`. A `null` key or the `silent` tier fires nothing.

### 6.11 Shape primitives — `src/components/ui/`

Presentational week/day chrome. No queries, no mutations, no domain imports,
no elevation, no `Animated.View`. Later streams compose them; this stream
only lands the primitives.

| Component | File | What it is |
|---|---|---|
| `WeekBars` | `week-bars.tsx` | 7-bar minutes chart. `dayMinutes` / `todayIndex` are Postgres dow (0=Sunday); `weekStartsOn` rotates display via `getWeekdayOrder` (same helper as `WeekStrip`). A zero day still paints a stub. Today is `primary`; other days `muted` / `border`. One accessibility label summarises the week. |
| `SplitTrack` | `split-track.tsx` | Horizontal bar split by `flex: value`. Caller supplies every hue. Renders nothing when the total is 0. |
| `WeekDots` | `week-dots.tsx` | 7 dots, filled `primary` for days with hours. Same dow / week-start contract as `WeekBars`. |
| `NowLine` | `now-line.tsx` | Static "you are here" marker: a dot, a hairline rule, a tabular `Small` label. No timer. |
| `DayHeader` | `day-header.tsx` | Agenda day-section header. Keeps `schedule-day-today-${localDate}` and `schedule-day-total-${localDate}` so the later swap does not break existing tests. |

---

## 7. Motion

No new dependency; `lib/animations/` already has `StaggeredFadeIn`,
`MaybeStagger`, `AnimatedPressable`, `easing.ts`, and `useReducedMotion`.

| Where | What | Notes |
|---|---|---|
| Card list entrance | `StaggeredFadeIn`, 40ms step, 8px rise, capped at 5 children | Today and Hours only. Never on a list that refetches often — a stagger that replays on every poll is nausea. |
| L1 promotion | Ground cross-fade 240ms `easing.out`; **no scale, no bounce** | A card that becomes the one thing to do should settle, not pounce. |
| `LiveDot` | Existing pulse. Unchanged. | |
| `Timer` | Digits do not animate. | A ticking number that also animates is unreadable, and this one is a pay record. |
| Week total figure | Count-up on week change, 400ms, tabular so width never shifts | Hours only. The one moment delight is free. |
| Press | `AnimatedPressable` `scaleIntensity="standard"` + `haptic="light"` | Already correct everywhere it is used. |

Every one of these is gated by `useReducedMotion()`.

---

## 8. What v2 explicitly does not do

- No dark mode.
- No new font.
- No `shadow-*` Tailwind class. Elevation stays inline via `useElevation()`.
- No card borders, no list hairlines, no accent bars.
- No apricot outside register 3.
- No IA change. Four tabs, same routes.
- No `className` on any Reanimated `Animated.View`.
- No literal hex in a `className` — every colour above ships as a CSS var.
