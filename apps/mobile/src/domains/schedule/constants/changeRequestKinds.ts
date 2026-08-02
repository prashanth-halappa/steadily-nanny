/**
 * @module domains/schedule/constants/changeRequestKinds
 *
 * i18n key (in the `schedule` namespace) for a shift change request kind.
 * Callers pass `{ defaultValue: kind }` so an unknown kind still renders
 * as itself rather than as a raw key.
 */
export function shiftChangeRequestKindLabelKey(kind: string): string {
  return `changeRequestKind.${kind}`;
}

export function shiftChangeRequestStatusLabelKey(status: string): string {
  return `changeRequestStatus.${status}`;
}
