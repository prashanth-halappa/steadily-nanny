import { describe, expect, it } from 'bun:test';
import {
  isValidIanaTimeZone,
  UpdateProfileSchema,
  UpsertProfileSchema,
} from '../../../src/schemas/user.schema';

describe('isValidIanaTimeZone', () => {
  it('accepts real IANA zone identifiers', () => {
    expect(isValidIanaTimeZone('Europe/London')).toBe(true);
    expect(isValidIanaTimeZone('America/New_York')).toBe(true);
    expect(isValidIanaTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidIanaTimeZone('UTC')).toBe(true);
  });

  it('rejects garbage that is not a real zone', () => {
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(isValidIanaTimeZone('London')).toBe(false);
    expect(isValidIanaTimeZone('')).toBe(false);
    // A UTC OFFSET is not a zone identifier — must not be confused for one.
    expect(isValidIanaTimeZone('+01:00')).toBe(false);
  });
});

describe('UpdateProfileSchema', () => {
  it('accepts a valid IANA timezone', () => {
    const result = UpdateProfileSchema.safeParse({
      timezone: 'Europe/London',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid timezone rather than letting it reach the database', () => {
    const result = UpdateProfileSchema.safeParse({ timezone: 'Mars/Base1' });
    expect(result.success).toBe(false);
  });

  it('accepts week_starts_on within 0-6 (matches the DB check constraint)', () => {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      expect(
        UpdateProfileSchema.safeParse({ week_starts_on: day }).success
      ).toBe(true);
    }
  });

  it('rejects week_starts_on outside 0-6', () => {
    expect(UpdateProfileSchema.safeParse({ week_starts_on: -1 }).success).toBe(
      false
    );
    expect(UpdateProfileSchema.safeParse({ week_starts_on: 7 }).success).toBe(
      false
    );
  });

  it('still accepts the pre-existing profile fields unaffected', () => {
    const result = UpdateProfileSchema.safeParse({
      name: 'Maya',
      city: 'London',
      country: 'UK',
      preferred_locale: 'en-GB',
    });
    expect(result.success).toBe(true);
  });

  it('timezone and week_starts_on are both optional — a PATCH need not touch either', () => {
    const result = UpdateProfileSchema.safeParse({ name: 'Maya' });
    expect(result.success).toBe(true);
  });
});

describe('UpsertProfileSchema', () => {
  it('accepts an optional valid timezone at initial profile creation ("seeded from the device")', () => {
    const result = UpsertProfileSchema.safeParse({
      name: 'Maya',
      timezone: 'America/Los_Angeles',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid timezone at creation', () => {
    const result = UpsertProfileSchema.safeParse({
      name: 'Maya',
      timezone: 'garbage',
    });
    expect(result.success).toBe(false);
  });

  it('omitting timezone entirely is still valid (device seeding is best-effort)', () => {
    const result = UpsertProfileSchema.safeParse({ name: 'Maya' });
    expect(result.success).toBe(true);
  });
});
