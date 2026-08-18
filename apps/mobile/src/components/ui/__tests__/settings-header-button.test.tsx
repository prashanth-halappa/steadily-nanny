/**
 * @module components/ui/__tests__/settings-header-button
 *
 * Settings stopped being a tab (WP-C) — it is a header icon now, on every
 * tab root plus the inbox. This is the one affordance that reaches
 * `/settings` at all, so its testID, a11y props and destination are load
 * bearing: lose any of them and sign-out becomes unreachable.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';

let SettingsHeaderButton: typeof import('../settings-header-button').SettingsHeaderButton;
let mockPush: ReturnType<typeof mock>;

beforeAll(async () => {
  mockPush = mock();
  mock.module('expo-router', () => ({
    router: { push: mockPush, replace: mock(), back: mock() },
  }));
  SettingsHeaderButton = (await import('../settings-header-button'))
    .SettingsHeaderButton;
});

describe('SettingsHeaderButton', () => {
  it('renders the header-settings testID with a button role and the tab label', () => {
    const { getByTestId } = render(<SettingsHeaderButton />);
    const button = getByTestId('header-settings');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('tabs.settings');
  });

  it('meets the 44pt touch minimum', () => {
    const { getByTestId } = render(<SettingsHeaderButton />);
    const style = Object.assign(
      {},
      ...[getByTestId('header-settings').props.style]
        .flat(Infinity)
        .filter(Boolean)
    );
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('pushes /settings on press', () => {
    const { getByTestId } = render(<SettingsHeaderButton />);
    mockPush.mockClear();
    fireEvent.press(getByTestId('header-settings'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});
