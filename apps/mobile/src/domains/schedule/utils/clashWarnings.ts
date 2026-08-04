/**
 * @module domains/schedule/utils/clashWarnings
 *
 * Presentation helpers for non-blocking clash warnings returned from
 * shift/pattern write paths. Empty-availability OUTSIDE_AVAILABILITY
 * suppression lives server-side (`collectClashWarnings`).
 */
import {
  CLASH_WARNING_KINDS,
  type ClashWarning,
} from '@steadily-nanny/shared-types/schemas/me.schema';

export function clashWarningMessageKey(
  warning: ClashWarning
): 'clash.busyOverlap' | 'clash.outsideAvailability' {
  if (warning.kind === CLASH_WARNING_KINDS.BUSY_OVERLAP) {
    return 'clash.busyOverlap';
  }
  return 'clash.outsideAvailability';
}
