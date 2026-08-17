/**
 * @module domains/schedule/utils/memberDisplayName
 *
 * Resolve a household user id to a humane label for agreement surfaces —
 * "You", a display-name override, a role fallback, or a neutral "Someone".
 * Pure so Pattern A / unit tests don't need the member query.
 */
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';

export interface MemberDisplayLabels {
  you: string;
  someone: string;
  roleFallback: (role: HouseholdMember['role']) => string;
}

/**
 * The two raw name fields `resolveCarerName` reads — named here so a caller
 * can type a prop against this shape without spelling out
 * `display_name_override`/`profile_name` itself (`carerNameSingleSource.test.ts`
 * fails the build on any production file that does).
 */
export type CarerNameSource = Pick<
  HouseholdMember,
  'display_name_override' | 'profile_name'
>;

/**
 * The ONE name chain for a carer: what this household calls her
 * (`display_name_override`) -> her own profile name (joined onto the
 * members-list read) -> the name a payroll/agreement row snapshotted at
 * insert (`carer_display_name` — the only name a DEPARTED carer still has,
 * her membership row being gone) -> a caller-supplied last-resort label.
 *
 * `fallback` is passed in rather than hardcoded so each surface keeps its own
 * translated label ("Your nanny", "Carer", a role word) — the chain is
 * shared, the wording is not. Every screen that shows a carer's name routes
 * through here: hand-rolled `display_name_override?.trim() || label` chains
 * skipped the middle two links and rendered two un-renamed nannies as the
 * same word twice.
 */
export function resolveCarerName(
  member: CarerNameSource | null | undefined,
  fallback: string,
  snapshotName?: string | null
): string {
  return (
    member?.display_name_override?.trim() ||
    member?.profile_name?.trim() ||
    snapshotName?.trim() ||
    fallback
  );
}

export function resolveMemberDisplayName(
  userId: string | null | undefined,
  currentUserId: string | null | undefined,
  membersByUserId: ReadonlyMap<string, HouseholdMember>,
  labels: MemberDisplayLabels
): string {
  if (!userId) return labels.someone;
  if (currentUserId && userId === currentUserId) return labels.you;
  const member = membersByUserId.get(userId);
  if (!member) return labels.someone;
  // The role label is this surface's last resort only — audit lines ("raised
  // by A parent") read better with a role than with a bare "Carer".
  return resolveCarerName(member, labels.roleFallback(member.role));
}
