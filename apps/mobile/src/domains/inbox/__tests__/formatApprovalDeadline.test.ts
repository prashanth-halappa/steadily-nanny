/**
 * @module domains/inbox/__tests__/formatApprovalDeadline.test
 *
 * Approval auto-approve copy needs minute granularity — date-only
 * ("4 Aug") hid how soon the timeout fires.
 */
import { describe, expect, it } from 'bun:test';
import { formatApprovalDeadline } from '../utils/formatApprovalDeadline';

describe('formatApprovalDeadline', () => {
  it('renders date and time at minute granularity in the household zone', () => {
    const label = formatApprovalDeadline(
      '2026-08-04T12:30:00Z',
      'UTC',
      'en-GB'
    );

    expect(label).toContain('4');
    expect(label).toContain('Aug');
    expect(label).toMatch(/12:30/);
  });

  it('does not truncate to a bare calendar date', () => {
    const label = formatApprovalDeadline(
      '2026-08-04T15:05:00Z',
      'UTC',
      'en-GB'
    );

    expect(label).not.toBe('4 Aug');
    expect(label).toMatch(/15:05/);
  });
});
