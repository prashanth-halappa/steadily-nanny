/**
 * @module domains/today/utils/joinedComposition
 *
 * Builds the §8.1 `JoinedHouseholdCard` composition line from data
 * `TodayScreen` already has: her active household's children and member
 * roster. Age is ALWAYS derived client-side from `birth_date` (`child.schema.ts`
 * — never stored as an age), so `ageFromBirthDate` is the one place that
 * happens, same as everywhere else in the app.
 *
 * Only ACTIVE members count — a `removed` row is history, not composition.
 * `otherCarerCount` is nannies other than the signed-in user (the copy says
 * "other nanny", not "other carer"); helpers are deliberately not counted
 * here, same reason.
 */
import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  type HouseholdMember,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { ageFromBirthDate } from '@/src/domains/setup/childAge';
import type { JoinedComposition } from '../../draft/components/JoinedHouseholdCard';

interface CompositionChild {
  name: string;
  birth_date: string | null;
}

export function buildJoinedComposition(
  children: readonly CompositionChild[],
  members: readonly HouseholdMember[],
  myUserId: string | null | undefined
): JoinedComposition {
  const active = members.filter(
    m => m.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE
  );

  return {
    children: children.map(child => ({
      name: child.name,
      age: ageFromBirthDate(child.birth_date),
    })),
    parentCount: active.filter(
      m => m.role === HOUSEHOLD_ROLES.OWNER || m.role === HOUSEHOLD_ROLES.PARENT
    ).length,
    otherCarerCount: active.filter(
      m => m.role === HOUSEHOLD_ROLES.NANNY && m.user_id !== myUserId
    ).length,
  };
}
