/**
 * @module domains/inbox/utils/formatApprovalDeadline
 *
 * Humane auto-approve deadline for co-parent approval rows — date + time
 * at minute granularity in the household timezone. Date-only labels hide
 * how soon the timeout fires.
 */
export function formatApprovalDeadline(
  iso: string,
  timeZone: string,
  locale: string = Intl.DateTimeFormat().resolvedOptions().locale
): string {
  const hour12 = localePrefersHour12(locale);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(hour12 ? {} : { hourCycle: 'h23' as const }),
  }).format(new Date(iso));
}

function localePrefersHour12(locale: string): boolean {
  const resolved = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
  }).resolvedOptions().hour12;
  return resolved === true;
}
