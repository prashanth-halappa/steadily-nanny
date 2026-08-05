/**
 * @module domains/timesheet/__tests__/reopenedNotice.test
 *
 * TIER0-CX-SPEC.md §8 "Approved week that reopens": the caption "Hours
 * changed after approval, so this week is being worked out again." must show
 * for renders AFTER a timesheet transitions out of 'approved' — but the wire
 * alone cannot distinguish "reopened" from "never approved" (the D1 reopen
 * path nulls `approved_at`, so a reopened row looks identical to a fresh
 * 'submitted' one — `apps/api/src/domains/timesheet/services/timesheetCommandService.ts`).
 * This hook is the one place that remembers the transition happened.
 */
import { describe, expect, it } from 'bun:test';
import { renderHook } from '@testing-library/react-native';
import { useReopenedNotice } from '../utils/reopenedNotice';

describe('useReopenedNotice', () => {
  it('is false while a timesheet has never been seen approved', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: 'submitted' | 'approved' }) =>
        useReopenedNotice('ts-1', status),
      { initialProps: { status: 'submitted' } }
    );
    expect(result.current).toBe(false);

    rerender({ status: 'submitted' });
    expect(result.current).toBe(false);
  });

  it('is false while the timesheet IS approved', () => {
    const { result } = renderHook(() => useReopenedNotice('ts-1', 'approved'));
    expect(result.current).toBe(false);
  });

  it('becomes true the render after approved -> submitted for the SAME id (the reopen)', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: 'submitted' | 'approved' }) =>
        useReopenedNotice('ts-1', status),
      { initialProps: { status: 'approved' as const } }
    );
    expect(result.current).toBe(false);

    rerender({ status: 'submitted' });
    expect(result.current).toBe(true);
  });

  it('becomes true on approved -> queried too (any non-approved status)', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: 'queried' | 'approved' }) =>
        useReopenedNotice('ts-1', status),
      { initialProps: { status: 'approved' as const } }
    );

    rerender({ status: 'queried' });
    expect(result.current).toBe(true);
  });

  it('resets to false once the week is approved again', () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: 'submitted' | 'approved' }) =>
        useReopenedNotice('ts-1', status),
      { initialProps: { status: 'approved' as const } }
    );

    rerender({ status: 'submitted' });
    expect(result.current).toBe(true);

    rerender({ status: 'approved' });
    expect(result.current).toBe(false);
  });

  it('resets when the timesheet id changes (a different week) — never carries a stale notice across weeks', () => {
    const { result, rerender } = renderHook(
      ({ id, status }: { id: string; status: 'submitted' | 'approved' }) =>
        useReopenedNotice(id, status),
      { initialProps: { id: 'ts-1', status: 'approved' as const } }
    );

    rerender({ id: 'ts-1', status: 'submitted' });
    expect(result.current).toBe(true);

    rerender({ id: 'ts-2', status: 'submitted' });
    expect(result.current).toBe(false);
  });

  it('is false when there is no timesheet yet (null id)', () => {
    const { result } = renderHook(() => useReopenedNotice(null, null));
    expect(result.current).toBe(false);
  });
});
