/**
 * @module components/ui/__tests__/screen-wash
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { hexToRgba, screenWash } from '@/lib/design-tokens';
import { palette } from '@/lib/design-tokens/palette';
import { ScreenWash } from '@/src/components/ui/screen-wash';

mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

describe('ScreenWash', () => {
  it('renders brand and live washes with different top-stop colours', () => {
    const brand = render(<ScreenWash kind="brand" />);
    const live = render(<ScreenWash kind="live" />);

    const brandColors = brand.getByTestId('screen-wash').props.colors;
    const liveColors = live.getByTestId('screen-wash').props.colors;

    expect(brandColors[0]).toBe(screenWash('light', 'brand').colors[0]);
    expect(liveColors[0]).toBe(screenWash('light', 'live').colors[0]);
    expect(brandColors[0]).toBe(hexToRgba(palette.light.primary.hex, 0.14));
    expect(liveColors[0]).toBe(hexToRgba(palette.light.highlight.hex, 0.16));
    expect(brandColors[0]).not.toBe(liveColors[0]);
  });

  it('marks the wash pointerEvents="none" so scroll content stays interactive', () => {
    const { getByTestId } = render(<ScreenWash kind="brand" />);
    expect(getByTestId('screen-wash').props.pointerEvents).toBe('none');
  });

  it('fades at the spec 62% stop', () => {
    const { getByTestId } = render(<ScreenWash kind="brand" />);
    expect(getByTestId('screen-wash').props.locations).toEqual([0, 0.62]);
  });

  it('accepts an optional testID override', () => {
    const { getByTestId } = render(
      <ScreenWash kind="live" testID="hours-brand-wash" />
    );
    expect(getByTestId('hours-brand-wash')).toBeTruthy();
  });
});
