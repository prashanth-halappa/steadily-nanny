/**
 * @module domains/pay/components/__tests__/TermGroup
 *
 * D-3 progressive groups: the collapsed summary always renders (§4.2 "a
 * closed sheet must read as a complete contract"), the group opens/closes
 * on tap, and `defaultOpen` seeds the initial state (the screen's "opens
 * when it has a value" rule — see the module doc).
 */
import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { Clock } from 'lucide-react-native';
import { Text } from 'react-native';
import { TermGroup } from '../TermGroup';

function renderGroup(defaultOpen = false) {
  return render(
    <TermGroup
      icon={Clock}
      label="Overtime"
      collapsedSummary="Not set"
      defaultOpen={defaultOpen}
      testID="term-group-overtime"
    >
      <Text testID="overtime-field">Weekly overtime field</Text>
    </TermGroup>
  );
}

describe('TermGroup', () => {
  it('always renders the label and the collapsed summary', () => {
    const { getByText } = renderGroup();
    expect(getByText('Overtime')).toBeTruthy();
    expect(getByText('Not set')).toBeTruthy();
  });

  it('starts closed by default — the content is not on screen', () => {
    const { queryByTestId } = renderGroup();
    expect(queryByTestId('overtime-field')).toBeNull();
  });

  it('starts open when defaultOpen is true (the screen’s "has a value" rule)', () => {
    const { getByTestId } = renderGroup(true);
    expect(getByTestId('overtime-field')).toBeTruthy();
  });

  it('tapping the header opens the content', () => {
    const { getByTestId } = renderGroup();
    fireEvent.press(getByTestId('term-group-overtime'));
    expect(getByTestId('overtime-field')).toBeTruthy();
  });

  it('tapping an open header closes it again', () => {
    const { getByTestId, queryByTestId } = renderGroup(true);
    expect(getByTestId('overtime-field')).toBeTruthy();
    fireEvent.press(getByTestId('term-group-overtime'));
    expect(queryByTestId('overtime-field')).toBeNull();
  });

  it('exposes accessibilityState.expanded for a11y tooling', () => {
    const { getByTestId } = renderGroup();
    const header = getByTestId('term-group-overtime');
    expect(header.props.accessibilityState.expanded).toBe(false);
    fireEvent.press(header);
    expect(header.props.accessibilityState.expanded).toBe(true);
  });
});
