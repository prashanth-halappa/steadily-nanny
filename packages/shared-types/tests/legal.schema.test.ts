import { describe, expect, it } from 'bun:test';
import {
  AcceptLegalRequestSchema,
  CURRENT_LEGAL_VERSION,
  LegalStatusSchema,
  needsLegalAcceptance,
} from '../src/schemas/legal.schema';

describe('legal.schema', () => {
  describe('CURRENT_LEGAL_VERSION', () => {
    it('matches the active legal version date', () => {
      expect(CURRENT_LEGAL_VERSION).toBe('2026-11-24');
    });
  });

  describe('LegalStatusSchema', () => {
    const validAcceptedStatus = {
      currentVersion: CURRENT_LEGAL_VERSION,
      acceptedVersion: CURRENT_LEGAL_VERSION,
      acceptedAt: '2026-11-24T12:00:00.000Z',
      needsAcceptance: false,
    };

    const validUnacceptedStatus = {
      currentVersion: CURRENT_LEGAL_VERSION,
      acceptedVersion: null,
      acceptedAt: null,
      needsAcceptance: true,
    };

    it('parses a valid accepted status', () => {
      expect(LegalStatusSchema.safeParse(validAcceptedStatus).success).toBe(
        true
      );
    });

    it('parses a valid unaccepted status with nullable fields', () => {
      expect(LegalStatusSchema.safeParse(validUnacceptedStatus).success).toBe(
        true
      );
    });

    it('rejects missing currentVersion', () => {
      const { currentVersion: _omitted, ...rest } = validAcceptedStatus;
      expect(LegalStatusSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects empty currentVersion', () => {
      expect(
        LegalStatusSchema.safeParse({
          ...validAcceptedStatus,
          currentVersion: '',
        }).success
      ).toBe(false);
    });

    it('rejects missing acceptedVersion', () => {
      const { acceptedVersion: _omitted, ...rest } = validAcceptedStatus;
      expect(LegalStatusSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects missing acceptedAt', () => {
      const { acceptedAt: _omitted, ...rest } = validAcceptedStatus;
      expect(LegalStatusSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects missing needsAcceptance', () => {
      const { needsAcceptance: _omitted, ...rest } = validAcceptedStatus;
      expect(LegalStatusSchema.safeParse(rest).success).toBe(false);
    });
  });

  describe('AcceptLegalRequestSchema', () => {
    it('accepts a minimal payload with only version', () => {
      const result = AcceptLegalRequestSchema.safeParse({
        version: CURRENT_LEGAL_VERSION,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ version: CURRENT_LEGAL_VERSION });
      }
    });

    it('accepts valid payloads with platform and appVersion', () => {
      for (const platform of ['ios', 'android', 'web'] as const) {
        const result = AcceptLegalRequestSchema.safeParse({
          version: CURRENT_LEGAL_VERSION,
          platform,
          appVersion: '1.0.0',
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts a version of exactly 32 characters', () => {
      expect(
        AcceptLegalRequestSchema.safeParse({
          version: 'a'.repeat(32),
        }).success
      ).toBe(true);
    });

    it('rejects an empty version', () => {
      expect(
        AcceptLegalRequestSchema.safeParse({
          version: '',
        }).success
      ).toBe(false);
    });

    it('rejects a version longer than 32 characters', () => {
      expect(
        AcceptLegalRequestSchema.safeParse({
          version: 'a'.repeat(33),
        }).success
      ).toBe(false);
    });

    it('rejects an unknown platform', () => {
      expect(
        AcceptLegalRequestSchema.safeParse({
          version: CURRENT_LEGAL_VERSION,
          platform: 'windows',
        }).success
      ).toBe(false);
    });

    it('rejects an appVersion longer than 32 characters', () => {
      expect(
        AcceptLegalRequestSchema.safeParse({
          version: CURRENT_LEGAL_VERSION,
          appVersion: '1'.repeat(33),
        }).success
      ).toBe(false);
    });
  });

  describe('needsLegalAcceptance', () => {
    it('returns true when acceptedVersion is null', () => {
      expect(needsLegalAcceptance(null)).toBe(true);
    });

    it('returns true when acceptedVersion is an older version', () => {
      expect(needsLegalAcceptance('2025-01-01')).toBe(true);
    });

    it('returns false when acceptedVersion equals CURRENT_LEGAL_VERSION', () => {
      expect(needsLegalAcceptance(CURRENT_LEGAL_VERSION)).toBe(false);
    });

    it('compares against an explicit currentVersion argument when provided', () => {
      expect(needsLegalAcceptance('2027-01-01', '2027-01-01')).toBe(false);
      expect(needsLegalAcceptance(CURRENT_LEGAL_VERSION, '2027-01-01')).toBe(
        true
      );
    });
  });
});
