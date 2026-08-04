/**
 * @module lib/clashWarningToast
 *
 * Surfaces clash warnings as non-blocking toasts after a write.
 * Filtering of empty-availability OUTSIDE_AVAILABILITY is server-side.
 */
import type { ClashWarning } from '@steadily-nanny/shared-types/schemas/me.schema';
import { clashWarningMessageKey } from '@/src/domains/schedule/utils/clashWarnings';
import { showWarningToast } from '@/src/lib/toast';

/** Narrow translate fn — avoids fighting i18next's overloaded TFunction generics. */
type Translate = (key: string) => string;

export function showClashWarningToasts(
  warnings: readonly ClashWarning[] | undefined,
  t: Translate
): void {
  if (!warnings || warnings.length === 0) return;
  for (const warning of warnings) {
    showWarningToast(t(`schedule:${clashWarningMessageKey(warning)}`));
  }
}
