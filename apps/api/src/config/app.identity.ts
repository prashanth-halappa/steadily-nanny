/**
 * App identity — SINGLE source of truth for product name, support email, and
 * public URLs. Everything that renders a name or a link (emails, error copy,
 * unsubscribe footers, the root endpoint) imports from here, so rebranding the
 * template is a one-file change.
 *
 * SETUP: replace every value below with your product's real identity.
 *
 * @module config/app.identity
 */
export const APP_IDENTITY = {
  /** Display name used in copy and the root endpoint. */
  name: 'yourapp',
  /** Support/contact email (also the default email reply-to). */
  supportEmail: 'support@yourapp.example.com',
  /** Public marketing/base URL. */
  webUrl: 'https://yourapp.example.com',
  /** Public API base URL (used by cron, deep links, email links). */
  apiUrl: 'https://api.yourapp.example.com',
} as const;
