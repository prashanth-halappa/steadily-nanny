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
import { validate } from '../../../middlewares/validator';
import { asyncHandler } from '../../../utils/asyncHandler';
import { PublicInviteController } from '../controllers/publicInviteController';
import { InviteCodeParamSchema } from '../schemas';

const router = Router();

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
