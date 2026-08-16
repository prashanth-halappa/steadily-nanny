/**
 * @module domains/today/__tests__/PinnedSlot.test
 *
 * The slot is the whole point of the restructure: one item, in normal flow,
 * ABOVE the feed's ScrollView, so its height is reserved rather than floated
 * over the feed (`useTabBarScrollPadding` can only help scrolled content —
 * a floating element is exactly how a CTA's tap landed on the tab bar).
 *
 * `usePinnedTone` is the ONLY replacement for the deleted `demoted` prop:
 * a card cannot be attention-toned unless it is the slot's single child.
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { PinnedSlot, usePinnedTone } from '../components/PinnedSlot';

function ToneProbe({ testID }: { testID: string }) {
  return <Text testID={testID}>{usePinnedTone()}</Text>;
}

describe('PinnedSlot', () => {
  it('renders its single child under a stable testID', () => {
    const { getByTestId } = render(
      <PinnedSlot>
        <View testID="slot-child" />
      </PinnedSlot>
    );

    const slot = getByTestId('today-pinned-slot');
    expect(slot).toBeTruthy();
    expect(getByTestId('slot-child')).toBeTruthy();
  });

  it('reserves real layout space around its occupant', () => {
    const { getByTestId } = render(
      <PinnedSlot>
        <View testID="slot-child" />
      </PinnedSlot>
    );

    const style: {
      paddingHorizontal?: number;
      paddingBottom?: number;
      position?: string;
    } = {};
    for (const layer of [getByTestId('today-pinned-slot').props.style]
      .flat()
      .filter(Boolean)) {
      Object.assign(style, layer);
    }
    expect(style.paddingHorizontal).toBe(22);
    expect(style.paddingBottom).toBe(16);
    // Absolute positioning is the bug this slot exists to prevent: it would
    // float over the feed instead of shrinking it.
    expect(style.position).toBeUndefined();
  });

  it('takes no height at all when nothing occupies it', () => {
    const { getByTestId } = render(<PinnedSlot>{null}</PinnedSlot>);

    const style = [getByTestId('today-pinned-slot').props.style]
      .flat()
      .filter(Boolean);
    expect(style).toHaveLength(0);
  });

  it('reports the attention tone inside, and default outside', () => {
    const { getByTestId } = render(
      <View>
        <PinnedSlot>
          <ToneProbe testID="inside" />
        </PinnedSlot>
        <ToneProbe testID="outside" />
      </View>
    );

    expect(getByTestId('inside').props.children).toBe('attention');
    expect(getByTestId('outside').props.children).toBe('default');
  });
});
