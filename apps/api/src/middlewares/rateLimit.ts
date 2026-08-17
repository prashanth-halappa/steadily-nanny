/**
 * Rate limiting middleware.
 *
 * Per-user limiting for authenticated routes (keyed on user ID, falling back to
 * IP). Applied AFTER auth so the key is the user ID.
 *
 * The pre-auth public routes need a SECOND limiter, keyed on IP, because they
 * run before `validateSupabaseToken` and so have no user id to key on — see
 * `publicInviteRateLimiter` below.
 */
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';

export const userRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // per window per user

  keyGenerator: (req: Request): string => req.user?.id || req.ip || 'unknown',

  message: {
    error: 'Too many requests, please try again later',
  },

  standardHeaders: true, // RFC 6585 RateLimit headers
  legacyHeaders: false,

  // Skip in tests to avoid interference.
  skip: () => process.env.NODE_ENV === 'test',

  // We key on user ID for authenticated requests; the IP fallback is edge-case.
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});

/**
 * Requests per IP per window on the public invite routes. Exported so the
 * route test asserts the SAME budget the middleware enforces.
 */
export const PUBLIC_INVITE_MAX_REQUESTS = 60;

/**
 * The unauthenticated invite routes' limiter — IP-keyed, because they are
 * mounted BEFORE `validateSupabaseToken` and there is no user id to key on.
 * `userRateLimiter` cannot cover them for exactly that reason, and moving the
 * mount would put the public terms page behind auth, which is the one thing
 * it must not be.
 *
 * WHAT IT PROTECTS. The invite code IS the bearer secret on those routes, and
 * a hit returns the carer's name and her full pay terms (D-51). The code is
 * `XXX-XXX` over a 31-character alphabet — 31^6 = 887,503,681 codes — so the
 * only real attack is enumeration, and the only defence that matters is
 * making enumeration cost time.
 *
 * WHY 60 PER 15 MINUTES. Opening the page costs two requests (the preview and
 * the read receipt), so this is 30 page opens a quarter-hour from one address
 * — past anything a family, or a family and both sets of grandparents behind
 * one NAT, will ever do, so a real reader is never the one who gets refused.
 * As an attack budget it is 5,760 guesses a day: one address needs roughly
 * 420,000 years to walk the keyspace, and a botnet large enough to matter is
 * a different problem than a rate limit solves. Deliberately NOT tight enough
 * to stop a determined distributed attacker — it is here so the cheap attack
 * stops being cheap.
 *
 * No custom `keyGenerator`: v8's default already normalises IPv6 to a /64
 * subnet, which is the part a hand-rolled `req.ip` key gets wrong.
 */
export const publicInviteRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: PUBLIC_INVITE_MAX_REQUESTS,

  message: {
    error: 'Too many requests, please try again later',
  },

  standardHeaders: true,
  legacyHeaders: false,

  // Same test escape hatch as above, and the route test flips NODE_ENV to
  // exercise the limit deliberately.
  skip: () => process.env.NODE_ENV === 'test',
});

/** Requests per IP per window on the job routes. Exported for the route test. */
export const JOB_MAX_REQUESTS = 60;

/**
 * S15 — the job routes (`/api/jobs/*`) sit BEFORE the Supabase auth layer
 * (`app.ts`) and were guarded only by the shared `X-Job-Api-Key` secret, with
 * no user, household, role or rate limit. IP-keyed for the same reason as
 * `publicInviteRateLimiter`: there is no user id to key on this far ahead of
 * auth.
 *
 * Mounted in `jobRoutes.ts` AFTER `validateJobApiKey`, not before: a wrong or
 * missing key already 401s for free (no DB write, no job work), so spending
 * the rate-limit budget on it would let a key-guessing attacker exhaust a
 * legitimate caller's window with nothing but failures. What this bounds is
 * a VALID key being used to hammer the endpoints — the case that matters if
 * `JOB_API_KEY` ever leaks. Same budget as the invite limiter: the busiest
 * legitimate cadence here is `cover-ask-expiry` at every 5 minutes, so 60/15min
 * is generous headroom for the scheduler's own IP while still bounding abuse.
 */
export const jobRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: JOB_MAX_REQUESTS,

  message: {
    error: 'Too many requests, please try again later',
  },

  standardHeaders: true,
  legacyHeaders: false,

  // Same test escape hatch as above.
  skip: () => process.env.NODE_ENV === 'test',
});
