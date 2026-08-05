/**
 * @module components/ui/__tests__/live-dot
 */
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { LiveDot } from '@/src/components/ui/live-dot';

describe('LiveDot', () => {
  it('renders a fixed-size apricot dot', () => {
    const { getByTestId } = render(<LiveDot testID="today-live-dot" />);
    const dot = getByTestId('today-live-dot');
    expect(dot.props.className).toContain('h-2.5');
    expect(dot.props.className).toContain('w-2.5');
    expect(dot.props.className).toContain('rounded-full');
    expect(dot.props.className).toContain('bg-highlight');
  });

  it('is hidden from accessibility tree', () => {
    const { getByTestId } = render(<LiveDot testID="today-live-dot" />);
    expect(getByTestId('today-live-dot').props.accessible).toBe(false);
  });
});
