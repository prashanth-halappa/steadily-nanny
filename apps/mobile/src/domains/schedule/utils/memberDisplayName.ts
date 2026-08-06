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

export function resolveMemberDisplayName(
  userId: string | null | undefined,
  currentUserId: string | null | undefined,
  membersByUserId: ReadonlyMap<string, HouseholdMember>,
  labels: MemberDisplayLabels
): string {
  if (!userId) return labels.someone;
  if (currentUserId && userId === currentUserId) return labels.you;
  const member = membersByUserId.get(userId);
  const override = member?.display_name_override?.trim();
  if (override) return override;
  // The joined profile name (members-list reads only) beats the role label:
  // two nannies with no override are otherwise the same word twice.
  const profileName = member?.profile_name?.trim();
  if (profileName) return profileName;
  if (member) return labels.roleFallback(member.role);
  return labels.someone;
}
