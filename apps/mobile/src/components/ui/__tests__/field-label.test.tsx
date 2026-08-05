/**
 * @module components/ui/__tests__/field-label
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { typography } from '@/lib/design-tokens/typography';
import { FieldLabel } from '@/src/components/ui/field-label';

describe('FieldLabel', () => {
  it('renders children with label token metrics and muted styling', () => {
    const { getByText } = render(<FieldLabel>Date</FieldLabel>);
    const label = getByText('Date');
    const style = label.props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;

    expect(flat.fontSize).toBe(typography.label.size);
    expect(flat.lineHeight).toBe(typography.label.lineHeight);
    expect(flat.fontWeight).toBe(typography.label.weight);
    expect(label.props.className).toContain('mb-1');
    expect(label.props.className).toContain('text-muted-foreground');
  });

  it('supports testID passthrough', () => {
    const { getByTestId } = render(
      <FieldLabel testID="expense-date-label">Date</FieldLabel>
    );
    expect(getByTestId('expense-date-label')).toBeTruthy();
  });

  it('merges custom className', () => {
    const { getByText } = render(
      <FieldLabel className="mt-2">Start date</FieldLabel>
    );
    expect(getByText('Start date').props.className).toContain('mt-2');
  });
});
