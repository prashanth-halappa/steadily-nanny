/**
 * Fan-out helpers for household-scoped push — fire-and-forget so a push
 * failure never fails the write that triggered it.
 *
 * @module domains/notification/services/householdPush
 */
// Straight from the shared package rather than through the household barrel:
// the constant is a leaf, and the barrel is what this module's tests replace
// wholesale to stub the repository.
import { PARENT_ROLES } from '@steadily-nanny/shared-types/schemas/household.schema';
import { logger } from '../../../middlewares/logger';
import { HouseholdMemberRepository } from '../../household';
import type { PushPayload } from '../types';
import { sendToUser } from './pushDispatchService';

async function listParentUserIds(householdId: string): Promise<string[]> {
  const members = await new HouseholdMemberRepository().listActiveByHousehold(
    householdId
  );
  return members.filter(m => PARENT_ROLES.has(m.role)).map(m => m.user_id);
}

export interface NotifyHouseholdParentsOptions {
  /** Omit this user from the fan-out (e.g. the parent who just acted). */
  excludeUserId?: string;
}

/** Notify every owner/parent in the household. Errors are logged, never thrown. */
export function notifyHouseholdParents(
  householdId: string,
  payload: PushPayload,
  options?: NotifyHouseholdParentsOptions
): void {
  void listParentUserIds(householdId)
    .then(ids => {
      const recipients = options?.excludeUserId
        ? ids.filter(id => id !== options.excludeUserId)
        : ids;
      return Promise.all(recipients.map(id => sendToUser(id, payload)));
    })
    .catch(error => {
      logger.error('Failed to notify household parents', {
        householdId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/** Notify a single user. Errors are logged, never thrown. */
export function notifyUser(userId: string, payload: PushPayload): void {
  void sendToUser(userId, payload).catch(error => {
    logger.error('Failed to notify user', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
