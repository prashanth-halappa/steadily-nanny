/**
 * @module components/ui/__tests__/textarea.focus
 * Daylight visibility fix: resting border must be visible against the card
 * background, and (previously missing entirely) a native focus ring.
 */
import { describe, expect, it } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { Textarea } from '@/src/components/ui/textarea';

describe('Textarea resting and focus borders', () => {
  it('uses bg-card and the visible border-border-strong at rest', () => {
    const { getByTestId } = render(
      <Textarea
        testID="field"
        accessibilityLabel="Note"
        value=""
        onChangeText={() => {}}
      />
    );
    const className = getByTestId('field').props.className as string;
    expect(className).toContain('bg-card');
    expect(className).toContain('border-border-strong');
    expect(className).not.toContain('border-ring');
  });

  it('applies a native focus border when focused (not web:-only)', () => {
    const { getByTestId } = render(
      <Textarea
        testID="field"
        accessibilityLabel="Note"
        value=""
        onChangeText={() => {}}
      />
    );
    const field = getByTestId('field');
    fireEvent(field, 'focus');
    const className = field.props.className as string;
    expect(className).toContain('border-ring');
  });

  it('drops the focus ring on blur', () => {
    const { getByTestId } = render(
      <Textarea
        testID="field"
        accessibilityLabel="Note"
        value=""
        onChangeText={() => {}}
      />
    );
    const field = getByTestId('field');
    fireEvent(field, 'focus');
    fireEvent(field, 'blur');
    const className = field.props.className as string;
    expect(className).not.toContain('border-ring');
    expect(className).toContain('border-border-strong');
  });
});
