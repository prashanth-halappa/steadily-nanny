/**
 * App identity — SINGLE source of truth for product name, support email, and
 * public URLs. Everything that renders a name or a link (emails, error copy,
 * unsubscribe footers, the root endpoint) imports from here, so rebranding the
 * template is a one-file change.
 *
 * @module config/app.identity
 */
export const APP_IDENTITY = {
  /** Display name used in copy and the root endpoint. */
  name: 'Steadily Nanny',
  /** Support/contact email (also the default email reply-to). */
  supportEmail: 'support@nanny.getsteadily.app',
  /** Public marketing/base URL. */
  webUrl: 'https://nanny.getsteadily.app',
  /** Public API base URL (used by cron, deep links, email links). */
  apiUrl: 'https://api.nanny.getsteadily.app',
} as const;
