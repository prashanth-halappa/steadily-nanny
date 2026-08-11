/**
 * Jurisdiction presets for pay terms — DATA, not a rule engine.
 * @module packages/shared-types/src/payTermsPresets
 *
 * READ FIRST: `docs/design/screens-pay-terms.md` §5 and playbook §5 D-7,
 * D-43, D-44. Those three decisions are what this file is; everything below
 * is their transcription.
 *
 * **A preset is a set of numbers with provenance.** Applying one FILLS FORM
 * FIELDS and nothing else — it saves nothing, it decides nothing at pricing
 * time, and `earningsService` never imports this module. Every value here
 * lands in a `pay_arrangements` column (041 + 078) and is priced from the
 * ROW, exactly as a hand-typed number would be. If a preset ever needed
 * branching logic, that would mean the arrangement columns cannot express a
 * real term — and the fix would be a column, not a rule here.
 *
 * **The values are CA Wage Order 15 (§5.3), and the UI never says so.**
 * D-44, owner verbatim: *"Don't mention California defaults anywhere at all
 * for that matter."* No user-visible string in this app names a state — not
 * a button, a sheet title, a hint, a history row, or an accessibility label.
 * That is why this module exports NO copy: the strings live in
 * `en/pay.json` / `es/pay.json` and say "common defaults". The
 * `jurisdiction` field below is the internal provenance record §5.4
 * explicitly keeps ("The preset data file still carries `jurisdiction: 'CA'`
 * for that reason"), and it must never be rendered.
 *
 * **One preset ships** (§5.4). `presetFor` is keyed by
 * `households.jurisdiction` so a second one lands as data rather than as a
 * client release, but at launch every household is offered the same
 * unlabelled set — which is exactly what the fallback below encodes.
 *
 * **`reviewed_on` is a gate, not a footnote** (§5.2). A preset whose human
 * review is more than twelve months old is stale: the offering surface
 * (3-U1) must warn on it, and a preset with no dated review must not be
 * offered at all. Statutory thresholds move, and a preset library with no
 * staleness signal is a liability the disclaimer does not actually cover.
 */

/** Twelve months, in whole months — the §5.2 staleness horizon. */
const PRESET_REVIEW_MONTHS = 12;

/**
 * The arrangement fields a preset fills. Deliberately the exact column names
 * from 041/078 rather than a bespoke shape: applying a preset is a spread
 * into the create-request body, so any translation layer here would be a
 * second place for a field name to drift (playbook §3's T17 checklist is
 * about precisely that class of silent loss).
 *
 * A field ABSENT from a preset's `values` means the preset has nothing to say
 * about that term — it leaves whatever the form already held. A field present
 * and `null` would be a preset asserting "explicitly no"; none does today.
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

/** One preset file's worth of data — the §5.4 shape, verbatim. */
export interface PayTermsPreset {
  /** Stable identity, written into `terms.preset.id` when applied (§5.2). */
  readonly id: string;
  /** Internal provenance only — NEVER rendered (§5.4, D-44). */
  readonly jurisdiction: string;
  /** Bumped whenever `values` change; written into `terms.preset.version`. */
  readonly version: number;
  /** ISO date of the last HUMAN review of these figures. */
  readonly reviewed_on: string;
  /** Who signed the figures off. Not a machine, and not "the spec". */
  readonly reviewed_by: string;
  readonly values: PayTermsPresetValues;
}

/**
 * The one preset that ships at launch (§5.3's table, transcribed):
 *
 * | Daily overtime          | after 8h in a day, at 1.5x  |
 * | Weekly overtime         | after 40h in the workweek, at 1.5x |
 * | Double time             | after 12h in a day, at 2x   |
 * | Seventh consecutive day | 1.5x, then 2x after 8h      |
 *
 * Minutes, not hours, because that is what the columns hold — 480, 720 and
 * 2400 are 8h, 12h and 40h. Nothing downstream converts.
 */
export const COMMON_DEFAULTS_PRESET: PayTermsPreset = {
  id: 'common-defaults',
  // Provenance, never copy. See the module doc.
  jurisdiction: 'CA',
  version: 1,
  // §5.2's sheet says "Reviewed Aug 2026"; this is the date behind it.
  reviewed_on: '2026-08-11',
  // The owner, in the D-43/D-44 decisions dated 2026-08-11 — the figures were
  // settled there ("Just use CA defaults"), not derived by an implementation
  // session. §5.3 is emphatic that a preset nobody verified is worse than no
  // preset, so this names the decision that verified them.
  reviewed_by: 'owner (playbook §5 D-43/D-44, 2026-08-11)',
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

/**
 * Presets by `households.jurisdiction` (a US state code). One entry today;
 * the map exists so a second jurisdiction is a data change.
 */
export const PAY_TERMS_PRESETS_BY_JURISDICTION: Readonly<
  Record<string, PayTermsPreset>
> = {
  CA: COMMON_DEFAULTS_PRESET,
};

/**
 * The preset to offer a household.
 *
 * At launch this ignores the argument in effect: §5.4 ships ONE unlabelled
 * preset "offered to every household regardless of jurisdiction", so an
 * unknown or null jurisdiction falls back to it rather than offering nothing.
 * The lookup is still keyed, so adding `NY` changes behaviour for a NY
 * household and nobody else.
 *
 * A null jurisdiction is the common case, not an edge one — 1-B shipped it as
 * "not device-derivable, null until set in settings".
 */
export function presetFor(
  jurisdiction: string | null | undefined
): PayTermsPreset {
  if (jurisdiction && PAY_TERMS_PRESETS_BY_JURISDICTION[jurisdiction]) {
    return PAY_TERMS_PRESETS_BY_JURISDICTION[jurisdiction] as PayTermsPreset;
  }
  return COMMON_DEFAULTS_PRESET;
}

/**
 * Is this preset's human review more than twelve months old on `today`?
 *
 * §5.2: a stale preset still renders, in `warningInk`, with the same
 * disclaimer — the signal is loud, not blocking, because a family mid-setup
 * is worse served by an empty group than by a dated number they were told to
 * check. `today` is passed in rather than read from a clock so this stays
 * pure and testable, the same convention as `earningsService`.
 */
export function isPresetReviewStale(
  preset: PayTermsPreset,
  today: string
): boolean {
  const [ry, rm, rd] = preset.reviewed_on.split('-').map(Number);
  const horizon = new Date(
    Date.UTC(ry ?? 0, (rm ?? 1) - 1 + PRESET_REVIEW_MONTHS, rd ?? 1)
  );
  const yy = horizon.getUTCFullYear();
  const mm = String(horizon.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(horizon.getUTCDate()).padStart(2, '0');
  // ISO dates compare correctly as strings — both sides are YYYY-MM-DD.
  return today > `${yy}-${mm}-${dd}`;
}
