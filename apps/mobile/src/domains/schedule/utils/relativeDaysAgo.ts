/**
 * @module domains/schedule/utils/relativeDaysAgo
 *
 * S6: the parent's pending-week surfaces used to read identically on day 1
 * and day 30 — no sense of how long a sent week has been sitting unanswered.
 * This is the one place that turns `pattern.sent_at` into "Sent today" /
 * "Sent {{count}} days ago", so both call sites (the tab banner and the
 * usual-week detail screen) say the same thing the same way.
 *
 * Deliberately just an age readout — no expiry, no new status, no job (owner
 * decision, docs/AS-BUILT-SCHEDULE.md §6 S6). The nanny's side stays silent
 * on purpose; this never renders there.
 */

/** Narrow translate fn — same pattern as `domains/pay/utils/termRows.ts`'s
 * `Translate`, avoids fighting i18next's overloaded `TFunction` generics. */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Whole days between two YYYY-MM-DD calendar dates (UTC, date-portion
 * only) — mirrors `domains/inbox/utils/buildInboxItems.ts`'s `daysBetween`. */
function daysBetween(fromISO: string, toISO: string): number {
  const utcMs = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((utcMs(toISO) - utcMs(fromISO)) / 86_400_000);
}

/**
 * "Sent today" / "Sent 1 day ago" / "Sent 5 days ago". `t` must already be
 * scoped to the `schedule` namespace (both call sites use
 * `useTranslation('schedule')`). A future `sentAt` (clock skew) clamps to
 * "Sent today" rather than a negative count.
 */
export function relativeDaysAgo(
  sentAt: string,
  todayISO: string,
  t: Translate
): string {
  const days = Math.max(0, daysBetween(sentAt, todayISO));
  if (days === 0) return t('pending.sentToday');
  return t('pending.sentAgo', { count: days });
}
