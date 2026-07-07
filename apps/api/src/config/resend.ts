/**
 * Resend email client configuration.
 *
 * Lazy-initialized: the client is only created on first use, so the API can
 * start in development without RESEND_API_KEY set.
 *
 * @module config/resend
 */
import { Resend } from 'resend';
import { logger } from '../middlewares/logger';

let resendClient: Resend | null = null;

/**
 * Get the Resend client instance (lazy-initialized on first call).
 *
 * @throws Error if RESEND_API_KEY is not configured.
 */
export function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      logger.warn('RESEND_API_KEY not configured — emails will not be sent');
      throw new Error('RESEND_API_KEY not configured');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Whether the Resend client is available (API key configured). Use for
 * graceful degradation in non-critical paths.
 */
export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Reset the client (for testing). @internal */
export function resetResendClient(): void {
  resendClient = null;
}
