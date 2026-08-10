/**
 * @module StatusPillTests
 *
 * TDD tests for StatusPill. Product rule under test: conflicts (short-notice,
 * outside-hours) warn but never block, so they must use the shortNotice
 * treatment — never destructive. Container carries the tint fill; text carries
 * the contrasting label colour.
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

  it('uses destructive fill and text for declined', () => {
    const { getByTestId } = render(
      <StatusPill variant="declined" label="Declined" testID="pill-declined" />
    );
    expect(getByTestId('pill-declined').props.className).toContain(
      'bg-pill-destructive'
    );
    expect(getByTestId('pill-declined-label').props.className).toContain(
      'text-error-inline-text'
    );
  });

  it('uses the shortNotice treatment for short-notice, never destructive', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="short-notice"
        label="Short notice"
        testID="pill-sn"
      />
    );
    const container = getByTestId('pill-sn');
    const label = getByTestId('pill-sn-label');
    expect(container.props.className).toContain('bg-pill-short-notice');
    expect(label.props.className).toContain('text-short-notice-ink');
    expect(label.props.className).not.toContain('destructive');
  });

  it('uses the shortNotice treatment for outside-hours, never destructive', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="outside-hours"
        label="Outside hours"
        testID="pill-oh"
      />
    );
    const container = getByTestId('pill-oh');
    const label = getByTestId('pill-oh-label');
    expect(container.props.className).toContain('bg-pill-short-notice');
    expect(label.props.className).toContain('text-short-notice-ink');
    expect(label.props.className).not.toContain('destructive');
  });

  it('applies success fill on confirmed container', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="confirmed"
        label="Confirmed"
        testID="pill-confirmed-fill"
      />
    );
    expect(getByTestId('pill-confirmed-fill').props.className).toContain(
      'bg-pill-success'
    );
  });

  it('applies secondary fill on cancelled container', () => {
    const { getByTestId } = render(
      <StatusPill
        variant="cancelled"
        label="Cancelled"
        testID="pill-cancelled-fill"
      />
    );
    expect(getByTestId('pill-cancelled-fill').props.className).toContain(
      'bg-secondary'
    );
  });
});
