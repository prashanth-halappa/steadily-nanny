/**
 * Rate limiting middleware.
 *
 * Per-user limiting for authenticated routes (keyed on user ID, falling back to
 * IP). Applied AFTER auth so the key is the user ID.
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
