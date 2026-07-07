/**
 * Push dispatch service.
 *
 * The generic "send a push to a user" seam: resolve the user's deliverable
 * tokens, deliver via the core sender, then clean up any dead tokens Expo
 * reported. Build higher-level fan-out (audiences, scheduling, guardrails) on
 * top of this.
 *
 * @module domains/notification/services/pushDispatchService
 */
import { DeviceRepository } from '../repositories/deviceRepository';
import type { PushPayload, SendResult } from '../types';
import { sendToTokens } from './notificationSender';

/**
 * Send a push to every deliverable device a user has.
 *
 * @param userId - The recipient user's id.
 * @param payload - Title, body, and optional data payload.
 * @returns Count accepted and the invalid tokens that were cleaned up.
 */
export async function sendToUser(
  userId: string,
  payload: PushPayload
): Promise<SendResult> {
  const tokens = await DeviceRepository.getDeliverableTokensForUser(userId);
  if (tokens.length === 0) {
    return { sent: 0, invalidTokens: [] };
  }

  const result = await sendToTokens(tokens, payload);

  // Clear tokens Expo reported as no longer registered so future sends skip them.
  if (result.invalidTokens.length > 0) {
    await DeviceRepository.removeTokens(result.invalidTokens);
  }

  return result;
}
