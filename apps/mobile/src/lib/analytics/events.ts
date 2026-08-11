/**
 * Analytics Events
 *
 * Minimal, generic event taxonomy. Add your product's events here as `const`
 * entries — the `AnalyticsEventName` union widens automatically, and
 * `analytics.track()` also accepts arbitrary strings for ad-hoc events.
 */

export const ANALYTICS_EVENTS = {
  APP_OPENED: 'app_opened',
  SCREEN_VIEWED: 'screen_viewed',
  SIGN_IN_COMPLETED: 'sign_in_completed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',

  // ---------------------------------------------------------------------
  // The onboarding → agreed-terms funnel (D-39,
  // `docs/design/screens-onboarding-terms-proposal.md` §11). All eight are
  // declared here so `AnalyticsEventName` covers them and a typo fails
  // typecheck rather than landing in PostHog as a new event name.
  //
  // `code_hash` — `sha256(code)[0:16]`, never the raw code — rides every
  // event that can carry one. It is the only join key spanning the pre-auth
  // hop between the nanny's device and the parent's, and the code itself is
  // a bearer secret that does not belong in an analytics store.
  //
  // LINK_OPENED is the CF worker's, not this app's: it fires when the worker
  // returns 200 for `/t/:code`, before anyone has signed in. It is declared
  // here for the union and is deliberately never emitted from the client.
  // ---------------------------------------------------------------------
  DRAFT_CREATED: 'draft_created',
  TERMS_SHARED: 'terms_shared',
  LINK_OPENED: 'link_opened',
  CODE_REDEEMED: 'code_redeemed',
  PROPOSAL_VIEWED: 'proposal_viewed',
  PROPOSAL_COUNTERED: 'proposal_countered',
  PROPOSAL_ACCEPTED: 'proposal_accepted',
  FIRST_WEEK_APPROVED: 'first_week_approved',
} as const;

/** Type for all known event names. */
export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
