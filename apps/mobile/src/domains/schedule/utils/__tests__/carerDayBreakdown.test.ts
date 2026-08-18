/**
 * @module domains/schedule/utils/__tests__/carerDayBreakdown
 */
import { describe, expect, it } from 'bun:test';
import { carerDayBreakdown } from '../carerDayBreakdown';

describe('carerDayBreakdown', () => {
  it('counts each carer’s own distinct covering days, never summed', () => {
    const carers = [
      { userId: 'priya', name: 'Priya' },
      { userId: 'maya', name: 'Maya' },
    ];
    const shifts = [
      { carer_id: 'priya', local_date: '2026-08-03' },
      { carer_id: 'priya', local_date: '2026-08-04' },
      { carer_id: 'priya', local_date: '2026-08-05' },
      { carer_id: 'maya', local_date: '2026-08-06' },
      { carer_id: 'maya', local_date: '2026-08-07' },
    ];

    expect(carerDayBreakdown(carers, shifts)).toEqual([
      { carerId: 'priya', name: 'Priya', days: 3 },
      { carerId: 'maya', name: 'Maya', days: 2 },
    ]);
  });

  it('two shifts on the same day for the same carer count as one day', () => {
    const carers = [{ userId: 'priya', name: 'Priya' }];
    const shifts = [
      { carer_id: 'priya', local_date: '2026-08-03' },
      { carer_id: 'priya', local_date: '2026-08-03' },
    ];
    expect(carerDayBreakdown(carers, shifts)).toEqual([
      { carerId: 'priya', name: 'Priya', days: 1 },
    ]);
  });

  it('a carer with no shifts this week gets 0, not omitted', () => {
    const carers = [
      { userId: 'priya', name: 'Priya' },
      { userId: 'maya', name: 'Maya' },
    ];
    const shifts = [{ carer_id: 'priya', local_date: '2026-08-03' }];
    expect(carerDayBreakdown(carers, shifts)).toEqual([
      { carerId: 'priya', name: 'Priya', days: 1 },
      { carerId: 'maya', name: 'Maya', days: 0 },
    ]);
  });

  it('never attributes another carer’s shift, and null carer_id counts for nobody', () => {
    const carers = [{ userId: 'priya', name: 'Priya' }];
    const shifts = [
      { carer_id: null, local_date: '2026-08-03' },
      { carer_id: 'someone-else', local_date: '2026-08-04' },
    ];
    expect(carerDayBreakdown(carers, shifts)).toEqual([
      { carerId: 'priya', name: 'Priya', days: 0 },
    ]);
  });

  it('empty carer list yields an empty breakdown', () => {
    expect(carerDayBreakdown([], [])).toEqual([]);
  });
});
