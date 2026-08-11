/**
 * The preset library is DATA, and these tests guard the two things about it
 * that are not arithmetic:
 *
 *  1. **The figures are §5.3's, exactly.** A preset whose numbers nobody
 *     verified is worse than shipping none — the disclaimer buys legal cover
 *     and buys no trust at all, and the first family whose $1,540 week comes
 *     back from payroll as $1,596 never believes the app again
 *     (`docs/design/screens-pay-terms.md` §5.3).
 *  2. **No user-facing string names a state** (§5 D-44, owner verbatim:
 *     *"Don't mention California defaults anywhere at all"*). The data file
 *     keeps `jurisdiction: 'CA'` as internal provenance, and that is the ONLY
 *     place a state may appear.
 *
 * The pricing behaviour of these values is pinned in the engine's own case
 * table (`apps/api/tests/unit/domains/pay/services/earningsService.test.ts`),
 * which also asserts the preset prices identically to the same figures typed
 * by hand. Nothing here computes money.
 */
import { describe, expect, it } from 'bun:test';
import {
  COMMON_DEFAULTS_PRESET,
  isPresetReviewStale,
  PAY_TERMS_PRESETS_BY_JURISDICTION,
  presetFor,
} from '../src/payTermsPresets';

describe('payTermsPresets — the launch preset carries §5.3’s figures', () => {
  it('is daily 8h at 1.5x, weekly 40h at 1.5x, double time 12h at 2x, seventh day 1.5x then 2x after 8h', () => {
    expect(COMMON_DEFAULTS_PRESET.values).toEqual({
      overtime_threshold_minutes: 2400, // 40h
      overtime_multiplier: 1.5,
      overtime_daily_threshold_minutes: 480, // 8h
      doubletime_daily_threshold_minutes: 720, // 12h
      doubletime_multiplier: 2,
      seventh_day_multiplier: 1.5,
      seventh_day_doubletime_after_minutes: 480, // 8h
    });
  });

  it('states its thresholds in MINUTES, the unit the columns hold', () => {
    // An hours-valued preset would need a converter somewhere between here
    // and the insert, and that converter is where a factor-of-60 defect
    // lives. Every threshold below is a whole number of minutes.
    for (const key of [
      'overtime_threshold_minutes',
      'overtime_daily_threshold_minutes',
      'doubletime_daily_threshold_minutes',
      'seventh_day_doubletime_after_minutes',
    ] as const) {
      expect(Number.isInteger(COMMON_DEFAULTS_PRESET.values[key])).toBe(true);
      expect(COMMON_DEFAULTS_PRESET.values[key]).toBeGreaterThan(0);
    }
  });

  it('orders the daily tiers the way migration 078’s CHECK requires', () => {
    // A preset that could not be saved is not a preset. 078 refuses
    // `doubletime_daily_threshold_minutes <= overtime_daily_threshold_minutes`.
    expect(
      COMMON_DEFAULTS_PRESET.values.doubletime_daily_threshold_minutes
    ).toBeGreaterThan(
      COMMON_DEFAULTS_PRESET.values.overtime_daily_threshold_minutes
    );
  });

  it('keeps every multiplier inside numeric(3,2)', () => {
    for (const key of [
      'overtime_multiplier',
      'doubletime_multiplier',
      'seventh_day_multiplier',
    ] as const) {
      const value = COMMON_DEFAULTS_PRESET.values[key];
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(9.99);
      expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(
        1e-9
      );
    }
  });

  it('carries the provenance §5.4 requires: an id, a version, and a dated human review', () => {
    expect(COMMON_DEFAULTS_PRESET.id).toBe('common-defaults');
    expect(COMMON_DEFAULTS_PRESET.version).toBe(1);
    expect(COMMON_DEFAULTS_PRESET.reviewed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Not blank, and not the implementation session: §5.3 is explicit that
    // this must name whoever actually signed the figures off.
    expect(COMMON_DEFAULTS_PRESET.reviewed_by.trim().length).toBeGreaterThan(0);
  });
});

describe('payTermsPresets — no user-facing string names a state (D-44)', () => {
  it('carries the state ONLY as the internal jurisdiction key', () => {
    // `jurisdiction` is the one field §5.4 explicitly keeps ("The preset data
    // file still carries `jurisdiction: 'CA'` for that reason") and the one
    // field nothing may render.
    expect(COMMON_DEFAULTS_PRESET.jurisdiction).toBe('CA');
  });

  it('exposes no copy at all — the strings live in pay.json', () => {
    // The strongest form of "no state name in any user-facing string" is that
    // this module has no user-facing string to put one in. A label, title or
    // hint added here is the regression this test exists to catch.
    const rendered = JSON.stringify({
      ...COMMON_DEFAULTS_PRESET,
      jurisdiction: undefined,
      reviewed_by: undefined,
    });
    for (const banned of [
      'california',
      'California',
      'CA ',
      'Wage Order',
      'wage order',
    ]) {
      expect(rendered).not.toContain(banned);
    }
    // And no field that would obviously be copy.
    for (const key of ['label', 'title', 'name', 'description', 'hint']) {
      expect(COMMON_DEFAULTS_PRESET).not.toHaveProperty(key);
    }
  });
});

describe('payTermsPresets — presetFor', () => {
  it('returns the jurisdiction’s preset when there is one', () => {
    expect(presetFor('CA')).toBe(COMMON_DEFAULTS_PRESET);
    expect(PAY_TERMS_PRESETS_BY_JURISDICTION.CA).toBe(COMMON_DEFAULTS_PRESET);
  });

  it('offers the same unlabelled preset to a household with NO jurisdiction (§5.4)', () => {
    // 1-B shipped `households.jurisdiction` as null until a parent sets it in
    // settings, and it is not device-derivable — so null is the COMMON case,
    // not an edge one. §5.4 ships one preset "offered to every household
    // regardless of jurisdiction", so null must not mean "no help".
    expect(presetFor(null)).toBe(COMMON_DEFAULTS_PRESET);
    expect(presetFor(undefined)).toBe(COMMON_DEFAULTS_PRESET);
    expect(presetFor('')).toBe(COMMON_DEFAULTS_PRESET);
  });

  it('falls back for a state with no preset of its own', () => {
    expect(presetFor('NY')).toBe(COMMON_DEFAULTS_PRESET);
  });
});

describe('payTermsPresets — the reviewed_on staleness gate (§5.2)', () => {
  const preset = { ...COMMON_DEFAULTS_PRESET, reviewed_on: '2026-08-11' };

  it('is fresh on the review date itself', () => {
    expect(isPresetReviewStale(preset, '2026-08-11')).toBe(false);
  });

  it('is fresh at exactly twelve months', () => {
    expect(isPresetReviewStale(preset, '2027-08-11')).toBe(false);
  });

  it('is stale the day after twelve months', () => {
    expect(isPresetReviewStale(preset, '2027-08-12')).toBe(true);
  });

  it('is stale years later', () => {
    expect(isPresetReviewStale(preset, '2030-01-01')).toBe(true);
  });

  it('rolls the horizon across a year boundary', () => {
    const december = { ...preset, reviewed_on: '2026-12-31' };
    expect(isPresetReviewStale(december, '2027-12-31')).toBe(false);
    expect(isPresetReviewStale(december, '2028-01-01')).toBe(true);
  });
});
