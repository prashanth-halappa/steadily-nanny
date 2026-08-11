/**
 * The common-defaults preset for pay terms — DATA, not a rule engine.
 * @module packages/shared-types/src/payTermsPresets
 *
 * READ FIRST: `docs/design/screens-pay-terms.md` §5 and playbook §5 D-7,
 * D-43, D-44, D-52. Those decisions are what this file is; everything below
 * is their transcription.
 *
 * **A preset is a set of numbers.** Applying one FILLS FORM FIELDS and
 * nothing else — it saves nothing, it decides nothing at pricing time, and
 * `earningsService` never imports this module. Every value here lands in a
 * `pay_arrangements` column (041 + 078) and is priced from the ROW, exactly
 * as a hand-typed number would be. If a preset ever needed branching logic,
 * that would mean the arrangement columns cannot express a real term — and
 * the fix would be a column, not a rule here.
 *
 * **ONE preset, keyed by nothing** (D-52, extending D-44). Owner verbatim:
 * *"We should never call out anything about jurisdiction presets anywhere in
 * the app… Just say most common values are input. Make sure that you are
 * complying with local laws and put the onus on the user."* So there is no
 * lookup, no per-state library, and no provenance field naming where these
 * figures come from — a field that exists is a field something eventually
 * renders. The app offers the most common values and says so; whether they
 * comply with the law where a family lives is the family's own
 * responsibility, carried by D-7's confirmation checkbox on the offering
 * surface (3-U1) and by the copy beside it in `en/pay.json` / `es/pay.json`.
 *
 * **This module exports NO copy**, deliberately: there is no string here for
 * a claim about the law to hide in.
 *
 * **No review metadata, and no staleness gate.** D-44 shipped a dated
 * human-review stamp and a twelve-month warning surface on top of it; D-52
 * removes both. A review date is a claim that someone checked these figures
 * against something, which is the legal conclusion the app never owns.
 */

/**
 * The arrangement fields a preset fills. Deliberately the exact column names
 * from 041/078 rather than a bespoke shape: applying a preset is a spread
 * into the create-request body, so any translation layer here would be a
 * second place for a field name to drift (playbook §3's T17 checklist is
 * about precisely that class of silent loss).
 *
 * A field ABSENT from `values` means the preset has nothing to say about that
 * term — it leaves whatever the form already held. A field present and `null`
 * would be a preset asserting "explicitly no"; none does today.
 */
export interface PayTermsPresetValues {
  readonly overtime_threshold_minutes: number;
  readonly overtime_multiplier: number;
  readonly overtime_daily_threshold_minutes: number;
  readonly doubletime_daily_threshold_minutes: number;
  readonly doubletime_multiplier: number;
  readonly seventh_day_multiplier: number;
  readonly seventh_day_doubletime_after_minutes: number;
}

/**
 * The preset's shape after D-52: the values, plus the two identity fields
 * `terms.preset` stamps when a family applies one (3-U1 writes `{ id,
 * version, applied_at, confirmed_by }`; the other two are facts about the
 * tap, not about this module). Nothing else survives — see the module doc.
 */
export interface PayTermsPreset {
  /** Stable identity, written into `terms.preset.id` when applied. */
  readonly id: string;
  /** Bumped whenever `values` change; written into `terms.preset.version`. */
  readonly version: number;
  readonly values: PayTermsPresetValues;
}

/**
 * The one preset that ships (§5.3's table, transcribed):
 *
 * | Daily overtime          | after 8h in a day, at 1.5x  |
 * | Weekly overtime         | after 40h in the workweek, at 1.5x |
 * | Double time             | after 12h in a day, at 2x   |
 * | Seventh consecutive day | 1.5x, then 2x after 8h      |
 *
 * Minutes, not hours, because that is what the columns hold — 480, 720 and
 * 2400 are 8h, 12h and 40h. Nothing downstream converts.
 *
 * This constant IS the accessor: there is one preset and no key to select it
 * by, so a lookup function would be a parameter nobody can vary.
 */
export const COMMON_DEFAULTS_PRESET: PayTermsPreset = {
  id: 'common-defaults',
  version: 1,
  values: {
    overtime_threshold_minutes: 2400,
    overtime_multiplier: 1.5,
    overtime_daily_threshold_minutes: 480,
    doubletime_daily_threshold_minutes: 720,
    doubletime_multiplier: 2,
    seventh_day_multiplier: 1.5,
    seventh_day_doubletime_after_minutes: 480,
  },
};
