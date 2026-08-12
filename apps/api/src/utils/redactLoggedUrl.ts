/**
 * Redact bearer-secret invite codes from URLs before they reach access/error logs.
 *
 * Matches the public invite routes mounted at `/api/v1/household-invites`
 * (`/:code/terms-preview`, `/:code/opened`).
 *
 * The trailing boundary is `/`, end-of-string, or `?` — NOT just `/`. Morgan
 * logs 404s too, so a bare probe or a typo'd `/api/v1/household-invites/ABC-234`
 * (no route segment after the code) reaches the access log on the same prefix
 * and must be redacted just the same.
 */
const PUBLIC_INVITE_CODE_IN_URL =
  /(\/api\/v1\/household-invites\/)[A-Z2-9]{3}-[A-Z2-9]{3}(\/|\?|$)/g;

export function redactLoggedUrl(url: string): string {
  return url.replace(PUBLIC_INVITE_CODE_IN_URL, '$1:code$2');
}
