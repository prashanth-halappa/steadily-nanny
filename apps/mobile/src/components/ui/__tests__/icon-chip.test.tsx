/**
 * @module components/ui/__tests__/icon-chip.test
 *
 * IconChip pins opaque category grounds and the sm geometry variant — the
 * hierarchy lever in Daylight v2 §6.1.
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { Calendar } from 'lucide-react-native';
import type { ViewStyle } from 'react-native';
import { IconChip } from '@/src/components/ui/icon-chip';
import { palette } from '~/lib/design-tokens/palette';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

function backgroundColor(style: unknown): string | undefined {
  const entries = Array.isArray(style) ? style : [style];
  const bg = entries.find(
    (s): s is ViewStyle => Boolean(s) && 'backgroundColor' in (s as object)
  );
  return bg?.backgroundColor as string | undefined;
}

describe('IconChip', () => {
  it('tone="brand" uses opaque chipPlum ground', () => {
    const { getByTestId } = render(
      <IconChip tone="brand" icon={Calendar} testID="chip" />
    );
    expect(backgroundColor(getByTestId('chip').props.style)).toBe(
      palette.light.chipPlum.hex
    );
  });

  it('tone="schedule" uses opaque chipCat1 ground', () => {
    const { getByTestId } = render(
      <IconChip tone="schedule" icon={Calendar} testID="chip" />
    );
    expect(backgroundColor(getByTestId('chip').props.style)).toBe(
      palette.light.chipCat1.hex
    );
  });

  it('tone="hours" uses opaque chipCat2 ground', () => {
    const { getByTestId } = render(
      <IconChip tone="hours" icon={Calendar} testID="chip" />
    );
    expect(backgroundColor(getByTestId('chip').props.style)).toBe(
      palette.light.chipCat2.hex
    );
  });

  it('tone="people" uses opaque chipCat3 ground', () => {
    const { getByTestId } = render(
      <IconChip tone="people" icon={Calendar} testID="chip" />
    );
    expect(backgroundColor(getByTestId('chip').props.style)).toBe(
      palette.light.chipCat3.hex
    );
  });

  it('default size is 28×28 (h-7 w-7)', () => {
    const { getByTestId } = render(
      <IconChip tone="brand" icon={Calendar} testID="chip" />
    );
    const className = getByTestId('chip').props.className as string;
    expect(className).toContain('h-7');
    expect(className).toContain('w-7');
    expect(className).not.toContain('h-6');
    expect(className).not.toContain('w-6');
  });

  it('size="sm" is 24×24 (h-6 w-6)', () => {
    const { getByTestId } = render(
      <IconChip tone="brand" icon={Calendar} size="sm" testID="chip" />
    );
    const className = getByTestId('chip').props.className as string;
    expect(className).toContain('h-6');
    expect(className).toContain('w-6');
    expect(className).not.toContain('h-7');
    expect(className).not.toContain('w-7');
  });

  it('carries rounded-cell and no border or shadow classes', () => {
    const { getByTestId } = render(
      <IconChip tone="brand" icon={Calendar} testID="chip" />
    );
    const className = getByTestId('chip').props.className as string;
    expect(className).toContain('rounded-cell');
    expect(className).not.toContain('border');
    expect(className).not.toContain('shadow');
  });
});
