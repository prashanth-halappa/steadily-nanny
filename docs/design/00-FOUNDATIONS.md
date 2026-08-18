# 00 — Foundations

Dated 2026-08-17. The mechanical contract for the Daylight design system: tokens,
the CSS-variable theme, typography, elevation, and the component primitives that
implement them. Pair with [`01-LAWS.md`](./01-LAWS.md) for the hierarchy rules
that decide *which* tier a given surface uses — this doc only says what each
tier *is*.

This absorbs the former `docs/07-MOBILE-UI-SYSTEM.md` and the token/typography/
elevation/component tables that used to be duplicated across `daylight-v2.md`
and four `screens-*.md` files. Where those docs disagreed (the token values
were revalued once, from a v1 spec to what shipped), this doc states the
current, shipped values only — see `git log` on the superseded files for the
diff if you need the history.

Stack: NativeWind 4 (Tailwind for RN), `@rn-primitives/*` (headless accessible
primitives), `class-variance-authority` (CVA) for variants, `clsx` +
`tailwind-merge` for class composition, `lucide-react-native` for icons.

---

## 1. NativeWind 4 + `tailwind.config.js` tokens

NativeWind compiles Tailwind classes to RN styles at build time (wired in
`metro.config.js` via `withNativeWind(config, { input: './global.css' })`, and
in `babel.config.js` via `jsxImportSource: 'nativewind'`). The Tailwind config
defines the **token names**; their **values** come from CSS variables (§2).

Example: `tailwind.config.js` — the token groups that matter:

```js
theme: { extend: {
  fontFamily: { sans: ['Figtree'] },  // Figtree Variable (assets/fonts/Figtree.ttf), one family, weight via fontWeight / font-medium
  fontSize: {              // body min 16px; line-heights ~1.5x; semantic aliases
    base: ['16px', { lineHeight: '24px' }],   // MINIMUM body size
    display: ['32px', { lineHeight: '48px', fontWeight: '600' }],
  },
  spacing: {               // 8pt grid + platform touch target
    1: '4px', 2: '8px', 4: '16px', 6: '24px', 8: '32px',
    touch: '44px',         // iOS minimum touch target
  },
  colors: {                // EVERY color reads a CSS var — never a literal hex
    background: 'hsl(var(--background))',
    primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
    highlight: { DEFAULT: 'hsl(var(--highlight))', foreground: 'hsl(var(--highlight-foreground))' },
    /* … */
  },
  borderRadius: {          // Daylight — soft domestic geometry
    sm: '8px', DEFAULT: '12px', md: '12px', lg: '16px',
    xl: '16px', '2xl': '20px', '3xl': '24px',
    card: '20px', button: '14px', chip: '999px',
    row: '16px', cell: '12px',
  },
  boxShadow: {
    // Still all 'none', deliberately: NativeWind's box-shadow parser is broken
    // (react-native-css-interop 0.2.6 — reads shadowRadius from spread, bails on
    // multi-layer, falls through into aspect-ratio). Elevation lives in
    // lib/design-tokens/elevation.ts as RN inline styles via useElevation().
    sm: 'none', DEFAULT: 'none', md: 'none', lg: 'none', card: 'none', none: 'none',
  },
  borderWidth: { hairline: hairlineWidth(), '1.5': '1.5px' },
}}
```

Conventions baked into the tokens:
- **Spacing is an 8pt grid** — use `p-4` (16px), `gap-6` (24px), not arbitrary values. `touch` (44px) is the minimum tappable size. Screen content gutters are 22px (`SCREEN_CONTENT_STYLE` in `lib/design-tokens/spacing.ts`).
- **Typography minimum is 16px** for body; the scale is semantic (`display`, `caption`, `button`). The app ships one embedded family, **Figtree Variable** (weight axis 300–900), applied centrally by the typography factory (§7) — weight via numeric `fontWeight` / Tailwind `font-*`, never a per-weight `fontFamily`.
- **Soft radii** — `rounded-card` (20px), `rounded-button` (14px), `rounded-row` (16px), `rounded-cell` (12px); `rounded-chip` (999px) is a pill for badges and chips. Icon chips use `rounded-cell`, not `rounded-full` — a rounded square reads as a UI affordance, a circle reads as an avatar, and this app has real avatars (`person-avatar.tsx`) that must not be confused with a decorative icon.
- **Elevation via inline styles, not Tailwind `shadow-*`** — `boxShadow.*` stay `none` because NativeWind cannot parse multi-layer shadows. Use `useElevation()` from `lib/design-tokens/elevation.ts` for plum-tinted card/row shadows; hairline borders (`borderWidth.hairline`) still separate outlined surfaces (§5's exceptions).
- **Palette source of truth** — `lib/design-tokens/palette.ts`; `global.css` mirrors it and is parity-tested.

**A new colour not showing up on device/simulator is (almost) never a stale bundler.** `bun run dev` already runs `expo start -c` — cache-cleared on every launch — and NativeWind's Metro plugin runs the Tailwind CLI in `--watch` mode during dev, pushing a rebuilt `global.css`/`tailwind.config.js` through Fast Refresh automatically (`nativewind/dist/metro/tailwind/v3/child.js` spawns `tailwindcss --watch`; `react-native-css-interop`'s Metro plugin fires a synthetic file-change event on every rebuild — verified by reading both, not assumed). A genuinely stuck HMR socket does happen occasionally; if a new class truly won't appear, a fresh `bun run dev` + simulator relaunch clears it, but check `lib/design-tokens/palette.ts` first — `useThemeColors()`/`useElevation()` read that as plain hex for inline styles, not a Tailwind class, so a token missing there is a wiring gap (see `palette-parity.test.ts`), not a cache.

