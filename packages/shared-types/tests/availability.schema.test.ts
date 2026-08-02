import { describe, expect, it } from 'bun:test';
import {
  AnonymisedBusyBlockSchema,
  BUSY_BLOCK_KINDS,
  CARER_EVENING_MODES,
  CARER_TIME_OFF_STATUSES,
  CarerAvailabilityIdParamSchema,
  CarerAvailabilitySchema,
  CarerTimeOffIdParamSchema,
  CarerTimeOffSchema,
  CreateCarerAvailabilitySchema,
  CreateCarerTimeOffSchema,
  UpdateCarerAvailabilitySchema,
  UpdateCarerTimeOffSchema,
} from '../src/schemas/availability.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T10:00:00Z';

describe('availability.schema', () => {
  describe('const-maps match the SQL check constraints', () => {
    // The `: string[]` annotation widens Object.values()'s inferred
    // literal-union return type so it unifies with the plain array literal
    // on the other side of toEqual(). Both sides are sorted so the assertion
    // doesn't depend on key declaration order.
    it('CARER_EVENING_MODES matches carer_availability.evening_mode', () => {
      const values: string[] = Object.values(CARER_EVENING_MODES);
      expect(values.sort()).toEqual(['never', 'sometimes', 'always'].sort());
    });

    it('CARER_TIME_OFF_STATUSES matches carer_time_off.status', () => {
      const values: string[] = Object.values(CARER_TIME_OFF_STATUSES);
      expect(values.sort()).toEqual(
        ['requested', 'confirmed', 'cancelled'].sort()
      );
    });

    it('BUSY_BLOCK_KINDS matches the v_busy_blocks kind column', () => {
      const values: string[] = Object.values(BUSY_BLOCK_KINDS);
      expect(values.sort()).toEqual(
        ['other_commitment', 'time_off', 'personal'].sort()
      );
    });
  });

  describe('CarerAvailabilitySchema', () => {
    const validAvailability = {
      id: VALID_UUID,
      user_id: VALID_UUID,
      weekday: 1,
      is_available: true,
      earliest_start: '08:00',
      latest_finish: '18:00',
      evening_mode: 'sometimes',
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid row', () => {
      expect(CarerAvailabilitySchema.safeParse(validAvailability).success).toBe(
        true
      );
    });

    it('rejects a weekday out of range', () => {
      expect(
        CarerAvailabilitySchema.safeParse({ ...validAvailability, weekday: 7 })
          .success
      ).toBe(false);
    });

    it('rejects an invalid evening_mode', () => {
      const result = CarerAvailabilitySchema.safeParse({
        ...validAvailability,
        evening_mode: 'weekends',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateCarerAvailabilitySchema / UpdateCarerAvailabilitySchema', () => {
    it('accepts a minimal weekday-only body', () => {
      expect(
        CreateCarerAvailabilitySchema.safeParse({ weekday: 3 }).success
      ).toBe(true);
    });

    it('rejects an empty update', () => {
      expect(UpdateCarerAvailabilitySchema.safeParse({}).success).toBe(false);
    });

    it('accepts a partial update', () => {
      expect(
        UpdateCarerAvailabilitySchema.safeParse({ is_available: false }).success
      ).toBe(true);
    });
  });

  describe('CarerAvailabilityIdParamSchema', () => {
    it('rejects a non-uuid', () => {
      expect(
        CarerAvailabilityIdParamSchema.safeParse({ availabilityId: 'x' })
          .success
      ).toBe(false);
    });
  });

  describe('CarerTimeOffSchema', () => {
    const validTimeOff = {
      id: VALID_UUID,
      user_id: VALID_UUID,
      starts_at: NOW,
      ends_at: '2026-08-02T10:00:00Z',
      all_day: true,
      message: 'Family wedding',
      status: 'confirmed',
      ical_uid: 'abc-123',
      sequence: 0,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid row', () => {
      expect(CarerTimeOffSchema.safeParse(validTimeOff).success).toBe(true);
    });

    it('rejects an invalid status', () => {
      expect(
        CarerTimeOffSchema.safeParse({ ...validTimeOff, status: 'maybe' })
          .success
      ).toBe(false);
    });
  });

  describe('CreateCarerTimeOffSchema', () => {
    it('accepts a valid range', () => {
      const result = CreateCarerTimeOffSchema.safeParse({
        starts_at: NOW,
        ends_at: '2026-08-02T10:00:00Z',
      });
      expect(result.success).toBe(true);
    });

    it('rejects ends_at before starts_at', () => {
      const result = CreateCarerTimeOffSchema.safeParse({
        starts_at: '2026-08-02T10:00:00Z',
        ends_at: NOW,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateCarerTimeOffSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateCarerTimeOffSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a status-only update (e.g. cancelling)', () => {
      expect(
        UpdateCarerTimeOffSchema.safeParse({ status: 'cancelled' }).success
      ).toBe(true);
    });

    it('accepts message: null to clear an existing note', () => {
      expect(
        UpdateCarerTimeOffSchema.safeParse({ message: null }).success
      ).toBe(true);
    });
  });

  describe('CarerTimeOffIdParamSchema', () => {
    it('rejects a non-uuid', () => {
      expect(
        CarerTimeOffIdParamSchema.safeParse({ timeOffId: 'x' }).success
      ).toBe(false);
    });
  });

  describe('AnonymisedBusyBlockSchema — privacy guardrail', () => {
    const validBlock = {
      starts_at: NOW,
      ends_at: '2026-08-01T14:00:00Z',
      kind: 'other_commitment',
    };

    it('parses a valid busy block', () => {
      expect(AnonymisedBusyBlockSchema.safeParse(validBlock).success).toBe(
        true
      );
    });

    it('rejects an invalid kind', () => {
      expect(
        AnonymisedBusyBlockSchema.safeParse({ ...validBlock, kind: 'dentist' })
          .success
      ).toBe(false);
    });

    // GUARDRAIL: this schema must carry EXACTLY starts_at/ends_at/kind and
    // nothing else. A future edit that adds a household id, child, or note
    // field here would leak one family's information to another family that
    // shares the same carer. If this test starts failing because a field was
    // added, that is very likely a privacy regression — see the comment
    // block above AnonymisedBusyBlockSchema before changing this assertion.
    it('has exactly the keys starts_at, ends_at, kind — no more, no less', () => {
      const shape = AnonymisedBusyBlockSchema.shape;
      expect(Object.keys(shape).sort()).toEqual(
        ['starts_at', 'ends_at', 'kind'].sort()
      );
    });

    it('strips unknown fields rather than passing them through', () => {
      const result = AnonymisedBusyBlockSchema.safeParse({
        ...validBlock,
        household_id: VALID_UUID,
        household_name: 'The Reyes Family',
        child_name: 'Maya',
        note: 'dentist appointment',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data).sort()).toEqual(
          ['starts_at', 'ends_at', 'kind'].sort()
        );
      }
    });
  });
});
