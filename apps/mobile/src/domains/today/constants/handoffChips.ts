/**
 * @module domains/today/constants/handoffChips
 *
 * Suggested handoff chips by phase (design flow 1i).
 *
 * The chip a user taps is stored verbatim in `handoff_notes.chips`, so the
 * value MUST be a stable, locale-independent key — the previous version
 * shipped English display strings ("Slept well") straight down the wire, which
 * meant a Spanish-locale user would have persisted "Durmió bien" the moment
 * the labels were translated, and every stored row would have been
 * unqueryable and unrenderable in any other language. The key is the wire
 * value; the label is looked up at render time from the `today` namespace.
 */
import {
  HANDOFF_PHASES,
  type HandoffPhase,
} from '@steadily-nanny/shared-types/schemas/handoff.schema';

export const MORNING_HANDOFF_CHIP_KEYS = [
  'slept_well',
  'rough_night',
  'ate_breakfast',
  'needs_early_pickup',
  'medication_given',
] as const;

export const EVENING_HANDOFF_CHIP_KEYS = [
  'ate_well',
  'good_nap',
  'happy_mood',
  'fussy',
  'outdoor_play',
] as const;

export type HandoffChipKey =
  | (typeof MORNING_HANDOFF_CHIP_KEYS)[number]
  | (typeof EVENING_HANDOFF_CHIP_KEYS)[number];

export function chipsForPhase(phase: HandoffPhase): readonly HandoffChipKey[] {
  return phase === HANDOFF_PHASES.MORNING
    ? MORNING_HANDOFF_CHIP_KEYS
    : EVENING_HANDOFF_CHIP_KEYS;
}

/**
 * i18n key (in the `today` namespace) for a stored chip value. Callers pass
 * `{ defaultValue: chip }` so a value written by a newer client — or by some
 * other surface entirely — still renders as itself rather than as a raw key.
 */
export function handoffChipLabelKey(chip: string): string {
  return `handoff.chips.${chip}`;
}
