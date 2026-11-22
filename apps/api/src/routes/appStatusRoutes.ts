/**
 * App status route. Mounted at `/api/app` BEFORE the session auth layer, so it
 * is reachable anonymously. If a valid session cookie is present, `betaAllPro`
 * reflects any per-user override.
 *
 * @module routes/appStatusRoutes
 */
import { type Request, type Response, Router } from 'express';
import { getAppStatus } from '../domains/app/services/appStatusService';
import { resolveSessionUser } from '../middlewares/auth';

const router = Router();

/** The caller from an optional session; anonymous on any failure. */
async function resolveOptionalUser(
  req: Request
): Promise<Express.AuthUser | null> {
  try {
    return await resolveSessionUser(req);
  } catch {
    return null;
  }
}

/**
 * GET /api/app/status — app status, force-update info, and announcements.
 */
router.get('/status', async (req: Request, res: Response) => {
  const version = String(req.headers['x-app-version'] ?? '0.0.0');
  const platform = String(req.headers['x-app-platform'] ?? 'ios').toLowerCase();

  const user = await resolveOptionalUser(req);
  const result = await getAppStatus(version, platform, user?.id, user?.email);
  res.json(result);
});

export default router;
