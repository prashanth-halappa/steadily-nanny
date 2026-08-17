import { describe, expect, it } from 'bun:test';
import { ReplaceSchedulePatternDaysSchema } from '../../../../../src/domains/schedule/schemas';

describe('ReplaceSchedulePatternDaysSchema', () => {
  it('accepts two Monday rows with different start_times', () => {
    expect(
      ReplaceSchedulePatternDaysSchema.safeParse({
        days: [
          {
            weekday: 1,
            start_time: '07:00:00',
            end_time: '13:00:00',
            children: [],
          },
          {
            weekday: 1,
            start_time: '15:00:00',
            end_time: '17:00:00',
            children: [],
          },
        ],
      }).success
    ).toBe(true);
  });

  it('accepts two OVERLAPPING Monday rows', () => {
    // Per GOLDEN-FIXES #27 / supabase/migrations/015_shifts.sql, overlap is legal here.
    // Clashes warn and never block. The mobile UI refuses overlap separately; the wire schema does not.
    expect(
      ReplaceSchedulePatternDaysSchema.safeParse({
        days: [
          {
            weekday: 1,
            start_time: '07:00:00',
            end_time: '13:00:00',
            children: [],
          },
          {
            weekday: 1,
            start_time: '12:00:00',
            end_time: '18:00:00',
            children: [],
          },
        ],
      }).success
    ).toBe(true);
  });

  it('rejects two rows sharing the same (weekday, start_time)', () => {
    expect(
      ReplaceSchedulePatternDaysSchema.safeParse({
        days: [
          {
            weekday: 1,
            start_time: '07:00:00',
            end_time: '13:00:00',
            children: [],
          },
          {
            weekday: 1,
            start_time: '07:00:00',
            end_time: '18:00:00',
            children: [],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('still rejects a row where end_time <= start_time', () => {
    expect(
      ReplaceSchedulePatternDaysSchema.safeParse({
        days: [
          {
            weekday: 1,
            start_time: '13:00:00',
            end_time: '07:00:00',
            children: [],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('still accepts an ordinary one-row-per-weekday week', () => {
    expect(
      ReplaceSchedulePatternDaysSchema.safeParse({
        days: [
          {
            weekday: 1,
            start_time: '07:00:00',
            end_time: '13:00:00',
            children: [],
          },
          {
            weekday: 2,
            start_time: '07:00:00',
            end_time: '13:00:00',
            children: [],
          },
        ],
      }).success
    ).toBe(true);
  });
});
