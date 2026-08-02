import { describe, expect, it } from 'bun:test';
import {
  CreateShiftChangeRequestSchema,
  CreateShiftChildSchema,
  CreateShiftSchema,
  RespondToShiftChangeRequestSchema,
  SHIFT_CHANGE_REQUEST_KINDS,
  SHIFT_CHANGE_REQUEST_STATUSES,
  SHIFT_KINDS,
  SHIFT_ORIGINS,
  SHIFT_STATUSES,
  ShiftChangeRequestIdParamSchema,
  ShiftChangeRequestSchema,
  ShiftChildIdParamSchema,
  ShiftChildSchema,
  ShiftEventSchema,
  ShiftIdParamSchema,
  ShiftSchema,
  UpdateShiftSchema,
} from '../src/schemas/shift.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T08:00:00Z';
const LATER = '2026-08-01T17:00:00Z';

describe('shift.schema', () => {
  describe('const-maps match the SQL check constraints', () => {
    // The `: string[]` annotation widens Object.values()'s inferred
    // literal-union return type so it unifies with the plain array literal
    // on the other side of toEqual(). Both sides are sorted so the assertion
    // doesn't depend on key declaration order.
    it('SHIFT_KINDS matches shifts.kind', () => {
      const values: string[] = Object.values(SHIFT_KINDS);
      expect(values.sort()).toEqual(
        ['recurring', 'extra', 'cover', 'parent_cover'].sort()
      );
    });

    it('SHIFT_STATUSES matches shifts.status', () => {
      const values: string[] = Object.values(SHIFT_STATUSES);
      expect(values.sort()).toEqual(
        [
          'draft',
          'pending',
          'confirmed',
          'declined',
          'cancelled',
          'completed',
        ].sort()
      );
    });

    it('SHIFT_ORIGINS matches shifts.origin', () => {
      const values: string[] = Object.values(SHIFT_ORIGINS);
      expect(values.sort()).toEqual(
        [
          'system_generated',
          'parent_proposed',
          'nanny_countered',
          'parent_cover',
        ].sort()
      );
    });

    it('SHIFT_CHANGE_REQUEST_KINDS matches shift_change_requests.kind', () => {
      const values: string[] = Object.values(SHIFT_CHANGE_REQUEST_KINDS);
      expect(values.sort()).toEqual(
        ['time_change', 'cancel', 'counter_offer', 'split', 'handover'].sort()
      );
    });

    it('SHIFT_CHANGE_REQUEST_STATUSES matches shift_change_requests.status', () => {
      const values: string[] = Object.values(SHIFT_CHANGE_REQUEST_STATUSES);
      expect(values.sort()).toEqual(
        ['pending', 'accepted', 'declined', 'withdrawn', 'superseded'].sort()
      );
    });
  });

  describe('ShiftSchema', () => {
    const validShift = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      carer_id: VALID_UUID,
      starts_at: NOW,
      ends_at: LATER,
      timezone: 'Europe/London',
      local_date: '2026-08-01',
      kind: 'recurring',
      status: 'confirmed',
      source_pattern_id: null,
      origin: 'system_generated',
      is_short_notice: false,
      note: null,
      reason: null,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_paid: false,
      cancellation_message: null,
      ical_uid: 'abc-123',
      sequence: 0,
      created_by: VALID_UUID,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid shift', () => {
      expect(ShiftSchema.safeParse(validShift).success).toBe(true);
    });

    it('rejects an invalid status', () => {
      expect(
        ShiftSchema.safeParse({ ...validShift, status: 'maybe' }).success
      ).toBe(false);
    });

    it('rejects a missing required field', () => {
      const { starts_at: _starts_at, ...rest } = validShift;
      expect(ShiftSchema.safeParse(rest).success).toBe(false);
    });

    it('accepts a null carer_id (unassigned)', () => {
      expect(
        ShiftSchema.safeParse({ ...validShift, carer_id: null }).success
      ).toBe(true);
    });

    it('parses without shift_children (a caller that read shifts without the join)', () => {
      expect(ShiftSchema.safeParse(validShift).success).toBe(true);
    });

    it('parses WITH shift_children (the actual shape both read endpoints return)', () => {
      const withChildren = {
        ...validShift,
        shift_children: [
          {
            id: VALID_UUID,
            shift_id: VALID_UUID,
            child_id: VALID_UUID,
            starts_at: null,
            ends_at: null,
            created_at: NOW,
          },
        ],
      };
      expect(ShiftSchema.safeParse(withChildren).success).toBe(true);
    });

    it('rejects a malformed shift_children entry rather than silently dropping it', () => {
      const malformed = {
        ...validShift,
        shift_children: [{ id: 'not-a-uuid' }],
      };
      expect(ShiftSchema.safeParse(malformed).success).toBe(false);
    });
  });

  describe('CreateShiftSchema', () => {
    it('accepts a minimal valid body', () => {
      const result = CreateShiftSchema.safeParse({
        starts_at: NOW,
        ends_at: LATER,
        timezone: 'Europe/London',
      });
      expect(result.success).toBe(true);
    });

    it('rejects ends_at before starts_at', () => {
      const result = CreateShiftSchema.safeParse({
        starts_at: LATER,
        ends_at: NOW,
        timezone: 'Europe/London',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a missing timezone', () => {
      const result = CreateShiftSchema.safeParse({
        starts_at: NOW,
        ends_at: LATER,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateShiftSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateShiftSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a status-only update', () => {
      expect(UpdateShiftSchema.safeParse({ status: 'cancelled' }).success).toBe(
        true
      );
    });
  });

  describe('ShiftIdParamSchema', () => {
    it('rejects a non-uuid', () => {
      expect(ShiftIdParamSchema.safeParse({ shiftId: 'x' }).success).toBe(
        false
      );
    });
  });

  describe('ShiftChildSchema / CreateShiftChildSchema', () => {
    it('parses a whole-shift row (both times null)', () => {
      const result = ShiftChildSchema.safeParse({
        id: VALID_UUID,
        shift_id: VALID_UUID,
        child_id: VALID_UUID,
        starts_at: null,
        ends_at: null,
        created_at: NOW,
      });
      expect(result.success).toBe(true);
    });

    it('rejects one-sided times on create', () => {
      const result = CreateShiftChildSchema.safeParse({
        child_id: VALID_UUID,
        starts_at: NOW,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ShiftChildIdParamSchema', () => {
    it('rejects a non-uuid', () => {
      expect(
        ShiftChildIdParamSchema.safeParse({ shiftChildId: 'x' }).success
      ).toBe(false);
    });
  });

  describe('ShiftChangeRequestSchema', () => {
    const validRequest = {
      id: VALID_UUID,
      shift_id: VALID_UUID,
      requested_by: VALID_UUID,
      kind: 'counter_offer',
      proposed_starts_at: NOW,
      proposed_ends_at: LATER,
      message: 'Can do straight after 9am',
      response_message: null,
      status: 'pending',
      responded_by: null,
      responded_at: null,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid change request', () => {
      expect(ShiftChangeRequestSchema.safeParse(validRequest).success).toBe(
        true
      );
    });

    it('rejects an invalid kind', () => {
      expect(
        ShiftChangeRequestSchema.safeParse({
          ...validRequest,
          kind: 'reminder',
        }).success
      ).toBe(false);
    });
  });

  describe('CreateShiftChangeRequestSchema', () => {
    it('accepts a cancel request with no proposed times', () => {
      expect(
        CreateShiftChangeRequestSchema.safeParse({ kind: 'cancel' }).success
      ).toBe(true);
    });

    it('rejects proposed_ends_at before proposed_starts_at', () => {
      const result = CreateShiftChangeRequestSchema.safeParse({
        kind: 'time_change',
        proposed_starts_at: LATER,
        proposed_ends_at: NOW,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RespondToShiftChangeRequestSchema', () => {
    it('accepts accepted', () => {
      expect(
        RespondToShiftChangeRequestSchema.safeParse({ status: 'accepted' })
          .success
      ).toBe(true);
    });

    it('rejects pending (not a valid response)', () => {
      expect(
        RespondToShiftChangeRequestSchema.safeParse({ status: 'pending' })
          .success
      ).toBe(false);
    });
  });

  describe('ShiftChangeRequestIdParamSchema', () => {
    it('rejects a non-uuid', () => {
      expect(
        ShiftChangeRequestIdParamSchema.safeParse({ changeRequestId: 'x' })
          .success
      ).toBe(false);
    });
  });

  describe('ShiftEventSchema', () => {
    it('parses a valid event', () => {
      const result = ShiftEventSchema.safeParse({
        id: VALID_UUID,
        household_id: VALID_UUID,
        shift_id: null,
        local_date: '2026-08-01',
        actor_id: VALID_UUID,
        event_type: 'gap_raised',
        payload: { note: 'no cover Thursday' },
        created_at: NOW,
      });
      expect(result.success).toBe(true);
    });

    it('rejects a missing event_type', () => {
      const result = ShiftEventSchema.safeParse({
        id: VALID_UUID,
        household_id: VALID_UUID,
        shift_id: null,
        local_date: '2026-08-01',
        actor_id: null,
        payload: {},
        created_at: NOW,
      });
      expect(result.success).toBe(false);
    });
  });
});
