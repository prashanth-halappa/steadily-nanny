# 07 — Mobile UI System

Purpose: the styling and component layer — NativeWind 4 with a CSS-variable theme, design tokens, the `@rn-primitives` + CVA component pattern, and the one gotcha that will silently break your layouts. Pair with `06-MOBILE-ARCHITECTURE.md`.

Stack: NativeWind 4 (Tailwind for RN), `@rn-primitives/*` (headless accessible primitives), `class-variance-authority` (CVA) for variants, `clsx` + `tailwind-merge` for class composition, `lucide-react-native` for icons.

---

## 1. NativeWind 4 + `tailwind.config.js` tokens

NativeWind compiles Tailwind classes to RN styles at build time (wired in `metro.config.js` via `withNativeWind(config, { input: './global.css' })`, and in `babel.config.js` via `jsxImportSource: 'nativewind'`). The Tailwind config defines the **token names**; their **values** come from CSS variables (see §2).

Example: `tailwind.config.js` — the token groups that matter:

```js
theme: { extend: {
  // No fontFamily — Daylight keeps the platform face; weight via fontWeight / font-medium
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
    // multi-layer, falls through into aspect-ratio). Daylight elevation lives in
    // lib/design-tokens/elevation.ts as RN inline styles via useElevation().
    sm: 'none', DEFAULT: 'none', md: 'none', lg: 'none', card: 'none', none: 'none',
  },
  borderWidth: { hairline: hairlineWidth(), '1.5': '1.5px' },
}}
```

Conventions baked into the tokens:
- **Spacing is an 8pt grid** — use `p-4` (16px), `gap-6` (24px), not arbitrary values. `touch` (44px) is the minimum tappable size. Screen content gutters are 22px (`SCREEN_CONTENT_STYLE` in `lib/design-tokens/spacing.ts`).
- **Typography minimum is 16px** for body; the scale is semantic (`display`, `caption`, `button`). Weight via numeric `fontWeight` / Tailwind `font-*` — no custom `fontFamily`.
- **Soft radii** — `rounded-card` (20px), `rounded-button` (14px), `rounded-row` (16px), `rounded-cell` (12px); `rounded-chip` (999px) is a pill for badges and chips.
- **Elevation via inline styles, not Tailwind `shadow-*`** — `boxShadow.*` stay `none` because NativeWind cannot parse multi-layer shadows. Use `useElevation()` from `lib/design-tokens/elevation.ts` for plum-tinted card/row shadows; hairline borders (`borderWidth.hairline`) still separate outlined surfaces.
- **Palette source of truth** — `lib/design-tokens/palette.ts` (Daylight); `global.css` mirrors it and is parity-tested.

**A new colour not showing up on device/simulator is (almost) never a stale bundler.** `bun run dev` already runs `expo start -c` — cache-cleared on every launch — and NativeWind's Metro plugin runs the Tailwind CLI in `--watch` mode during dev, pushing a rebuilt `global.css`/`tailwind.config.js` through Fast Refresh automatically (`nativewind/dist/metro/tailwind/v3/child.js` spawns `tailwindcss --watch`; `react-native-css-interop`'s Metro plugin fires a synthetic file-change event on every rebuild — verified by reading both, not assumed). A genuinely stuck HMR socket does happen occasionally; if a new class truly won't appear, a fresh `bun run dev` + simulator relaunch clears it, but check `lib/design-tokens/palette.ts` first — `useThemeColors()`/`useElevation()` read that as plain hex for inline styles, not a Tailwind class, so a token missing there is a wiring gap (see `palette-parity.test.ts`), not a cache.

A skeleton of this config (generic palette, same structure) ships at `pattern/templates/mobile/tailwind.config.js`.

---

## 2. `global.css` — the CSS-variable theme

This is where light/dark actually lives. Colors are declared as **HSL channel triples** (no `hsl()` wrapper) under `:root` (light) and `.dark:root` (dark). The Tailwind tokens wrap them with `hsl(var(--token))`, so a class like `bg-primary` resolves to `hsl(var(--primary))` and automatically flips when the `dark` class is present on an ancestor.

