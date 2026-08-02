/**
 * @module StatusPillTests
 *
 * TDD tests for StatusPill. Product rule under test: conflicts (short-notice,
 * outside-hours) warn but never block, so they must use the warning treatment
 * — never destructive. Semantic colour lives on the text node (Ledger annotation).
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

  it('uses destructive for declined (on the text node)', () => {
    const { getByTestId } = render(
      <StatusPill variant="declined" label="Declined" testID="pill-declined" />
    );
    expect(getByTestId('pill-declined-label').props.className).toContain(
      'destructive'
    );
  });

  it('uses the warning treatment for short-notice, never destructive', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="short-notice"
        label="Short notice"
        testID="pill-sn"
      />
    );
    const label = getByTestId('pill-sn-label');
    expect(label.props.className).toContain('warning');
    expect(label.props.className).not.toContain('destructive');
  });

  it('uses the warning treatment for outside-hours, never destructive', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="outside-hours"
        label="Outside hours"
        testID="pill-oh"
      />
    );
    const label = getByTestId('pill-oh-label');
    expect(label.props.className).toContain('warning');
    expect(label.props.className).not.toContain('destructive');
  });
});
