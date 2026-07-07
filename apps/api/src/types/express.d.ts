// Global Express Request augmentation.
//
// - `id`: the per-request correlation ID assigned by the requestId middleware.
// - `user`: the authenticated Supabase user attached by validateSupabaseToken.
// - `validatedQuery`: parsed query params (Express 5 makes req.query read-only,
//   so the validator writes coerced query data here).
// - `rawBody`: the raw request body, preserved only for webhook signature
//   verification by the express.json `verify` hook.
import type { User } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: User;
      validatedQuery?: Record<string, unknown>;
      rawBody?: Buffer;
    }
  }
}
