/**
 * @module components/ui/__tests__/section
 *
 * Section is the vertical-rhythm primitive: a bold DayGroup header (never
 * MetadataLabel) with an asymmetric 32px-above / 8px-below gap that makes
 * grouping read without a border, plus a gap-3 children stack.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { Section } from '../section';

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

describe('Section', () => {
  it('renders the title', () => {
    const { getByText } = render(
      <Section title="This week">
        <View />
      </Section>
    );
    expect(getByText('This week')).toBeTruthy();
  });

  it('renders the title with the DayGroup token (17/700), not MetadataLabel', () => {
    const { getByText } = render(
      <Section title="This week">
        <View />
      </Section>
    );
    const style = flattenStyle(getByText('This week').props.style);
    expect(style.fontSize).toBe(17);
    expect(style.fontWeight).toBe('700');
  });

  it('renders the optional right-hand slot', () => {
    const { getByTestId } = render(
      <Section title="This week" right={<Text testID="right-slot">3</Text>}>
        <View />
      </Section>
    );
    expect(getByTestId('right-slot')).toBeTruthy();
  });

  it('omits the right-hand slot when not given', () => {
    const { queryByTestId } = render(
      <Section title="This week">
        <View />
      </Section>
    );
    expect(queryByTestId('right-slot')).toBeNull();
  });

  it('renders children', () => {
    const { getByTestId } = render(
      <Section title="This week">
        <Text testID="child">hi</Text>
      </Section>
    );
    expect(getByTestId('child')).toBeTruthy();
  });

  it('applies the 32px-above / 8px-below asymmetric rhythm to the header', () => {
    const { getByTestId } = render(
      <Section title="This week" testID="section">
        <View />
      </Section>
    );
    const header = getByTestId('section-header');
    expect(header.props.className).toContain('pt-8');
    expect(header.props.className).toContain('pb-2');
  });

  it('first suppresses the top padding', () => {
    const { getByTestId } = render(
      <Section title="This week" first testID="section">
        <View />
      </Section>
    );
    const header = getByTestId('section-header');
    expect(header.props.className).not.toContain('pt-8');
    expect(header.props.className).toContain('pb-2');
  });

  it('stacks children with gap-3', () => {
    const { getByTestId } = render(
      <Section title="This week" testID="section">
        <View />
      </Section>
    );
    expect(getByTestId('section-children').props.className).toContain('gap-3');
  });

  it('forwards testID', () => {
    const { getByTestId } = render(
      <Section title="This week" testID="my-section">
        <View />
      </Section>
    );
    expect(getByTestId('my-section')).toBeTruthy();
  });

  // A section that navigates to its own fuller view. The header row is the
  // tap target, so it must clear the 44pt floor — the previous incarnation
  // was a 13px label in a bare Pressable with no affordance and no height.
  it('makes the header row a real tap target when onHeaderPress is given', () => {
    const onHeaderPress = mock(() => {});
    const { getByTestId } = render(
      <Section title="This week" testID="section" onHeaderPress={onHeaderPress}>
        <View />
      </Section>
    );
    const press = getByTestId('section-header-press');
    expect(press.props.accessibilityRole).toBe('button');
    expect(press.props.style.minHeight).toBeGreaterThanOrEqual(44);
    fireEvent.press(press);
    expect(onHeaderPress).toHaveBeenCalledTimes(1);
  });

  it('renders no press target when onHeaderPress is omitted', () => {
    const { queryByTestId } = render(
      <Section title="This week" testID="section">
        <View />
      </Section>
    );
    expect(queryByTestId('section-header-press')).toBeNull();
  });
});
