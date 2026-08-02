import { describe, expect, it } from 'bun:test';
import {
  CreateSchedulePatternDayChildSchema,
  CreateSchedulePatternDaySchema,
  CreateSchedulePatternSchema,
  PauseRangeSchema,
  SCHEDULE_PATTERN_STATUSES,
  SchedulePatternDayChildSchema,
  SchedulePatternDayIdParamSchema,
  SchedulePatternDaySchema,
  SchedulePatternIdParamSchema,
  SchedulePatternSchema,
  UpdateSchedulePatternDaySchema,
  UpdateSchedulePatternSchema,
} from '../src/schemas/schedule.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T10:00:00Z';

describe('schedule.schema', () => {
  describe('const-maps match the SQL check constraints', () => {
    // The `: string[]` annotation widens Object.values()'s inferred
    // literal-union return type so it unifies with the plain array literal
    // on the other side of toEqual(). Both sides are sorted so the assertion
    // doesn't depend on key declaration order.
    it('SCHEDULE_PATTERN_STATUSES matches schedule_patterns.status', () => {
      const values: string[] = Object.values(SCHEDULE_PATTERN_STATUSES);
      expect(values.sort()).toEqual(
        [
          'draft',
          'pending',
          'accepted',
          'declined',
          'withdrawn',
          'ended',
        ].sort()
      );
    });
  });

  describe('PauseRangeSchema', () => {
    it('parses a valid from/to pair', () => {
      expect(
        PauseRangeSchema.safeParse({ from: '2026-07-21', to: '2026-09-01' })
          .success
      ).toBe(true);
    });

    it('rejects a malformed date', () => {
      expect(
        PauseRangeSchema.safeParse({ from: '21/07/2026', to: '2026-09-01' })
          .success
      ).toBe(false);
    });
  });

  describe('SchedulePatternSchema', () => {
    const validPattern = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: null,
      status: 'draft',
      rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH',
      dtstart: '2026-08-03',
      until: null,
      exdates: [],
      pause_ranges: [{ from: '2026-07-21', to: '2026-09-01' }],
      timezone: 'Europe/London',
      note: null,
      decline_message: null,
      created_by: VALID_UUID,
      sent_at: null,
      responded_at: null,
      ical_uid: 'abc-123',
      sequence: 0,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid pattern', () => {
      expect(SchedulePatternSchema.safeParse(validPattern).success).toBe(true);
    });

    it('rejects an invalid status', () => {
      expect(
        SchedulePatternSchema.safeParse({ ...validPattern, status: 'agreed' })
          .success
      ).toBe(false);
    });

    it('rejects a missing required field', () => {
      const { rrule: _rrule, ...rest } = validPattern;
      expect(SchedulePatternSchema.safeParse(rest).success).toBe(false);
    });
  });

  describe('CreateSchedulePatternSchema', () => {
    it('accepts a minimal body without timezone (server-derived)', () => {
      const result = CreateSchedulePatternSchema.safeParse({
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        dtstart: '2026-08-03',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a missing rrule', () => {
      expect(
        CreateSchedulePatternSchema.safeParse({ dtstart: '2026-08-03' }).success
      ).toBe(false);
    });
  });

  describe('UpdateSchedulePatternSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateSchedulePatternSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a status-only update', () => {
      expect(
        UpdateSchedulePatternSchema.safeParse({ status: 'withdrawn' }).success
      ).toBe(true);
    });
  });

  describe('SchedulePatternIdParamSchema', () => {
    it('rejects a non-uuid', () => {
      expect(
        SchedulePatternIdParamSchema.safeParse({ patternId: 'x' }).success
      ).toBe(false);
    });
  });

  describe('SchedulePatternDaySchema', () => {
    const validDay = {
      id: VALID_UUID,
      pattern_id: VALID_UUID,
      weekday: 4,
      start_time: '08:00',
      end_time: '17:00',
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid day', () => {
      expect(SchedulePatternDaySchema.safeParse(validDay).success).toBe(true);
    });

    it('rejects a weekday out of range', () => {
      expect(
        SchedulePatternDaySchema.safeParse({ ...validDay, weekday: 8 }).success
      ).toBe(false);
    });
  });

  describe('CreateSchedulePatternDaySchema', () => {
    it('accepts a valid day', () => {
      const result = CreateSchedulePatternDaySchema.safeParse({
        weekday: 4,
        start_time: '08:00',
        end_time: '17:00',
      });
      expect(result.success).toBe(true);
    });

    it('rejects end_time before start_time', () => {
      const result = CreateSchedulePatternDaySchema.safeParse({
        weekday: 4,
        start_time: '17:00',
        end_time: '08:00',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateSchedulePatternDaySchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateSchedulePatternDaySchema.safeParse({}).success).toBe(false);
    });
  });

  describe('SchedulePatternDayIdParamSchema', () => {
    it('rejects a non-uuid', () => {
      expect(
        SchedulePatternDayIdParamSchema.safeParse({ patternDayId: 'x' }).success
      ).toBe(false);
    });
  });

  describe('SchedulePatternDayChildSchema', () => {
    const validDayChild = {
      id: VALID_UUID,
      pattern_day_id: VALID_UUID,
      child_id: VALID_UUID,
      start_time: null,
      end_time: null,
      created_at: NOW,
    };

    it('parses a whole-shift row (both times null)', () => {
      expect(
        SchedulePatternDayChildSchema.safeParse(validDayChild).success
      ).toBe(true);
    });

    it('parses a windowed row (both times set)', () => {
      expect(
        SchedulePatternDayChildSchema.safeParse({
          ...validDayChild,
          start_time: '08:00',
          end_time: '09:00',
        }).success
      ).toBe(true);
    });
  });

  describe('CreateSchedulePatternDayChildSchema', () => {
    it('accepts both times omitted', () => {
      expect(
        CreateSchedulePatternDayChildSchema.safeParse({ child_id: VALID_UUID })
          .success
      ).toBe(true);
    });

    it('accepts both times set', () => {
      const result = CreateSchedulePatternDayChildSchema.safeParse({
        child_id: VALID_UUID,
        start_time: '08:00',
        end_time: '09:00',
      });
      expect(result.success).toBe(true);
    });

    it('rejects one-sided times', () => {
      const result = CreateSchedulePatternDayChildSchema.safeParse({
        child_id: VALID_UUID,
        start_time: '08:00',
      });
      expect(result.success).toBe(false);
    });
  });
});
