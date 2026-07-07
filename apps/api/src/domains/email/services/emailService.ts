/**
 * Email service (core).
 *
 * The product-agnostic "send one email" primitive over Resend. Preserves the
 * golden behaviors of the production sender while severing every product
 * reach-in (recipient resolution, preference tables, template registry):
 *  - graceful degradation when Resend is unconfigured (skip, never throw),
 *  - idempotency via a dedupe key checked against `email_log`,
 *  - a per-user daily cap,
 *  - a write to `email_log` for every send (sent or failed).
 *
 * @module domains/email/services/emailService
 */

import { env } from '../../../config/env';
import { getResendClient, isResendConfigured } from '../../../config/resend';
import { logger } from '../../../middlewares/logger';
import { EmailLogRepository } from '../repositories/emailLogRepository';
import type { SendEmailParams, SendEmailResult } from '../types';

/** Default per-user daily cap. Override per-call via `params.dailyCap`. */
export const DEFAULT_DAILY_EMAIL_CAP = 10;

export class EmailService {
  /**
   * Send a single email.
   *
   * @returns `{ sent: true }` on success, or `{ sent: false, reason }` when
   *   skipped (Resend unconfigured / duplicate / daily cap) or failed. Never
   *   throws for the expected skip paths — callers can fire-and-forget.
   */
  static async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const { userId, to, emailType, subject, html, dedupeKey } = params;

    // (a) Graceful degradation — no Resend key means email is a no-op, not a 500.
    if (!isResendConfigured()) {
      logger.warn('Email skipped — Resend not configured', { emailType });
      return { sent: false, reason: 'not_configured' };
    }

    // (b) Idempotency — skip if this dedupe key was already recorded.
    if (dedupeKey) {
      const already = await EmailLogRepository.wasRecentlySent(dedupeKey);
      if (already) {
        logger.info('Email skipped — already sent', { emailType, dedupeKey });
        return { sent: false, reason: 'duplicate' };
      }
    }

    // (c) Per-user daily cap (only meaningful when a user is attached).
    if (userId) {
      const cap = params.dailyCap ?? DEFAULT_DAILY_EMAIL_CAP;
      const sentToday = await EmailLogRepository.countSentToday(userId);
      if (sentToday >= cap) {
        logger.info('Email skipped — daily cap reached', {
          userId,
          emailType,
          sentToday,
          cap,
        });
        return { sent: false, reason: 'daily_cap' };
      }
    }

    // SETUP: add a preference check here (e.g. honor a per-user email opt-out /
    // category preference row) before sending non-transactional email.

    // (d) Deliver via Resend.
    try {
      const { data, error } = await getResendClient().emails.send({
        from: env.EMAIL_FROM,
        to,
        subject,
        html,
      });

      if (error) {
        logger.error('Resend send failed', {
          emailType,
          error: String(error.message),
        });
        await EmailService.recordLog({
          userId,
          emailType,
          recipient: to,
          status: 'failed',
          dedupeKey,
          metadata: { error: String(error.message) },
        });
        return { sent: false, reason: 'send_failed' };
      }

      // (e) Record the successful send.
      await EmailService.recordLog({
        userId,
        emailType,
        recipient: to,
        status: 'sent',
        dedupeKey,
        metadata: data?.id ? { messageId: data.id } : undefined,
      });

      logger.info('Email sent', { emailType, messageId: data?.id });
      return { sent: true };
    } catch (err) {
      logger.error('Unexpected error sending email', {
        emailType,
        error: err instanceof Error ? err.message : String(err),
      });
      return { sent: false, reason: 'unexpected_error' };
    }
  }

  /** Write an `email_log` row, swallowing log-write failures (best-effort). */
  private static async recordLog(params: {
    userId?: string;
    emailType: string;
    recipient: string;
    status: 'sent' | 'failed';
    dedupeKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await EmailLogRepository.logSend({
        userId: params.userId ?? null,
        emailType: params.emailType,
        recipient: params.recipient,
        status: params.status,
        dedupeKey: params.dedupeKey,
        metadata: params.metadata,
      });
    } catch (logErr) {
      logger.error('Failed to write email_log', {
        emailType: params.emailType,
        error: logErr instanceof Error ? logErr.message : String(logErr),
      });
    }
  }
}
