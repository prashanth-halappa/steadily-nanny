/**
 * @module StatusPillTests
 *
 * TDD tests for StatusPill. Product rule under test: conflicts (short-notice,
 * outside-hours) warn but never block, so they must use the warm amber
 * warning treatment — never destructive red.
 */

import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import { StatusPill } from '../status-pill';

describe('StatusPill', () => {
  it('renders the given label', () => {
    const { getByText } = render(
      <StatusPill variant="confirmed" label="Confirmed" testID="pill" />
    );
    expect(getByText('Confirmed')).toBeTruthy();
  });

  it('supports testID passthrough', () => {
    const { getByTestId } = render(
      <StatusPill variant="pending" label="Pending" testID="status-pill-1" />
    );
    expect(getByTestId('status-pill-1')).toBeTruthy();
  });

  it('renders the confirmed variant without crashing', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="confirmed"
        label="Confirmed"
        testID="pill-confirmed"
      />
    );
    expect(getByTestId('pill-confirmed')).toBeTruthy();
  });

  it('renders the pending variant without crashing', () => {
    const { getByTestId } = render(
      <StatusPill variant="pending" label="Pending" testID="pill-pending" />
    );
    expect(getByTestId('pill-pending')).toBeTruthy();
  });

  it('renders the cancelled variant without crashing', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="cancelled"
        label="Cancelled"
        testID="pill-cancelled"
      />
    );
    expect(getByTestId('pill-cancelled')).toBeTruthy();
  });

  it('uses destructive red for declined', () => {
    const { getByTestId } = render(
      <StatusPill variant="declined" label="Declined" testID="pill-declined" />
    );
    expect(getByTestId('pill-declined').props.className).toContain(
      'destructive'
    );
  });

  it('uses the warning (amber) treatment for short-notice, never destructive red', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="short-notice"
        label="Short notice"
        testID="pill-sn"
      />
    );
    const pill = getByTestId('pill-sn');
    expect(pill.props.className).toContain('warning');
    expect(pill.props.className).not.toContain('destructive');
  });

  it('uses the warning (amber) treatment for outside-hours, never destructive red', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="outside-hours"
        label="Outside hours"
        testID="pill-oh"
      />
    );
    const pill = getByTestId('pill-oh');
    expect(pill.props.className).toContain('warning');
    expect(pill.props.className).not.toContain('destructive');
  });
});
