/**
 * Notification sender (core).
 *
 * The minimal, product-agnostic Expo batch-push primitive: give it a list of
 * push tokens and a payload, it delivers to every valid, unique token and tells
 * you which tokens are dead. No audience/recipient fan-out lives here — that
 * belongs in a dispatch service on top of this seam.
 *
 * @module domains/notification/services/notificationSender
 */
import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from 'expo-server-sdk';
import { logger } from '../../../middlewares/logger';
import type { PushPayload, SendResult } from '../types';

const expo = new Expo();

/**
 * Send one payload to many push tokens.
 *
 * Golden behaviors preserved from the production sender:
 *  1. Dedupe tokens (a user's devices can share a token).
 *  2. Keep only `Expo.isExpoPushToken`-valid tokens.
 *  3. Chunk into ≤100-message batches via `Expo.chunkPushNotifications`.
 *  4. Send each chunk and collect tickets.
 *  5. Surface `DeviceNotRegistered` tokens in `invalidTokens` for cleanup.
 *
 * @param tokens - Raw Expo push tokens (may contain dupes / invalids).
 * @param payload - Title, body, and optional data payload.
 * @returns Count accepted plus the tokens that are no longer registered.
 */
export async function sendToTokens(
  tokens: string[],
  payload: PushPayload
): Promise<SendResult> {
  // 1 + 2: dedupe, then keep only valid Expo tokens.
  const validTokens = Array.from(new Set(tokens)).filter(token =>
    Expo.isExpoPushToken(token)
  );

  if (validTokens.length === 0) {
    return { sent: 0, invalidTokens: [] };
  }

  const messages: ExpoPushMessage[] = validTokens.map(token => ({
    to: token,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  // 3: chunk into Expo-sized batches.
  const chunks = expo.chunkPushNotifications(messages);

  let sent = 0;
  const invalidTokens: string[] = [];

  // 4 + 5: send each chunk; tickets align 1:1 with the chunk's messages.
  for (const chunk of chunks) {
    let tickets: ExpoPushTicket[];
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (error) {
      logger.error('Expo push batch failed', {
        batchSize: chunk.length,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (let i = 0; i < chunk.length; i++) {
      const ticket = tickets[i];
      const message = chunk[i];
      if (!ticket || !message) continue;

      if (ticket.status === 'ok') {
        sent++;
      } else if (
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
      ) {
        // `message.to` is a single token string in the messages we build above.
        if (typeof message.to === 'string') {
          invalidTokens.push(message.to);
        }
      }
    }
  }

  return { sent, invalidTokens };
}
