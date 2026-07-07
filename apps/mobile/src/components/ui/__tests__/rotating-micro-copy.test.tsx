/**
 * RotatingMicroCopy Component Tests
 *
 * Tests the rotating micro-copy loading message component:
 * rendering, default/custom testIDs, custom message sets, {name} interpolation,
 * and timer cleanup on unmount.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { render } from '@testing-library/react-native';
import { RotatingMicroCopy } from '../rotating-micro-copy';

describe('RotatingMicroCopy', () => {
  it('should render without crashing', () => {
    const { root } = render(<RotatingMicroCopy />);
    expect(root).toBeTruthy();
  });

  it('should display initial text content (a non-empty string)', () => {
    const { getByTestId } = render(<RotatingMicroCopy />);
    const element = getByTestId('rotating-micro-copy');
    expect(typeof element.props.children).toBe('string');
    expect(element.props.children.length).toBeGreaterThan(0);
  });

  it('should use default testID "rotating-micro-copy"', () => {
    const { getByTestId } = render(<RotatingMicroCopy />);
    expect(getByTestId('rotating-micro-copy')).toBeTruthy();
  });

  it('should support custom testID', () => {
    const { getByTestId } = render(
      <RotatingMicroCopy testID="custom-micro-copy" />
    );
    expect(getByTestId('custom-micro-copy')).toBeTruthy();
  });

  it('should render a single provided message verbatim', () => {
    const { getByTestId } = render(
      <RotatingMicroCopy messages={['Hang tight']} />
    );
    expect(getByTestId('rotating-micro-copy').props.children).toBe(
      'Hang tight'
    );
  });

  it('should interpolate the name into a {name} token', () => {
    const { getByTestId } = render(
      <RotatingMicroCopy messages={['Hi {name}']} name="Alex" />
    );
    expect(getByTestId('rotating-micro-copy').props.children).toBe('Hi Alex');
  });

  describe('fade timeout is cleared on cleanup (no leaked timer)', () => {
    it('clears the pending cross-fade setTimeout when the component unmounts mid-fade', async () => {
      // advanceMessage schedules a trailing FADE_DURATION_MS (400ms) fade
      // setTimeout. The rotation interval used to be cleared on cleanup, but the
      // fade timeout leaked — an unmount between the fade starting and completing
      // left a pending timer that could still fire on an unmounted component.
      const clearTimeoutSpy = spyOn(global, 'clearTimeout');
      clearTimeoutSpy.mockClear();

      // Short interval + multiple messages so the rotation fires quickly.
      const { unmount } = render(
        <RotatingMicroCopy interval={10} messages={['one', 'two', 'three']} />
      );

      // Let the interval fire once, scheduling the fade setTimeout (400ms).
      await new Promise(resolve => setTimeout(resolve, 30));

      // Unmount while the fade timeout is still pending.
      unmount();

      const clearedTimeoutIds = clearTimeoutSpy.mock.calls.map(call => call[0]);
      // The interval id is cleared via clearInterval, not clearTimeout, so any
      // clearTimeout call here can only be the fade timeout.
      expect(clearedTimeoutIds.length).toBeGreaterThan(0);

      clearTimeoutSpy.mockRestore();
    });
  });
});
