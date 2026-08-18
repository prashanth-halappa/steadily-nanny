/**
 * @module components/ui/__tests__/list-group.test
 *
 * `ListGroup` + `ListRow` generalise the `overflow-hidden p-0` Card pattern
 * copy-pasted 43 times across domains (see `settings.tsx`'s
 * `SettingsNavRow`). The group carries the ONE elevated card; rows carry
 * none of their own — see `card.test.tsx` for the elevation-style read
 * pattern this borrows (`boxShadow` survives on the style array, not through
 * `StyleSheet.flatten`).
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { ViewStyle } from 'react-native';
import { ListGroup, ListRow } from '@/src/components/ui/list-group';

function elevationStyle(style: unknown): ViewStyle | undefined {
  const entries = Array.isArray(style) ? style : [style];
  return entries.find(
    (s): s is ViewStyle => Boolean(s) && 'boxShadow' in (s as object)
  );
}

describe('ListGroup', () => {
  it('wraps its rows in one elevated card', () => {
    const { getByTestId } = render(
      <ListGroup testID="group">
        <ListRow testID="row-1">A</ListRow>
        <ListRow testID="row-2">B</ListRow>
      </ListGroup>
    );
    const group = getByTestId('group');
    expect(elevationStyle(group.props.style)).toBeTruthy();
    expect((group.props.className as string) ?? '').toContain('rounded-card');
    expect((group.props.className as string) ?? '').toContain(
      'overflow-hidden'
    );
    expect((group.props.className as string) ?? '').toContain('p-0');
  });

  it('renders a hairline between rows but not after the last one', () => {
    const { UNSAFE_root } = render(
      <ListGroup testID="group">
        <ListRow testID="row-1">A</ListRow>
        <ListRow testID="row-2">B</ListRow>
        <ListRow testID="row-3">C</ListRow>
      </ListGroup>
    );
    const hairlines = UNSAFE_root.findAll(
      node => node.props.testID === 'list-group-separator'
    );
    // 3 rows -> 2 separators, none trailing the last row.
    expect(hairlines).toHaveLength(2);
  });

  it('insets the hairline from the card edge', () => {
    const { UNSAFE_root } = render(
      <ListGroup testID="group">
        <ListRow testID="row-1">A</ListRow>
        <ListRow testID="row-2">B</ListRow>
      </ListGroup>
    );
    const [hairline] = UNSAFE_root.findAll(
      node => node.props.testID === 'list-group-separator'
    );
    expect(hairline).toBeTruthy();
    expect(hairline?.props.className).toContain('ml-4');
  });

  it('renders a single row with no hairline at all', () => {
    const { UNSAFE_root } = render(
      <ListGroup testID="group">
        <ListRow testID="row-1">Only row</ListRow>
      </ListGroup>
    );
    const hairlines = UNSAFE_root.findAll(
      node => node.props.testID === 'list-group-separator'
    );
    expect(hairlines).toHaveLength(0);
  });
});

describe('ListRow', () => {
  it('carries no elevation of its own', () => {
    const { getByTestId } = render(<ListRow testID="row">Solo</ListRow>);
    const row = getByTestId('row');
    const style = Array.isArray(row.props.style)
      ? row.props.style
      : [row.props.style];
    expect(elevationStyle(style)).toBeUndefined();
  });

  it('forwards its testID', () => {
    const { getByTestId } = render(<ListRow testID="my-row">Hi</ListRow>);
    expect(getByTestId('my-row')).toBeTruthy();
  });

  it('is a plain, non-interactive view when no onPress is given', () => {
    const { getByTestId } = render(<ListRow testID="row">Static</ListRow>);
    expect(getByTestId('row').props.accessibilityRole).toBeUndefined();
  });

  it('gets a button role and the 44pt touch-target minimum when pressable', () => {
    const { getByTestId } = render(
      <ListRow testID="row" onPress={() => {}}>
        Tap me
      </ListRow>
    );
    const row = getByTestId('row');
    expect(row.props.accessibilityRole).toBe('button');
    const style = Array.isArray(row.props.style)
      ? row.props.style
      : [row.props.style];
    const minHeight = style.find(
      (s: ViewStyle | undefined) => s && 'minHeight' in s
    )?.minHeight;
    expect(minHeight).toBeGreaterThanOrEqual(44);
  });

  it('fires onPress', () => {
    let pressed = false;
    const { getByTestId } = render(
      <ListRow testID="row" onPress={() => (pressed = true)}>
        Tap me
      </ListRow>
    );
    getByTestId('row').props.onPress();
    expect(pressed).toBe(true);
  });
});
