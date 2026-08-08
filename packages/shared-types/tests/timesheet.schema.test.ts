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
/** A `household_members.id` — deliberately different from the carer's id. */
const MEMBER_UUID = '22222222-2222-4222-8222-222222222222';
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

    // 'voided' added by 069_time_entry_void.sql, which drops and re-adds
    // `time_entries_status_check` with the wider set. If this assertion and
    // that CHECK ever disagree, a write the types allow is refused by the DB.
    it('TIME_ENTRY_STATUSES matches time_entries.status', () => {
      const values: string[] = Object.values(TIME_ENTRY_STATUSES);
      expect(values.sort()).toEqual(
        ['running', 'submitted', 'approved', 'queried', 'voided'].sort()
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

    // Migration 058. `carer_id` alone stops being an identity the moment the
    // account is deleted, and two departed carers who shared a display name
    // then merge into one bucket on every parent surface. The membership id
    // is stamped at insert and survives the deletion — but only if it
    // actually reaches the client, and a zod object STRIPS what it does not
    // declare.
    it('carries household_member_id through to the parsed row', () => {
      const parsed = TimeEntrySchema.parse({
        ...validEntry,
        household_member_id: MEMBER_UUID,
      });
      expect(parsed.household_member_id).toBe(MEMBER_UUID);
    });

    it('accepts a row with no household_member_id at all (pre-058 data)', () => {
      expect(TimeEntrySchema.safeParse(validEntry).success).toBe(true);
    });

    it('accepts a null household_member_id (inserted with no carer)', () => {
      expect(
        TimeEntrySchema.safeParse({
          ...validEntry,
          household_member_id: null,
        }).success
      ).toBe(true);
    });

    it('rejects a household_member_id that is not a uuid', () => {
      expect(
        TimeEntrySchema.safeParse({
          ...validEntry,
          household_member_id: 'member-1',
        }).success
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
      reopen_reason: null,
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

    // Migration 058 — see TimeEntrySchema's twin above. The week screen picks
    // its carer from the TIMESHEET rows as well as the entries, so the key
    // has to survive on both or the two sides bucket differently.
    it('carries household_member_id through to the parsed row', () => {
      const parsed = TimesheetSchema.parse({
        ...validTimesheet,
        household_member_id: MEMBER_UUID,
      });
      expect(parsed.household_member_id).toBe(MEMBER_UUID);
    });

    it('accepts a timesheet with no household_member_id (pre-058 data)', () => {
      expect(TimesheetSchema.safeParse(validTimesheet).success).toBe(true);
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
