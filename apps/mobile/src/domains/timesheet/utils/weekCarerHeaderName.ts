/**
 * @module domains/timesheet/utils/weekCarerHeaderName
 *
 * Who to name above a parent Hours week. Pay-record correctness: never
 * attribute one carer's hours to another.
 */
export function resolveWeekCarerHeaderName(input: {
  /** Distinct carer ids present on this week's entries (may be empty). */
  entryCarerIds: readonly string[];
  /** First non-null `carer_display_name` from those entries, if any. */
  entryCarerDisplayName: string | null;
  /** Active nanny/helper members of the household. */
  carerMemberIds: readonly string[];
  /** Resolve a member id to a display label. */
  resolveMemberName: (userId: string) => string;
}): string | null {
  if (input.entryCarerIds.length > 1) {
    return null;
  }
  if (input.entryCarerIds.length === 1) {
    return input.entryCarerDisplayName;
  }
  if (input.carerMemberIds.length === 1) {
    const only = input.carerMemberIds[0];
    return only ? input.resolveMemberName(only) : null;
  }
  return null;
}
