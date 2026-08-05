/**
 * @module components/ui/__tests__/field-error
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { FieldError } from '@/src/components/ui/field-error';

describe('FieldError', () => {
  it('renders children with alert role and destructive styling', () => {
    const { getByText } = render(
      <FieldError testID="date-error">Date cannot be in the future</FieldError>
    );
    const error = getByText('Date cannot be in the future');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(error.props.className).toContain('mt-2');
    expect(error.props.className).toContain('text-destructive');
  });

  it('renders nothing when children is empty', () => {
    const { queryByTestId } = render(
      <FieldError testID="date-error">{''}</FieldError>
    );
    expect(queryByTestId('date-error')).toBeNull();
  });

  it('supports testID passthrough', () => {
    const { getByTestId } = render(
      <FieldError testID="range-error">Invalid range</FieldError>
    );
    expect(getByTestId('range-error')).toBeTruthy();
  });
});
