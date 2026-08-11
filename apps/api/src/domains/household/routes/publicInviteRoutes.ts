/**
 * The two UNAUTHENTICATED invite routes the public terms page needs (§6.2),
 * mounted at `/api/v1/household-invites` BEFORE `validateSupabaseToken` in
 * `app.ts` — the same shape `/api/app`'s pre-auth mount already uses.
 *
 * WHY THEY ARE UNAUTHENTICATED. The reader is a parent who has been sent a
 * link and has no account yet; requiring one would make "review her terms"
 * mean "install the app and sign up first", which is the exact friction D-37
 * exists to remove. THE CODE IS THE BEARER SECRET and nothing else guards
 * this — which is why the service refuses on every row of §6.2's table and
 * gives one opaque answer for all of them.
 *
 * An Express Router calls `next()` when none of its own routes match, so every
 * other `/api/v1/household-invites/...` path falls through to the
 * authenticated stack untouched.
 *
 * @module domains/household/routes/publicInviteRoutes
 */
import { Router } from 'express';
import { publicInviteRateLimiter } from '../../../middlewares/rateLimit';
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { PublicInviteController } from '../controllers/publicInviteController';
import { InviteCodeParamSchema } from '../schemas';

const router = Router();

// `/api/v1`'s `userRateLimiter` is mounted AFTER `validateSupabaseToken` and
// keys on the user id, so it cannot cover a route that runs before auth — and
// moving this mount behind auth would put the public terms page behind a login,
// which is the one thing it must not be. So these two routes carry their own
// IP-keyed limiter instead: the code is the bearer secret, a hit returns her
// pay terms, and with no limit at all walking the 31^6 keyspace is free. It
// sits on the router (not in `app.ts`) so the budget is spent across BOTH
// routes together — the receipt endpoint is a write keyed on the same
// guessable string, and its own quota would just move the enumeration one path
// over.
router.use(publicInviteRateLimiter);

// The page itself. 404s on every row of §6.2's table, with one opaque body.
router.get(
  '/:code/terms-preview',
  validate(InviteCodeParamSchema, 'params'),
  asyncHandler(PublicInviteController.termsPreview)
);

// The worker's read receipt (§5.3 "Opened"). Idempotent, answers 204 whatever
// the code turns out to be — see the controller for why that silence matters.
router.post(
  '/:code/opened',
  validate(InviteCodeParamSchema, 'params'),
  asyncHandler(PublicInviteController.markOpened)
);

export default router;