Example: `global.css` (abridged):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 345 17% 95%;      /* #F5F1F2 — warm ground */
    --foreground: 295 16% 15%;      /* #2A1F2B — plum ink */
    --primary: 296 20% 30%;         /* #5B3E5D — plum — see palette.ts */
    --primary-foreground: 0 0% 100%;
    --highlight: 24 79% 57%;        /* #E8823C — apricot accent */
    --highlight-foreground: 295 16% 15%;
    --muted: 326 19% 93%;           /* #F0E9ED */
    --muted-foreground: 291 7% 41%; /* #6E6270 */
    --border: 323 13% 88%;          /* #E5DDE2 — hairline rule */
    /* category accents, semantic states (success, warning, short-notice, …),
       gray-50..900 scale, skeleton shimmer, inline-error … */
  }

  .dark:root {
    --background: 291 14% 10%;      /* #1B151C */
    --foreground: 309 20% 93%;      /* #F1EAF0 */
    --primary: 297 28% 72%;         /* #C9A2CB — lighter plum for dark */
    --highlight: 27 87% 62%;        /* #F2954B */
    /* …every token re-declared with dark values, gray scale INVERTED… */
  }
}
```

The indirection chain — **why it's worth it**:

```
class `bg-primary`  →  Tailwind token `hsl(var(--primary))`  →  CSS var value (per :root / .dark:root)
```

One `dark` class toggle on a root `<View>` (set in the root layout's themed shell) re-themes the entire app — every component using semantic classes flips, with zero per-component conditional logic. The rules that make this reliable:
- **Always use semantic tokens** (`text-foreground`, `bg-card`, `border-border`) — never literal hex or `text-black`. Literals don't adapt to dark mode.
- Use foreground/background pairs (`bg-primary` + `text-primary-foreground`) so contrast holds in both themes.
- The gray scale is *inverted* in dark mode (`gray-50` is a subtle background in both themes, `gray-900` is strong text in both) so `text-gray-900` / `bg-gray-50` read correctly without conditionals.

### Elevation — `useElevation()`, not Tailwind shadows

Daylight restores soft plum-tinted shadows after Ledger removed them entirely. They cannot live in Tailwind: NativeWind 4 / `react-native-css-interop@0.2.6` parses `box-shadow` into a single `shadowColor` + `shadowRadius`, misreads spread as radius, and bails on multi-layer values. So `tailwind.config.js` keeps every `boxShadow` token as `'none'`.

Shadows are authored in `lib/design-tokens/elevation.ts` as React Native `boxShadow` arrays (RN 0.86+, both platforms):

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

`useElevation()` returns `{ card, cardProminent, liveCard, row }` — colours derived from `palette.ts` via `hexToRgba`, so shadows track theme changes. The two mode variants are built once at module load and returned by reference, so consumers get a stable style identity across renders.

**Shadow instead of rule — the inversion that defines Daylight.** Ledger separated surfaces with a hairline border and no elevation; Daylight does the opposite. `Card` therefore carries **no border**. When you need a card surface, use `<Card>` rather than hand-rolling `<View className="rounded-card border border-border bg-card">` — a hand-rolled one gets the radius but silently misses the shadow, which is how the app ends up looking like Ledger in Daylight's colours. Rows are the same story: `rounded-row bg-card` + `style={elevation.row}`, no border.

Two deliberate exceptions, both still bordered because the border is doing a *different* job: `RoleOptionCard`'s `border-2` is a selection affordance, and form fields keep their input border.

**`live`** swaps the neutral plum shadow for the apricot one. Pass it on exactly the predicate that drives the Today wash (`ClockInCard`, `NannyLiveStatusCard`) so the card carries the signal and the wash reads as its echo — not the other way round. `live` is now a deprecated alias for `tone="live"` (below) — new call sites should use `tone` directly.

Never merge elevation styles onto a Reanimated `Animated.View` that also carries `className` (see §4).

### Card tone tiers

`<Card tone="…">` (`src/components/ui/card.tsx`) names four attention tiers so screens don't reinvent card hierarchy per call site:

| Tier | Meaning | `tone` | Ground | Elevation |
|---|---|---|---|---|
| T1 — Act now | something needs the viewer's action | `tone="attention"` | opaque `surfaceAttention` | `cardProminent` |
| T2 — Live | happening right now | `tone="live"` | opaque `surfaceLive` / `liveCardBackground()` | `liveCard` (apricot) |
| T3 — Routine | the default, everyday card | `tone="default"` (or omit `tone`) | `bg-card` | `card` |
| T4 — Reference | present but not asking for attention | *(not a `Card` tone)* — use `bg-muted` directly | `bg-muted` | none |

`tone="attention"` and `tone="positive"` tint with opaque hex (`surfaceAttention` / `surfacePositive`), never a translucent `bg-*/NN` class (GOLDEN-FIXES #19 — a shadow over a translucent ground reads wrong on device). `tone="positive"` keeps the plain `card` elevation, not `cardProminent` — it's a calm confirmation, not an alert.

`Card` no longer has an `accent` prop. It used to draw a 4px inset bar down the card's left edge; removed after user feedback on device ("you don't need the left border") and a genuine rendering defect (a 4px-wide element can't carry the card's own 20px corner radius — the radius degenerates and the bar poked past the rounded corners). The tinted ground alone now carries the tier.

#### Rule B — text colour on a tinted ground

On a `tone="attention"` / `"positive"` / `"live"` card:

- The **primary sentence** — the headline, the main statement the tier exists to deliver — is `foreground`. Muting the message undercuts the tier that's trying to raise it.
- **Genuinely secondary text** — metadata, timestamps, supporting captions — may stay `mutedForeground`. It passes AA on all three tints, and the hierarchy *within* the card is real; don't sweep every muted line to `foreground` just because the card is tinted.
- **Semantic hues are never sentence text on a tint.** `destructive` is the one exception, for a deadline — it's deliberate and it's measured below.

WCAG relative-luminance contrast, independently recomputed (not transcribed):

| Text | on `surfaceAttention` #F9F3EC | on `surfacePositive` #F1F4F2 | on `surfaceLive` #FDF5EF |
|---|---|---|---|
| `foreground` #2A1F2B | 14.34 ✅ | 14.26 ✅ | 14.66 ✅ |
| `mutedForeground` #6E6270 | 5.23 ✅ | 5.20 ✅ | 5.35 ✅ |
| `destructive` #A85145 | 4.85 ✅ | 4.83 ✅ | 4.96 ✅ |
| `success` #4A7A5C | 4.51 ✅ | **4.48 ✗** | 4.61 ✅ |
| `warningStrong` #9C6E2E | **4.07 ✗** | **4.05 ✗** | **4.16 ✗** |
| `warning` #C08A3E | **2.74 ✗** | **2.73 ✗** | **2.80 ✗** |
| `highlight` #E8823C | **2.48 ✗** | **2.47 ✗** | **2.53 ✗** |

Threshold: 4.5:1 (3:1 only applies at ≥18.66px bold or ≥24px regular). **`success` on `surfacePositive` is a landmine**: 4.48 is a hair under AA, `success` is currently unused as text there, and colouring an approved-state sentence green is exactly the mistake someone reaches for next. Don't.

---

## 3. Component primitives: `@rn-primitives` + CVA

The `ui/` directory holds design-system primitives. The split:
- **`src/components/ui/*`** — generic, product-agnostic primitives (button, text, card, input, dialog, skeleton…). Built on headless `@rn-primitives/*` (slot, portal, accessible behaviors) + CVA variants. No business logic.
- **`src/components/<area>/*` and `src/domains/<feature>/components/*`** — composed, feature-aware components. These import `ui/` primitives; they never reimplement styling primitives.

### `cn` — class composition

Example: `lib/utils.ts` — `clsx` for conditional classes, `tailwind-merge` to dedupe conflicts (last wins):

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### CVA variant pattern — button

Example: `src/components/ui/button.tsx`. `cva()` declares variant → class maps with `defaultVariants`; `VariantProps` derives the prop types; `cn()` merges caller `className` last so it can override.

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'group flex items-center justify-center rounded-button …',
  {
    variants: {
      variant: {
        default: 'bg-primary active:opacity-90',
        destructive: 'bg-destructive active:opacity-90',
        outline: 'border border-input bg-background active:bg-accent',
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

type ButtonProps = React.ComponentPropsWithoutRef<typeof AnimatedPressable> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <AnimatedPressable
        className={cn(props.disabled && 'opacity-50', buttonVariants({ variant, size, className }))}
        role="button" haptic="light" {...props}
      />
    </TextClassContext.Provider>
  );
}
```

Two reusable tricks here: a parallel `buttonTextVariants` is pushed through a `TextClassContext` so child `<Text>` inherits the right color per variant; and the `native:` modifier sets larger touch sizes on device vs web.

### Typography via a factory

Example: `src/components/ui/typography/factory.tsx`. Instead of hand-writing each heading/body component, a factory turns a token (`size`, `lineHeight`, `weight`) into a component — combining an inline `style` (exact numeric metrics, including `fontWeight`) with a `className` (`text-foreground` for theming) and supporting `asChild` via `@rn-primitives/slot`:

```tsx
export function createTypographyComponent(token, displayName, options) {
  const baseStyle = tokenToStyle(token);           // { fontSize, lineHeight, fontWeight, letterSpacing }
  return function TypographyComponent({ className, asChild = false, style, ...props }) {
    const Component = asChild ? Slot.Text : RNText;
    return (
      <Component
        style={[baseStyle, style]}
        className={cn('text-foreground web:select-text', className)}
        {...props}
      />
    );
  };
}
```

Consumers import `H1`, `Body`, `Display`, etc. from `@/components/ui/typography`.

---

## 4. ⚠️ THE GOTCHA — never put NativeWind `className` on a Reanimated `Animated.View`

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

---

## 5. Icons, loading & skeletons

- **Icons** — `lucide-react-native`. For `className` (e.g. `text-foreground`) to work on an icon, the icon component must be registered with NativeWind's `cssInterop` once. Example: `lib/icons/registry.ts` imports the used icons and runs `iconWithClassName(icon)` over them; this file is imported early in the root layout (`import '@/lib/icons/registry'`). Without registration, `className` on a raw Lucide SVG is silently ignored and icons ignore the theme. Register only the icons you use.
- **Loading / skeletons** — a `loading-indicator` primitive for spinners, plus `skeleton-card` / `skeleton-shimmer` primitives for content placeholders. Shimmer colors come from adaptive `--skeleton-base` / `--skeleton-highlight` CSS vars so placeholders theme correctly in light/dark. Skeletons are animated, so per §4 their moving highlight layer is styled with inline `style`, not `className`.

---

## Reference: load-bearing files

| Concern | File |
|---|---|
| Palette source of truth (Daylight) | `lib/design-tokens/palette.ts` |
| Elevation shadows (`useElevation()`) | `lib/design-tokens/elevation.ts` |
| Token names | `tailwind.config.js` |
| CSS-variable theme (light/dark) | `global.css` |
| Typography tokens (platform face) | `lib/design-tokens/typography.ts` |
| Screen content padding | `lib/design-tokens/spacing.ts` |
| `cn()` class merge | `lib/utils.ts` |
| CVA variant component | `src/components/ui/button.tsx` |
| Typography factory | `src/components/ui/typography/factory.tsx` |
| Icon registration | `lib/icons/registry.ts` |
| Primitives library | `src/components/ui/*` |
