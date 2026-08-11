/**
 * @module domains/draft/utils/shareMessage
 *
 * What actually leaves the phone when she taps "Share link" (§6.1).
 *
 * IT IS THE LINK, NOT THE BARE CODE. A code in a text message is a support
 * ticket — the recipient has to find the app, install it, sign up and type
 * seven characters before he learns anything. A link shows him a real name
 * and a real number in about four seconds, which is the entire difference
 * between "my nanny sent me something" and "my nanny sent me a form".
 *
 * The code is still on screen in the sheet, because reading it out over the
 * phone is a real thing people do.
 */

/**
 * The public terms page (§6.2), served by `infra/nanny-site/worker.js`.
 *
 * A constant rather than an env var: the same host is baked into the
 * universal link's associated-domains entitlement, so a per-environment value
 * here would mint links this app cannot open.
 */
export const TERMS_PAGE_BASE = 'https://nanny.getsteadily.app/t';

type Translate = (key: string, params?: Record<string, unknown>) => string;

export function termsPageUrl(code: string): string {
  return `${TERMS_PAGE_BASE}/${code}`;
}

export function buildShareMessage(
  t: Translate,
  { name, code }: { name: string; code: string }
): string {
  return t('shareSheet.message', { name, url: termsPageUrl(code) });
}
