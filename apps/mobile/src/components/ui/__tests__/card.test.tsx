/**
 * @module components/ui/__tests__/card.test
 *
 * `Card` is where Daylight's separation model lives: soft plum-tinted shadow
 * and NO border, inverting Ledger's hairline-rule-and-no-elevation approach.
 * Both halves of that are easy to undo by accident — a stray `border` class,
 * or a `useElevation()` that rebuilds per render — so both are pinned here.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { BoxShadowValue, ViewStyle } from 'react-native';
import { Card } from '@/src/components/ui/card';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

/** Apricot — `palette.light.highlight`. */
const APRICOT_RGB = '232, 130, 60';
/** Plum ink — `palette.light.foreground`. */
const INK_RGB = '42, 31, 43';

/**
 * The elevation style object off a rendered Card.
 *
 * Read straight off the style array rather than via `StyleSheet.flatten` —
 * the react-native test double drops `boxShadow` when flattening, so a
 * flattened read comes back empty and passes for the wrong reason.
 */
function elevationStyle(style: unknown): ViewStyle | undefined {
  const entries = Array.isArray(style) ? style : [style];
  return entries.find(
    (s): s is ViewStyle => Boolean(s) && 'boxShadow' in (s as object)
  );
}

function shadowColours(style: unknown): string {
  const shadow = elevationStyle(style)?.boxShadow;
  if (typeof shadow === 'string' || shadow === undefined) return '';
  return (shadow as readonly BoxShadowValue[])
    .map(layer => layer.color ?? '')
    .join(' ');
}

describe('Card', () => {
  it('separates with shadow, not a border', () => {
    const { getByTestId } = render(<Card testID="card" />);
    const className = getByTestId('card').props.className as string;

    expect(className).toContain('rounded-card');
    expect(className).toContain('bg-card');
    // Daylight's .card spec has no border. If the shadow ever reads too faint
    // on device the hairline comes back in card.tsx once — not per call site,
    // and not by a class leaking back in here.
    expect(className).not.toContain('border');
  });

  it('carries the neutral plum shadow by default', () => {
    const { getByTestId } = render(<Card testID="card" />);
    const colours = shadowColours(getByTestId('card').props.style);

    expect(colours).toContain(INK_RGB);
    expect(colours).not.toContain(APRICOT_RGB);
  });

  it('swaps to the apricot shadow when live', () => {
    const { getByTestId } = render(<Card testID="card" live />);
    const colours = shadowColours(getByTestId('card').props.style);

    expect(colours).toContain(APRICOT_RGB);
    expect(colours).not.toContain(INK_RGB);
  });

  it('tints the live card ground with an opaque apricot mix (not translucent)', () => {
    const { getByTestId } = render(<Card testID="card" live />);
    const entries = getByTestId('card').props.style as ViewStyle[];
    const bg = entries.find(
      (s): s is ViewStyle => Boolean(s) && 'backgroundColor' in (s as object)
    );
    expect(bg?.backgroundColor).toMatch(/^#[0-9A-F]{6}$/i);
    // Must not be pure white card — the 8% mix moves it toward apricot.
    expect(String(bg?.backgroundColor ?? '').toUpperCase()).not.toBe('#FFFFFF');
  });

  it('reuses one elevation style object across renders', () => {
    // useElevation used to rebuild its styles every call, handing each render
    // a fresh object identity and defeating React.memo below Card.
    const a = render(<Card testID="a" />);
    const b = render(<Card testID="b" />);

    expect(elevationStyle(a.getByTestId('a').props.style)).toBe(
      elevationStyle(b.getByTestId('b').props.style)
    );
  });

  it('lets a caller-supplied style win over the elevation default', () => {
    const { getByTestId } = render(
      <Card testID="card" style={{ opacity: 0.5 }} />
    );
    const entries = getByTestId('card').props.style as ViewStyle[];

    // Elevation first, caller's style last — so a screen can override without
    // losing the shadow.
    expect(entries.at(-1)).toEqual({ opacity: 0.5 });
    expect(shadowColours(entries)).toContain(INK_RGB);
  });
});

describe('CardContent padding (Daylight UX #40)', () => {
  it('defaults to full p-5.5 — not the header-companion pt-0', async () => {
    const source = await Bun.file(
      new URL('../card.tsx', import.meta.url).pathname
    ).text();
    const start = source.indexOf('function CardContent');
    const end = source.indexOf('function CardFooter');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const cardContent = source.slice(start, end);
    expect(cardContent).toContain("'p-5.5'");
    expect(cardContent).not.toContain('pt-0');
  });
});
