/**
 * The preset library is DATA, and these tests guard the two things about it
 * that are not arithmetic:
 *
 *  1. **The figures are §5.3's, exactly.** A preset whose numbers nobody
 *     verified is worse than shipping none — the disclaimer buys legal cover
 *     and buys no trust at all, and the first family whose $1,540 week comes
 *     back from payroll as $1,596 never believes the app again
 *     (`docs/design/screens-pay-terms.md` §5.3).
 *  2. **There is no jurisdiction concept here at all** (§5 D-52, extending
 *     D-44). Owner verbatim: *"We should never call out anything about
 *     jurisdiction presets anywhere in the app… Just say most common values
 *     are input."* D-44 kept `jurisdiction: 'CA'` as internal provenance and a
 *     `presetFor(jurisdiction)` lookup; D-52 removes both, along with the
 *     `reviewed_on`/`reviewed_by` review metadata and its staleness gate. What
 *     is left is ONE common-defaults values object.
 *
 * The pricing behaviour of these values is pinned in the engine's own case
 * table (`apps/api/tests/unit/domains/pay/services/earningsService.test.ts`),
 * which also asserts the preset prices identically to the same figures typed
 * by hand. Nothing here computes money.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMON_DEFAULTS_PRESET } from '../src/payTermsPresets';

const MODULE_SOURCE = readFileSync(
  join(import.meta.dir, '../src/payTermsPresets.ts'),
  'utf8'
);

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

  it('carries the id and version `terms.preset` stamps, and nothing else', () => {
    // 3-U1 writes `{ id, version, applied_at, confirmed_by }` into
    // `terms.preset` when a family applies one. `id` and `version` are the two
    // halves that have to come from HERE — the other two are facts about the
    // tap. So they stay; every other former field is gone with D-52.
    expect(COMMON_DEFAULTS_PRESET.id).toBe('common-defaults');
    expect(COMMON_DEFAULTS_PRESET.version).toBe(1);
    expect(Object.keys(COMMON_DEFAULTS_PRESET).sort()).toEqual([
      'id',
      'values',
      'version',
    ]);
  });
});

describe('payTermsPresets — D-52: no jurisdiction, no review metadata', () => {
  it('carries no jurisdiction, reviewed_on or reviewed_by field', () => {
    for (const key of ['jurisdiction', 'reviewed_on', 'reviewed_by']) {
      expect(COMMON_DEFAULTS_PRESET).not.toHaveProperty(key);
    }
  });

  it('exports no lookup and no staleness gate', () => {
    // A source-level assertion rather than an import, because a removed export
    // cannot be imported to be asserted absent — the import would simply fail
    // to typecheck. The names are the contract; if one comes back, so does the
    // concept D-52 deleted. Prose is exempt: the owner's own words are quoted
    // in the module doc, and losing them would lose the reason.
    for (const removed of [
      'presetFor',
      'PAY_TERMS_PRESETS_BY_JURISDICTION',
      'isPresetReviewStale',
      'jurisdiction:',
      'reviewed_on',
      'reviewed_by',
    ]) {
      expect(MODULE_SOURCE).not.toContain(removed);
    }
  });

  it('names no state anywhere in the module, not even as a comment', () => {
    // D-44 allowed 'CA' to survive as an internal provenance record and a
    // spec-internal comment. D-52 does not: the figures are "the most common
    // values" and the app never says whose law they came from.
    for (const banned of [
      'california',
      'California',
      'Wage Order',
      'wage order',
    ]) {
      expect(MODULE_SOURCE).not.toContain(banned);
    }
  });

  it('exposes no copy at all — the strings live in pay.json', () => {
    // The strongest form of "no user-facing string names a jurisdiction" is
    // that this module has no user-facing string to put one in. A label, title
    // or hint added here is the regression this test exists to catch.
    for (const key of ['label', 'title', 'name', 'description', 'hint']) {
      expect(COMMON_DEFAULTS_PRESET).not.toHaveProperty(key);
    }
  });
});
