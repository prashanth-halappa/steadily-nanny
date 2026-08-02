# 07 — Mobile UI System

Purpose: the styling and component layer — NativeWind 4 with a CSS-variable theme, design tokens, the `@rn-primitives` + CVA component pattern, and the one gotcha that will silently break your layouts. Pair with `06-MOBILE-ARCHITECTURE.md`.

Stack: NativeWind 4 (Tailwind for RN), `@rn-primitives/*` (headless accessible primitives), `class-variance-authority` (CVA) for variants, `clsx` + `tailwind-merge` for class composition, `lucide-react-native` for icons.

---

## 1. NativeWind 4 + `tailwind.config.js` tokens

NativeWind compiles Tailwind classes to RN styles at build time (wired in `metro.config.js` via `withNativeWind(config, { input: './global.css' })`, and in `babel.config.js` via `jsxImportSource: 'nativewind'`). The Tailwind config defines the **token names**; their **values** come from CSS variables (see §2).

Example: `tailwind.config.js` — the token groups that matter:

```js
theme: { extend: {
  // No fontFamily — Ledger uses the platform face; weight via fontWeight / font-medium
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
    /* … */
  },
  borderRadius: {          // Ledger — tight radii; separation by rule + whitespace
    card: '6px', button: '4px', chip: '4px',
  },
  boxShadow: { card: 'none', /* … all none — use hairline borders */ },
  borderWidth: { hairline: hairlineWidth() },
}}
```

Conventions baked into the tokens:
- **Spacing is an 8pt grid** — use `p-4` (16px), `gap-6` (24px), not arbitrary values. `touch` (44px) is the minimum tappable size.
- **Typography minimum is 16px** for body; the scale is semantic (`display`, `caption`, `button`). Weight via numeric `fontWeight` / Tailwind `font-*` — no custom `fontFamily`.
- **Tight radii** — `rounded-card` (6px), `rounded-button` / `rounded-chip` (4px); not pills.
- **No elevation shadows** — `boxShadow.*` are all `none`; use hairline borders (`borderWidth.hairline`) for separation.
- **Palette source of truth** — `lib/design-tokens/palette.ts` (Ledger); `global.css` mirrors it and is parity-tested.

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
    --background: 0 0% 100%;        /* white */
    --foreground: 240 10% 10%;      /* near-black */
    --primary: 216 64% 34%;         /* deep ledger blue — see palette.ts */
    --primary-foreground: 0 0% 100%;
    --muted: 220 14% 96%;
    --muted-foreground: 220 8% 50%;
    --border: 220 13% 91%;
    /* category colors, semantic states, a gray-50..900 scale, specialty tokens
       (skeleton shimmer, hero-card gradient, inline-error) … */
  }

  .dark:root {
    --background: 240 6% 10%;       /* warm dark */
    --foreground: 220 14% 96%;
    --primary: 216 70% 70%;         /* lighter ledger blue for dark — see palette.ts */
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
| Palette source of truth (Ledger) | `lib/design-tokens/palette.ts` |
| Token names | `tailwind.config.js` |
| CSS-variable theme (light/dark) | `global.css` |
| Typography tokens (platform face) | `lib/design-tokens/typography.ts` |
| `cn()` class merge | `lib/utils.ts` |
| CVA variant component | `src/components/ui/button.tsx` |
| Typography factory | `src/components/ui/typography/factory.tsx` |
| Icon registration | `lib/icons/registry.ts` |
| Primitives library | `src/components/ui/*` |
