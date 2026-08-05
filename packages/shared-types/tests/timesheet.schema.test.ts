import { describe, expect, it } from 'bun:test';
import {
  ClockInSchema,
  ClockOutSchema,
  CreateRetroactiveTimeEntrySchema,
  QueryTimesheetSchema,
  ReopenTimesheetSchema,
  TIME_ENTRY_KINDS,
  TIME_ENTRY_STATUSES,
  TIMESHEET_STATUSES,
  TimeEntrySchema,
  TimesheetSchema,
} from '../src/schemas/timesheet.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T08:00:00Z';
const LATER = '2026-08-01T17:00:00Z';

describe('timesheet.schema', () => {
  describe('const-maps match the SQL check constraints', () => {
    it('TIME_ENTRY_KINDS matches time_entries.kind', () => {
      const values: string[] = Object.values(TIME_ENTRY_KINDS);
      expect(values.sort()).toEqual(
        ['worked', 'cancellation_paid', 'manual_adjustment'].sort()
      );
    });

    it('TIME_ENTRY_STATUSES matches time_entries.status', () => {
      const values: string[] = Object.values(TIME_ENTRY_STATUSES);
      expect(values.sort()).toEqual(
        ['running', 'submitted', 'approved', 'queried'].sort()
      );
    });

    it('TIMESHEET_STATUSES matches timesheets.status', () => {
      const values: string[] = Object.values(TIMESHEET_STATUSES);
      expect(values.sort()).toEqual(
        ['open', 'submitted', 'approved', 'queried'].sort()
      );
    });
  });

  describe('TimeEntrySchema', () => {
    const validEntry = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      carer_display_name: 'Nia Rowe',
      shift_id: VALID_UUID,
      clock_in_at: NOW,
      clock_out_at: LATER,
      break_minutes: 30,
      scheduled_minutes: 480,
      kind: 'worked',
      note: null,
      clock_in_location_ok: true,
      clock_out_location_ok: null,
      status: 'submitted',
      local_date: '2026-08-01',
      timezone: 'Europe/London',
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid time entry', () => {
      expect(TimeEntrySchema.safeParse(validEntry).success).toBe(true);
    });

    it('accepts a null shift_id (unscheduled cover)', () => {
      expect(
        TimeEntrySchema.safeParse({ ...validEntry, shift_id: null }).success
      ).toBe(true);
    });

    it('accepts a running entry with no clock_out_at', () => {
      expect(
        TimeEntrySchema.safeParse({
          ...validEntry,
          clock_out_at: null,
          status: 'running',
          scheduled_minutes: null,
        }).success
      ).toBe(true);
    });

    it('rejects an invalid status', () => {
      expect(
        TimeEntrySchema.safeParse({ ...validEntry, status: 'maybe' }).success
      ).toBe(false);
    });

    it('rejects a missing required field', () => {
      const { household_id: _household_id, ...rest } = validEntry;
      expect(TimeEntrySchema.safeParse(rest).success).toBe(false);
    });

    it('accepts a null carer_id (carer account deleted, payroll record preserved)', () => {
      expect(
        TimeEntrySchema.safeParse({ ...validEntry, carer_id: null }).success
      ).toBe(true);
    });

    it('requires carer_display_name even when carer_id is null', () => {
      const { carer_display_name: _carer_display_name, ...rest } = validEntry;
      expect(
        TimeEntrySchema.safeParse({ ...rest, carer_id: null }).success
      ).toBe(false);
    });
  });

  describe('ClockInSchema', () => {
    it('accepts household_id alone', () => {
      expect(
        ClockInSchema.safeParse({ household_id: VALID_UUID }).success
      ).toBe(true);
    });

    it('accepts an optional shift_id', () => {
      expect(
        ClockInSchema.safeParse({
          household_id: VALID_UUID,
          shift_id: VALID_UUID,
        }).success
      ).toBe(true);
    });

    it('rejects a missing household_id', () => {
      expect(ClockInSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('ClockOutSchema', () => {
    it('accepts an empty body (both fields optional)', () => {
      expect(ClockOutSchema.safeParse({}).success).toBe(true);
    });

    it('rejects a negative break_minutes', () => {
      expect(ClockOutSchema.safeParse({ break_minutes: -5 }).success).toBe(
        false
      );
    });
  });

  describe('TimesheetSchema', () => {
    const validTimesheet = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      carer_display_name: 'Nia Rowe',
      week_start: '2026-08-03',
      total_minutes: 2400,
      status: 'open',
      approved_by: null,
      approved_at: null,
      query_note: null,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid timesheet', () => {
      expect(TimesheetSchema.safeParse(validTimesheet).success).toBe(true);
    });

    it('rejects an invalid status', () => {
      expect(
        TimesheetSchema.safeParse({ ...validTimesheet, status: 'maybe' })
          .success
      ).toBe(false);
    });

    it('accepts a null carer_id (carer account deleted, payroll record preserved)', () => {
      expect(
        TimesheetSchema.safeParse({ ...validTimesheet, carer_id: null }).success
      ).toBe(true);
    });
  });

  describe('QueryTimesheetSchema', () => {
    it('requires a non-empty note', () => {
      expect(QueryTimesheetSchema.safeParse({ note: '' }).success).toBe(false);
      expect(
        QueryTimesheetSchema.safeParse({ note: 'Query Thursday' }).success
      ).toBe(true);
    });
  });

  describe('ReopenTimesheetSchema', () => {
    it('requires a non-empty reason', () => {
      expect(ReopenTimesheetSchema.safeParse({ reason: '' }).success).toBe(
        false
      );
      expect(
        ReopenTimesheetSchema.safeParse({
          reason: 'Thursday hours were wrong',
        }).success
      ).toBe(true);
    });
  });

  describe('CreateRetroactiveTimeEntrySchema', () => {
    it('requires household_id, clock_in_at, and clock_out_at', () => {
      expect(
        CreateRetroactiveTimeEntrySchema.safeParse({
          household_id: VALID_UUID,
          clock_in_at: NOW,
          clock_out_at: LATER,
        }).success
      ).toBe(true);
      expect(
        CreateRetroactiveTimeEntrySchema.safeParse({
          household_id: VALID_UUID,
          clock_in_at: NOW,
        }).success
      ).toBe(false);
    });

    it('accepts optional break_minutes, note, and shift_id', () => {
      expect(
        CreateRetroactiveTimeEntrySchema.safeParse({
          household_id: VALID_UUID,
          clock_in_at: NOW,
          clock_out_at: LATER,
          break_minutes: 30,
          note: 'Forgot to clock in',
          shift_id: VALID_UUID,
        }).success
      ).toBe(true);
    });
  });
});
