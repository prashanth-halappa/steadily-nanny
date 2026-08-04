/**
 * Fan-out helpers for household-scoped push — fire-and-forget so a push
 * failure never fails the write that triggered it.
 *
 * @module domains/notification/services/householdPush
 */
import { logger } from '../../../middlewares/logger';
import { HOUSEHOLD_ROLES, HouseholdMemberRepository } from '../../household';
import type { PushPayload } from '../types';
import { sendToUser } from './pushDispatchService';

const PARENT_ROLES: ReadonlySet<string> = new Set([
  HOUSEHOLD_ROLES.OWNER,
  HOUSEHOLD_ROLES.PARENT,
]);

async function listParentUserIds(householdId: string): Promise<string[]> {
  const members = await new HouseholdMemberRepository().listActiveByHousehold(
    householdId
  );
  return members.filter(m => PARENT_ROLES.has(m.role)).map(m => m.user_id);
}

/** Notify every owner/parent in the household. Errors are logged, never thrown. */
export function notifyHouseholdParents(
  householdId: string,
  payload: PushPayload
): void {
  void listParentUserIds(householdId)
    .then(ids => Promise.all(ids.map(id => sendToUser(id, payload))))
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
