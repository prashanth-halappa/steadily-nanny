/**
 * appIdentity — the single source of truth for app branding + native identifiers.
 *
 * Stored as JSON (`./appIdentity.json`) so BOTH `app.config.ts` (evaluated by
 * Node during `expo config`, which does NOT transpile imported .ts files) and the
 * app runtime can import the same values. PURE STATIC — no env reads, no async.
 *
 * SETUP: replace every `SETUP-*` placeholder (and the names/ids) in
 * `appIdentity.json` before building.
 */
import appIdentityData from './appIdentity.json';

export const appIdentity = appIdentityData;
export type AppIdentity = typeof appIdentity;
