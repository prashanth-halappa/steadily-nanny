import { describe, expect, it } from 'bun:test';
import {
  CreateHandoffNoteSchema,
  HANDOFF_PHASES,
  HandoffNoteSchema,
  UpdateHandoffNoteSchema,
} from '../src/schemas/handoff.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-01T10:00:00Z';

describe('handoff.schema', () => {
  it('HANDOFF_PHASES matches handoff_notes.phase', () => {
    const values: string[] = Object.values(HANDOFF_PHASES);
    expect(values.sort()).toEqual(['evening', 'morning'].sort());
  });

  describe('HandoffNoteSchema', () => {
    const valid = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      local_date: '2026-08-01',
      author_id: VALID_UUID,
      phase: 'morning',
      chips: ['slept well'],
      body: null,
      moment_saved_at: null,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid note', () => {
      expect(HandoffNoteSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects an unknown phase', () => {
      expect(
        HandoffNoteSchema.safeParse({ ...valid, phase: 'noon' }).success
      ).toBe(false);
    });
  });

  describe('CreateHandoffNoteSchema', () => {
    it('accepts morning with chips', () => {
      expect(
        CreateHandoffNoteSchema.safeParse({
          local_date: '2026-08-01',
          phase: 'morning',
          chips: ['ate well'],
        }).success
      ).toBe(true);
    });

    it('defaults chips to []', () => {
      const parsed = CreateHandoffNoteSchema.safeParse({
        local_date: '2026-08-01',
        phase: 'evening',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.chips).toEqual([]);
      }
    });
  });

  describe('UpdateHandoffNoteSchema', () => {
    it('rejects an empty patch', () => {
      expect(UpdateHandoffNoteSchema.safeParse({}).success).toBe(false);
    });

    it('accepts save_moment', () => {
      expect(
        UpdateHandoffNoteSchema.safeParse({ save_moment: true }).success
      ).toBe(true);
    });
  });
});