A skeleton of this config (generic palette, same structure) ships at `pattern/templates/mobile/tailwind.config.js`.

---

## 2. `global.css` — the CSS-variable theme

This is where light/dark actually lives. Colors are declared as **HSL channel triples** (no `hsl()` wrapper) under `:root` (light) and `.dark:root` (dark). The Tailwind tokens wrap them with `hsl(var(--token))`, so a class like `bg-primary` resolves to `hsl(var(--primary))` and automatically flips when the `dark` class is present on an ancestor.

The indirection chain — **why it's worth it**:

```
class `bg-primary`  →  Tailwind token `hsl(var(--primary))`  →  CSS var value (per :root / .dark:root)
```

One `dark` class toggle on a root `<View>` (set in the root layout's themed shell) re-themes the entire app — every component using semantic classes flips, with zero per-component conditional logic. The rules that make this reliable:
- **Always use semantic tokens** (`text-foreground`, `bg-card`, `border-border`) — never literal hex or `text-black`. Literals don't adapt to dark mode.
- Use foreground/background pairs (`bg-primary` + `text-primary-foreground`) so contrast holds in both themes.
- The gray scale is *inverted* in dark mode (`gray-50` is a subtle background in both themes, `gray-900` is strong text in both) so `text-gray-900` / `bg-gray-50` read correctly without conditionals.

**Dark mode is authored in `palette.ts` and hard-disabled by `useColorScheme`.** It has never been designed as a surface and is out of scope for every rule below unless stated otherwise. Any new palette key still needs a `dark` entry to satisfy the parity test — set it to the nearest existing dark value and mark it unverified.

---

## 3. Colour — registers and tokens

### 3.1 Base tokens

`background #F5F1F2`, `foreground #2A1F2B`, `card #FFFFFF`, `primary #5B3E5D`,
`primaryLight #7C5A7F`, `primaryDark #40293F`, `highlight #E8823C`, the
`gray50–900` plum-tinted ramp, `categoryAccent1–3` (`#6A4C77` lavender,
`#4C7A6A` sage, `#A85E6E` rose), `border`, `input`, `ring`, `scrim`. Semantic
hues `success #4A7A5C`, `warning #C08A3E`, `destructive #A85145`,
`shortNotice #C4693A`.

### 3.2 Tinted-surface and pill tokens

All land in `apps/mobile/lib/design-tokens/palette.ts` (`light` block), get a
`PALETTE_CSS_VARS` entry, and are surfaced through `useThemeColors()`.

| Key | CSS var | hex | HSL (`css`) | What it is |
|---|---|---|---|---|
| `mutedStrong` | `muted-strong` | `#5F5461` | `291 7% 35%` | Secondary text **on any tinted ground**. See Rule M, `01-LAWS.md`. |
| `surfaceAttention` | `surface-attention` | `#F4EADC` | `35 52% 91%` | `mixHex(card, warning, 0.18)`. |
| `surfacePositive` | `surface-positive` | `#E9EFEB` | `140 16% 93%` | `mixHex(card, success, 0.12)`. |
| `surfaceCritical` | `surface-critical` | `#F3E7E5` | `9 37% 93%` | `mixHex(card, destructive, 0.14)`. Card tone `critical` (declined / expired / failed). |
| `surfaceLive` | `surface-live` | `#FDF5EF` | `26 78% 96%` | The live-clock tint. |
| `washPlum` | `wash-plum` | `#DFD8DD` | `317 10% 86%` | Top stop of the screen wash — `mixHex(background, primary, 0.14)`. |
| `successInk` | `success-ink` | `#2F5A42` | `147 31% 27%` | Pill/label text on green fills. |
| `warningInk` | `warning-ink` | `#6E4E1C` | `37 59% 27%` | Pill/label text on ochre fills. |
| `shortNoticeInk` | `short-notice-ink` | `#7E3C1B` | `20 65% 30%` | Pill/label text on terracotta fills. |
| `errorInlineText` | — | `#7A392F` | — | Destructive pill/label ink. 8.56:1 on card, 6.68:1 on its own fill. Do not add a second `destructiveInk` token — this is it. |
| `pillSuccess` / `pillWarning` / `pillDestructive` / `pillShortNotice` | `pill-*` | `#DEE7E2` / `#F1E5D5` / `#EFE0DE` / `#F4E4DC` | — | Opaque `StatusPill` fills. |
| `chipPlum` / `chipCat1` / `chipCat2` / `chipCat3` | `chip-*` | `#EBE8EC` / `#EDEAEF` / `#EAEFED` / `#F5ECEE` | — | Icon-chip grounds, `mixHex(card, {primary\|accent}, 0.12)`. |

**Deprecated, not deleted:** `warningStrong #9C6E2E`. It measures 3.77:1 on
`surfaceAttention` — not cleared for text anywhere. Its two live call sites
(`AgendaView.tsx` highlight border and focus ring) are non-text uses and may
stay; the token carries a comment saying so.

### 3.3 Accent architecture — four registers, disjoint meanings

Colour splits into four registers. A hue may only ever speak in its own
register.

**Register 1 — Brand (plum family). Says: "this is Steadily."**
`primary`, `primaryLight`, `primaryDark`, `washPlum`, `chipPlum`. Carries: the
screen wash, the active tab, primary buttons, link text, the neutral icon
chip. Brand colour never means "something is wrong" and never means
"something is happening" — which is exactly why it is safe to be the loudest
thing on a calm screen.

**Register 2 — Status (semantic family). Says: "here is the state of an
agreement."** `success`/`successInk`, `warning`/`warningInk`,
`destructive`/`errorInlineText`, `shortNotice`/`shortNoticeInk`, and their
`surface*`/`pill*` grounds. Confirmed / pending / declined / short notice /
approved / queried. Never decorative, never a category label.

**Register 3 — Live (apricot). Says: "a person is on the clock right now."**
`highlight #E8823C`, `surfaceLive`, the apricot `liveCard` shadow, the apricot
screen wash, `LiveDot`. Exclusive. Apricot appearing anywhere else is a
defect. Its own contrast is 2.53:1 on `surfaceLive` and 2.73:1 on card — it is
never text, in any register.

**Register 4 — Category (accents 1–3). Says nothing about state; it is
wayfinding only.** `categoryAccent1` lavender, `2` sage, `3` rose, plus their
`chipCat*` grounds. Deployed as icon-chip hues keyed to card identity —
schedule things are lavender, hours/money things are sage, people/handoff
things are rose. Because they carry no state claim, a reader can never be
misled by them; they exist so that several white cards are distinguishable at
a squint.

**The rule that makes this hold:** a card may show at most one register-2
colour and at most one register-4 colour, and never both a status tint and a
category chip in the same colour family. If a card is `tone="attention"`, its
icon chip drops to `chipPlum` — the ochre ground is already carrying the
message.

Icon-hue-on-chip contrast: `primary` on `chipPlum` 7.54:1; `categoryAccent1`
on `chipCat1` 6.05:1; `categoryAccent2` on `chipCat2` 4.20:1; `categoryAccent3`
on `chipCat3` 4.03:1. Accents 2 and 3 are below 4.5:1 — acceptable for a 16px
stroked icon (3:1 floor for non-text content under WCAG 1.4.11) and forbidden
for a label in that colour on its own chip.

---

## 4. Typography

Figtree Variable, bundled, centrally applied via
`src/components/ui/typography/factory.tsx` (§7), covering weight 300–900.

| Token | Metrics | Notes |
|---|---|---|
| `displayLarge` | 56/64/800 | Unchanged from v1. |
| `display` | 32/48/600 | |
| `h1` | 32/40/600 | Screen titles. |
| `h2` | 24/32/600 | |
| `h3` | 20/28/**700** | T1 card titles. Spec wanted 650 (the variable axis covers it), but RN's `fontWeight` type is a closed union of hundreds — 650 does not typecheck without a cast, so 700 shipped; documented on the token. |
| `h4` | 18/27/600 | Routine (L3) card titles. |
| `figure` | 28/34/700, tabular | Card-level numbers (a week total inside a routine card, a day total, an amount) — the rung between `h3` 20 and `signature.heroBold` 40. |
| `signature.heroBold` | 40/48/**700** | The Hours screen's anchor figure. At 600 it does not out-weigh an `h1` two lines above it. |
| `timer` | 44/48/500 | Do not touch — this one is deliberately unchanged. |
| `metadataLabel` | 13/18/**600**, `letterSpacing: 0.1` | Eyebrows read as structural, not faint body. Still **sentence case** — never uppercase, and never a section header (`01-LAWS.md` Rule A). |
| `body*`, `caption`, `label`, `button*`, `dayGroup` | unchanged | |

### 4.1 Rules

- **Every figure is tabular.** Timers, hour totals, money, day totals, week ranges, clock times in a column. `Figure` and `Timer` default `tabular` on.
- **A title is never smaller than the title of a less important card.** Enforced by the rung ladder, `01-LAWS.md`.
- **Weight is non-decreasing with importance.** See `01-LAWS.md`.
- Sentence case everywhere. There is no uppercase micro-label style in this system; a language code or any other short label renders as its own endonym in sentence case (`English`, `Español`), never `.toUpperCase()`.

---

## 5. Surface, elevation, radius, wash

### 5.1 Radius

card 20 / row 16 / button 14 / cell 12 / chip 999, in `tailwind.config.js`
(§1). Icon chips use `rounded-cell` (12px), never `rounded-full` (§1).

### 5.2 Elevation — `useElevation()`, not Tailwind shadows

Daylight separates surfaces with soft plum-tinted shadows, never a hairline
border. They cannot live in Tailwind: NativeWind 4 /
`react-native-css-interop@0.2.6` parses `box-shadow` into a single
`shadowColor` + `shadowRadius`, misreads spread as radius, and bails on
multi-layer values. So `tailwind.config.js` keeps every `boxShadow` token as
`'none'`.

Shadows are authored in `lib/design-tokens/elevation.ts` as React Native
`boxShadow` arrays (RN 0.86+, both platforms):

```tsx
import { useElevation } from '~/lib/design-tokens/elevation';

function Card({ style, live = false, ...props }) {
  const elevation = useElevation();
  return (
    <View
      className="rounded-card bg-card"
      style={[live ? elevation.liveCard : elevation.card, style]}
      {...props}
    />
  );
}
```

`useElevation()` returns `{ card, cardProminent, liveCard, row }` — colours
derived from `palette.ts` via `hexToRgba`, so shadows track theme changes.
Current values:

| Style | Layers |
|---|---|
| `card` | `0 1 2 0 ink/0.05`, `0 10 24 -12 ink/0.20` |
| `cardProminent` | `0 2 6 0 ink/0.08`, `0 24 48 -16 ink/0.34` |
| `liveCard` | apricot `0 1 2 / 0.12`, `0 14 30 -12 / 0.42` — the only coloured shadow, deliberately |
| `row` | `0 1 2 0 ink/0.05` — plum-tinted ink like every other style, never pure black |

No coloured shadow beyond `liveCard` — a second one would dilute the live
signature.

**Shadow instead of rule — the inversion that defines this system.** `Card`
carries **no border**. When you need a card surface, use `<Card>` rather than
hand-rolling `<View className="rounded-card border border-border bg-card">` —
a hand-rolled one gets the radius but silently misses the shadow. Rows are the
same story: `rounded-row bg-card` + `style={elevation.row}`, no border.

Two deliberate exceptions, both bordered because the border does a *different*
job: `RoleOptionCard`'s `border-2` is a selection affordance, and form fields
keep their input border. See `01-LAWS.md` for the full list of separation
channels that replace the banned border.

**`live`** swaps the neutral plum shadow for the apricot one. Pass it on
exactly the predicate that drives the Today wash so the card carries the
signal and the wash reads as its echo. `live` is a deprecated alias for
`tone="live"` — new call sites use `tone` directly.

Never merge elevation styles onto a Reanimated `Animated.View` that also
carries `className` (§9).

### 5.3 The screen wash

`screenWash(mode, kind: 'brand' | 'live')` returns
`{ colors: [string, string], locations: [0, 0.62] }`, applied as a
`LinearGradient` over `StyleSheet.absoluteFill` behind the scroll content, via
`<ScreenWash kind>` (`src/components/ui/screen-wash.tsx`).

- `kind: 'brand'` → `primary` at alpha `0.14` → `0`. Top stop resolves to
  `#DFD8DD` over the ground. Applied on all four tabs, above the scroll
  content, behind the `H1`.
- `kind: 'live'` → `highlight` at alpha `0.16` → `0`. The live signature —
  Today swaps `brand` → `live` when `useHouseholdIsLive` is true; the other
  three tabs never do.

Contrast on the top stop: `foreground` 11.29:1, `mutedStrong` 5.13:1,
`primary` 6.80:1.

`LinearGradient` is not a Reanimated `Animated.View`, so `className` on it is
technically permitted — keep it inline-styled anyway, since the colour comes
from `useThemeColors()`.

### 5.4 Card tone tiers — current

`<Card tone="…">` (`src/components/ui/card.tsx`) names the attention tiers so
screens don't reinvent card hierarchy per call site:

| Tone | Ground | Elevation | Means |
|---|---|---|---|
| `attention` | `#F4EADC` | `cardProminent` | The one thing to do (L1). |
| `live` | `#FDF5EF` | `liveCard` | Someone is working, right now (L2). |
| `default` (or omit `tone`) | `#FFFFFF` | `card` | Routine (L3). |
| `positive` | `#E9EFEB` | `card` | A settled fact — a calm confirmation, not an alert, hence the plain `card` elevation rather than `cardProminent`. Use `ReceiptCard` for a new receipt so the haptic has exactly one owner. |
| `critical` | `#F3E7E5` | `card` | Declined, cancelled, expired, refused. Not "urgent" — `attention` owns urgency; see `01-LAWS.md` on why an error state is not a card. |
| *(not a `Card` tone)* `bg-muted` | `#F0E9ED` | none | Present but not asking for attention (L4). |

`tone="attention"` and `tone="positive"` tint with opaque hex, never a
translucent `bg-*/NN` class (a shadow over a translucent ground reads wrong on
device). See `01-LAWS.md` Rule B for what colour the text on these tints may
be.

**`provisional` (WP-K, 2026-08-18)** — `<Card provisional>` swaps the
elevation shadow for a dashed `1.5px` `borderStrong` outline, same radius and
padding otherwise. Dashed = waiting on the other person: an invite nobody has
redeemed yet, an open terms round, a non-blocking pending offer. Composes with
`tone` (the tint still applies underneath the dashed border) — it does not
replace the tone system, it marks a different axis (state of the world vs.
state of urgency).

`Card` has no `accent` prop. It used to draw a 4px inset bar down the card's
left edge; removed after user feedback on device ("you don't need the left
border") and a genuine rendering defect — a 4px-wide element can't carry the
card's own 20px corner radius, so the radius degenerates and the bar poked
past the rounded corners. The tinted ground alone now carries the tier; see
`01-LAWS.md` for the separation channels that replaced it.

---

## 6. Component primitives: `@rn-primitives` + CVA

The `ui/` directory holds design-system primitives. The split:
- **`src/components/ui/*`** — generic, product-agnostic primitives (button, text, card, input, dialog, skeleton…). Built on headless `@rn-primitives/*` (slot, portal, accessible behaviors) + CVA variants. No business logic.
- **`src/components/<area>/*` and `src/domains/<feature>/components/*`** — composed, feature-aware components. These import `ui/` primitives; they never reimplement styling primitives.
- **Shape primitives** — presentational week/day chrome; see §8.6.

### 6.1 `cn` — class composition

`lib/utils.ts` — `clsx` for conditional classes, `tailwind-merge` to dedupe conflicts (last wins):

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 6.2 CVA variant pattern — button

`src/components/ui/button.tsx`. `cva()` declares variant → class maps with `defaultVariants`; `VariantProps` derives the prop types; `cn()` merges caller `className` last so it can override.

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'group flex items-center justify-center rounded-button …',
  {
    variants: {
      variant: {
        default: 'bg-primary active:bg-primary-dark',   // ground shift, not opacity — see §8.4
        destructive: 'bg-destructive active:opacity-90',
        outline: 'border border-1.5 border-border-strong bg-background active:bg-accent',
        secondary: 'bg-secondary active:opacity-80',
        ghost: 'active:bg-accent',
        link: '…',
      },
      size: {
        default: 'h-10 px-4 py-2 native:h-12 native:px-5 native:py-3',
        sm: 'h-9 rounded-button px-3',
        lg: 'h-11 rounded-button px-8 native:h-14',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);
```

Two reusable tricks: a parallel `buttonTextVariants` is pushed through a `TextClassContext` so child `<Text>` inherits the right colour per variant (the typography factory, §7, reads this same context); and the `native:` modifier sets larger touch sizes on device vs web. `size="lg"` (56px native) is the documented default for an L1 primary action; `default` (48px native) is L3.

### 6.3 Typography via a factory

`src/components/ui/typography/factory.tsx`. Instead of hand-writing each heading/body component, a factory turns a token (`size`, `lineHeight`, `weight`) into a component — combining an inline `style` (exact numeric metrics, including `fontWeight`) with a `className` (`text-foreground` for theming), reading `TextClassContext` so it inherits a container's published text colour (§6.2), and supporting `asChild` via `@rn-primitives/slot`:

```tsx
export function createTypographyComponent(token, displayName, options) {
  const baseStyle = tokenToStyle(token);           // { fontSize, lineHeight, fontWeight, letterSpacing }
  return function TypographyComponent({ className, asChild = false, style, ...props }) {
    const textClass = useTextClassContext();
    const Component = asChild ? Slot.Text : RNText;
    return (
      <Component
        style={[baseStyle, style]}
        className={cn('web:select-text', textClass ?? 'text-foreground', className)}
        {...props}
      />
    );
  };
}
```

Consumers import `H1`, `Body`, `Display`, etc. from `@/components/ui/typography`.

---

## 7. ⚠️ THE GOTCHA — never put NativeWind `className` on a Reanimated `Animated.View`

This is the single most important rule in this doc. It causes a silent, hard-to-debug layout bug.

**The problem:** when you apply a NativeWind `className` (e.g. `h-full bg-primary`) to a `Reanimated.Animated.View`, the view **overflows its parent**. Worse, `overflow-hidden` on the parent does **NOT** clip it — the animated child expands past its container and renders as an overlay on top of unrelated UI. (Discovered in a progress/richness indicator where `h-full bg-primary` on an `Animated.View` expanded to fill the entire card.)

**The fix:** style `Animated.View` with an inline `style={{}}` object instead of `className`.

```tsx
// ✅ CORRECT — inline style on the animated view
<Animated.View style={{ height: animatedHeight, backgroundColor: colors.primary }} />

// ❌ WRONG — className on an animated view overflows its parent; overflow-hidden won't save you
<Animated.View className="h-full bg-primary" style={animatedStyle} />
```

Rules of thumb:
- Plain (non-animated) RN components → `className` is fine.
- Any `Reanimated.Animated.*` component → use inline `style`. Resolve theme colors to literal values (e.g. from `useThemeColors()` / `palette.ts` hex projections) and pass them inline, since you can't lean on `bg-*` classes.
- This also applies on the root themed shell: the root layout deliberately avoids most `bg-*`/`shadow` classNames on its wrapper View and uses inline `backgroundColor`, because className + theme toggles can race with the navigation context.
- No automated Biome/CI guard enforces this — it is convention and comments only.

---

## 8. Component tone specs

Retuning and additions on top of the primitives in §6. These are the current,
shipped specs (not a diff from an older version).

### 8.1 `IconChip` — `src/components/ui/icon-chip.tsx`

```
28 × 28, rounded-cell (12px), items-center justify-center
background: chipPlum | chipCat1 | chipCat2 | chipCat3   (opaque token, never an alpha class)
icon: lucide, size 16, strokeWidth 2, colour primary | categoryAccent1|2|3
```

Prop: `tone: 'brand' | 'schedule' | 'hours' | 'people'`. Sits as the first
child of a card's title row, `gap-3` to the title, vertically centred on the
title's cap height. Never on an L1 card in a category hue (§3.3).

Assignments: schedule/shift/calendar → `schedule` (lavender); hours/money/
timesheet → `hours` (sage); people/handoff/household → `people` (rose);
anything brand-level or L1 → `brand` (plum).

### 8.2 `StatusPill` — `src/components/ui/status-pill.tsx`

Filled, opaque fills with deep inks — never an alpha fill (an alpha fill
composites against whatever surface is behind it, so a pill inside a tinted
card mixes into the tint, not into white, and its measured ratio stops
matching what anyone computed):

| variant | fill | text | ratio |
|---|---|---|---|
| `confirmed` | `bg-pill-success` `#DEE7E2` | `text-success-ink` `#2F5A42` | 6.25:1 |
| `pending` | `bg-pill-warning` `#F1E5D5` | `text-warning-ink` `#6E4E1C` | 6.11:1 |
| `declined` | `bg-pill-destructive` `#EFE0DE` | `text-error-inline-text` `#7A392F` | 6.68:1 |
| `cancelled` | `bg-secondary` `#EDE5EA` | `text-muted-strong` `#5F5461` | 6.24:1 |
| `short-notice` / `outside-hours` | `bg-pill-short-notice` `#F4E4DC` | `text-short-notice-ink` `#7E3C1B` | 6.66:1 |

Geometry: `rounded-chip px-3`, `FILLED_CHIP_PADDING_Y`, `text-xs font-semibold`,
sentence case, `self-start`, and a `shrink`/`maxWidth`/`numberOfLines` so a
long label truncates inside its card rather than overflowing it. Filled, never
outlined. `StatusPill` states what *someone else* decided — see `01-LAWS.md`'s
affordance grammar; it is never a control.

### 8.3 `Button`

- `default` uses a pressed-state ground shift, `active:bg-primary-dark`, not
  opacity — opacity on a plum button over a plum wash reads as a render
  glitch.
- `outline` uses `border-1.5 border-border-strong` `#D2C5CD` (1.45:1) —
  `border-border` alone is 1.16:1 against the card, too quiet to read as an
  edge.
- Disabled state is `disabled:bg-muted disabled:opacity-100`, never a flat
  50% opacity dim — opacity on a filled plum button reads as a plausible
  *enabled* lavender secondary, the opposite of what disabled should signal.

### 8.4 `Chip` / `ChipToggle`

Unselected `bg-secondary`, selected `bg-primary` + `text-primary-foreground`
**and** `fontWeight: 600` — selection is weight + fill together, never fill
alone.

### 8.5 Tab bar

`tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }`;
`tabBarStyle: { backgroundColor: colors.card, borderTopWidth: 0 }` plus
`elevation.card` inline — separation by light here too, never a hairline.
Active icon `strokeWidth: 2.25`, inactive `1.75`. No badge dot on any tab —
inbox count lives in Settings, and a second unread affordance is how a calm
app stops being calm.

### 8.6 Shape primitives — week/day chrome

Presentational only. No queries, no mutations, no domain imports, no
elevation, no `Animated.View`.

| Component | File | What it is |
|---|---|---|
| `WeekBars` | `week-bars.tsx` | 7-bar minutes chart. `dayMinutes` / `todayIndex` are Postgres dow (0=Sunday); `weekStartsOn` rotates display via `getWeekdayOrder` (same helper as `WeekStrip`). A zero day still paints a stub. Today is `primary`; other days `muted` / `border`. One accessibility label summarises the week. |
| `SplitTrack` | `split-track.tsx` | Horizontal bar split by `flex: value`. Caller supplies every hue. Renders nothing when the total is 0. Two consumers: `HoursHeroBand` (the week's hours) and `TodayCoverage`'s day bar (today as who has it — `primary` nanny / `primaryLight` parent cover / `warning` gap). |
| `WeekDots` | `week-dots.tsx` | 7 dots, filled `primary` for days with hours. Same dow / week-start contract as `WeekBars`. |
| `NowLine` | `now-line.tsx` | Static "you are here" marker: a dot, a hairline rule, a tabular `Small` label. No timer. |
| `DayHeader` | `day-header.tsx` | Agenda day-section header (`01-LAWS.md` Rule A). Keeps `schedule-day-today-${localDate}` and `schedule-day-total-${localDate}` testIDs. |

`WeekStrip` / `WeekNavHeader`: selected day is a filled `bg-primary` pill with
`text-primary-foreground` (9.16:1); today-but-unselected is a `chipPlum`
ground with `primary` numeral (7.54:1); other days are a bare `mutedForeground`
numeral. Day-of-week initials at `metadataLabel` 13/600. All numerals tabular.
Chevrons need a 44pt hit target.

### 8.7 `EmptyState` — `src/components/ui/empty-state.tsx`

The illustration sits on a **`chipPlum` circular ground at 1.6× the art's
width** so a transparent PNG has something to sit on instead of floating on
grey. Title is `H3`, description `body` `mutedForeground`.

### 8.8 Skeletons — `skeleton-card.tsx`, `skeleton-shimmer.tsx`

`skeletonBase #EDE5EA` (`secondary`) → `skeletonHighlight #FFFFFF`. Shimmer
period 1200ms, `easing.inOut`. Critically: **a skeleton must match the rung it
will become** — an L1 skeleton is a tall tinted block, an L3 skeleton is a
white card, an L4 skeleton is two bare rows. Loading state that lies about
hierarchy is why apps feel like they "pop" on load.

### 8.9 `MomentCard` and `ReceiptCard`

Toolkit cards. Do not invent a third delight surface.

**MomentCard** (`src/components/ui/moment-card.tsx`) — the L1 celebration.
Default-tone `Card`, illustration on a `chipPlum` circle at 1.6× the art
width (same ground as `EmptyState`), `Achievement` title, `Body`, optional
`Button size="lg"`. Confetti is owned by `useMilestone('moment', key)`.

**ReceiptCard** (`src/components/ui/receipt-card.tsx`) — the calm
confirmation. `Card tone="positive"`, `IconChip tone="hours"` with
`CircleCheck`, `H3` title, optional `Body`, optional `dots` slot. Haptic
owned by `useMilestone('receipt', key)`. New receipts go through this
component so the haptic has exactly one owner.

Motion tiers (`lib/animations/useMilestone.ts`) — see §11 for the event→tier
mapping (`02-VOICE.md` Table B):

| Tier | Haptic (`HAPTIC_PATTERNS`) | Easing | Confetti |
|---|---|---|---|
| `silent` | none | none | no |
| `acknowledged` | `encouragement` | `gentleRise` | no |
| `receipt` | `achievement` | `gentleRise` | no |
| `moment` | `milestone` | `celebrationPop` | one restrained pass (off under reduced motion) |

`useMilestone` fires the haptic once per key (module-scope set) and returns
`{ easing, showConfetti }`. A `null` key or the `silent` tier fires nothing.

---

## 9. Icons, loading & skeletons

- **Icons** — `lucide-react-native`. For `className` (e.g. `text-foreground`) to work on an icon, the icon component must be registered with NativeWind's `cssInterop` once. Example: `lib/icons/registry.ts` imports the used icons and runs `iconWithClassName(icon)` over them; this file is imported early in the root layout (`import '@/lib/icons/registry'`). Without registration, `className` on a raw Lucide SVG is silently ignored and icons ignore the theme. Register only the icons you use.
- **Loading / skeletons** — a `loading-indicator` primitive for spinners, plus `skeleton-card` / `skeleton-shimmer` primitives for content placeholders (§8.8). Shimmer colors come from adaptive `--skeleton-base` / `--skeleton-highlight` CSS vars so placeholders theme correctly in light/dark. Skeletons are animated, so per §7 their moving highlight layer is styled with inline `style`, not `className`.

---

## 10. Motion

No new dependency; `lib/animations/` has `StaggeredFadeIn`, `MaybeStagger`, `AnimatedPressable`, `easing.ts`, and `useReducedMotion`.

| Where | What | Notes |
|---|---|---|
| Card list entrance | `StaggeredFadeIn`, 40ms step, 8px rise, capped at 5 children | Today and Hours only. Never on a list that refetches often — a stagger that replays on every poll is nausea. |
| L1 promotion | Ground cross-fade 240ms `easing.out`; **no scale, no bounce** | A card that becomes the one thing to do should settle, not pounce. |
| `LiveDot` | Existing pulse. Unchanged. | Deliberately not a repeating pulse animation for the live *card* — see the rejected-pulse reasoning in `daylight-v2` history if this is ever revisited: habituation kills a looping animation within minutes, and it is the wrong register for an eight-hour state. |
| `Timer` | Digits do not animate. | A ticking number that also animates is unreadable, and this one is a pay record. |
| Week total figure | Count-up on week change, 400ms, tabular so width never shifts | Hours only. |
| Press | `AnimatedPressable` `scaleIntensity="standard"` + `haptic="light"` | Already correct everywhere it is used. |

Every one of these is gated by `useReducedMotion()`.

---

## 11. What this system explicitly does not do

- No dark mode as a designed surface (it exists in `palette.ts`, hard-disabled).
- No new font, no per-component `fontFamily`.
- No `shadow-*` Tailwind class. Elevation stays inline via `useElevation()`.
- No card borders, no list hairlines, no accent bars — except the exceptions named in `01-LAWS.md`.
- No apricot outside register 3 (§3.3).
- No `className` on any Reanimated `Animated.View` (§7).
- No literal hex in a `className` — every colour ships as a CSS var.
- No badge dot beyond the one place it is used (§8.5 explicitly refuses a second).

---

## Reference: load-bearing files

| Concern | File |
|---|---|
| Palette source of truth | `lib/design-tokens/palette.ts` |
| Elevation shadows (`useElevation()`) | `lib/design-tokens/elevation.ts` |
| Token names | `tailwind.config.js` |
| CSS-variable theme (light/dark) | `global.css` |
| Typography tokens (Figtree Variable) | `lib/design-tokens/typography.ts` |
| Screen content padding | `lib/design-tokens/spacing.ts` |
| `cn()` class merge | `lib/utils.ts` |
| CVA variant component | `src/components/ui/button.tsx` |
| Typography factory | `src/components/ui/typography/factory.tsx` |
| Icon registration | `lib/icons/registry.ts` |
| Primitives library | `src/components/ui/*` |
| PersonAvatar (name hashes to `category.accent1/2/3`; unnamed stays `bg-muted`) | `src/components/ui/person-avatar.tsx` |
| Milestone haptic/motion tiers | `lib/animations/useMilestone.ts` |
