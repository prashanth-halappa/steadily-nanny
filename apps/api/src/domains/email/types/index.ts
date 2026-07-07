/**
 * Email domain types.
 *
 * @module domains/email/types
 */

/** Delivery outcome recorded on an `email_log` row. */
export type EmailStatus = 'sent' | 'failed';

/** A row in the `email_log` table. */
export interface EmailLog {
  id: string;
  user_id: string | null;
  email_type: string;
  recipient: string;
  status: EmailStatus;
  /** Unique when non-null — the idempotency key for one-time / scoped sends. */
  dedupe_key: string | null;
  metadata: Record<string, unknown>;
  sent_at: string;
}

/** Fields accepted when recording a send to `email_log`. */
export interface LogSendParams {
  userId?: string | null;
  emailType: string;
  recipient: string;
  status: EmailStatus;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
}

/** Arguments for {@link EmailService.sendEmail}. */
export interface SendEmailParams {
  /** Recipient user id (drives the per-user daily cap). Omit for user-less sends. */
  userId?: string;
  /** Recipient email address. */
  to: string;
  /** Email type identifier (e.g. `welcome`), stored on the log row. */
  emailType: string;
  /** Rendered subject line. */
  subject: string;
  /** Rendered HTML body. */
  html: string;
  /** Idempotency key — a repeat send with the same key is skipped. */
  dedupeKey?: string;
  /** Per-user daily cap override (defaults to the service default). */
  dailyCap?: number;
}

/** Result of a send attempt. `reason` explains a skip / failure. */
export interface SendEmailResult {
  sent: boolean;
  reason?: string;
}

/** Rendered email template output. */
export interface RenderedEmail {
  subject: string;
  html: string;
}

/** Welcome email template data. */
export interface WelcomeEmailData {
  /** Recipient's display name. Falls back to a generic greeting if omitted. */
  name?: string;
  /** Recipient locale (falls back to the default). */
  locale?: string;
}
