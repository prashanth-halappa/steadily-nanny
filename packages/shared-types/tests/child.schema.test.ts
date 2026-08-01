import { describe, expect, it } from 'bun:test';
import {
  CHILD_COMMITMENT_KINDS,
  ChildCommitmentSchema,
  ChildIdParamSchema,
  ChildSchema,
  CreateChildCommitmentSchema,
  CreateChildSchema,
  UpdateChildCommitmentSchema,
  UpdateChildSchema,
} from '../src/schemas/child.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T10:00:00Z';

describe('child.schema', () => {
  describe('const-maps match the SQL check constraints', () => {
    // The `: string[]` annotation widens Object.values()'s inferred
    // literal-union return type so it unifies with the plain array literal
    // on the other side of toEqual(). Both sides are sorted so the assertion
    // doesn't depend on key declaration order.
    it('CHILD_COMMITMENT_KINDS matches child_commitments.kind', () => {
      const values: string[] = Object.values(CHILD_COMMITMENT_KINDS);
      expect(values.sort()).toEqual(
        ['preschool', 'school', 'activity', 'nap', 'other'].sort()
      );
    });
  });

  describe('ChildSchema', () => {
    const validChild = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      name: 'Maya',
      birth_date: '2022-03-14',
      colour: '#FFAA00',
      avatar_initial: 'M',
      routine_notes: 'two naps',
      archived_at: null,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid child', () => {
      expect(ChildSchema.safeParse(validChild).success).toBe(true);
    });

    it('rejects a bad uuid', () => {
      expect(ChildSchema.safeParse({ ...validChild, id: 'nope' }).success).toBe(
        false
      );
    });

    it('rejects a missing required field', () => {
      const { name: _name, ...rest } = validChild;
      expect(ChildSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects a malformed birth_date', () => {
      expect(
        ChildSchema.safeParse({ ...validChild, birth_date: '14-03-2022' })
          .success
      ).toBe(false);
    });

    it('accepts a null birth_date', () => {
      expect(
        ChildSchema.safeParse({ ...validChild, birth_date: null }).success
      ).toBe(true);
    });
  });

  describe('CreateChildSchema', () => {
    it('accepts just a name', () => {
      expect(CreateChildSchema.safeParse({ name: 'Maya' }).success).toBe(true);
    });

    it('rejects an empty name', () => {
      expect(CreateChildSchema.safeParse({ name: '' }).success).toBe(false);
    });
  });

  describe('UpdateChildSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateChildSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a single field', () => {
      expect(
        UpdateChildSchema.safeParse({ routine_notes: 'no dairy' }).success
      ).toBe(true);
    });
  });

  describe('ChildIdParamSchema', () => {
    it('accepts a valid uuid', () => {
      expect(
        ChildIdParamSchema.safeParse({ childId: VALID_UUID }).success
      ).toBe(true);
    });

    it('rejects a non-uuid', () => {
      expect(ChildIdParamSchema.safeParse({ childId: '123' }).success).toBe(
        false
      );
    });
  });

  describe('ChildCommitmentSchema', () => {
    const validCommitment = {
      id: VALID_UUID,
      child_id: VALID_UUID,
      household_id: VALID_UUID,
      kind: 'preschool',
      label: 'Preschool',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
      start_time: '09:00',
      end_time: '12:00',
      starts_on: null,
      ends_on: null,
      exdates: [],
      excluded_from_cover: true,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid commitment', () => {
      expect(ChildCommitmentSchema.safeParse(validCommitment).success).toBe(
        true
      );
    });

    it('rejects an invalid kind', () => {
      expect(
        ChildCommitmentSchema.safeParse({
          ...validCommitment,
          kind: 'swimming',
        }).success
      ).toBe(false);
    });

    it('accepts HH:MM:SS times as well as HH:MM', () => {
      expect(
        ChildCommitmentSchema.safeParse({
          ...validCommitment,
          start_time: '09:00:00',
          end_time: '12:00:00',
        }).success
      ).toBe(true);
    });
  });

  describe('CreateChildCommitmentSchema', () => {
    it('accepts a valid create body', () => {
      const result = CreateChildCommitmentSchema.safeParse({
        label: 'Preschool',
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH',
        start_time: '09:00',
        end_time: '12:00',
      });
      expect(result.success).toBe(true);
    });

    it('rejects end_time before start_time', () => {
      const result = CreateChildCommitmentSchema.safeParse({
        label: 'Preschool',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        start_time: '12:00',
        end_time: '09:00',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateChildCommitmentSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateChildCommitmentSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a single field', () => {
      expect(
        UpdateChildCommitmentSchema.safeParse({ label: 'Nursery' }).success
      ).toBe(true);
    });
  });
});
