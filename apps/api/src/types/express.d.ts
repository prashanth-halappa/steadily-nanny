// Global Express Request augmentation.
//
// - `id`: the per-request correlation ID assigned by the requestId middleware.
// - `user`: the signed-in user attached by `validateSession` (Better Auth).
// - `validatedQuery`: parsed query params (Express 5 makes req.query read-only,
//   so the validator writes coerced query data here).
// - `rawBody`: the raw request body, preserved only for webhook signature
//   verification by the express.json `verify` hook.

declare global {
  namespace Express {
    /** The authenticated caller. `id` is `user.id` in the Better Auth table. */
    interface AuthUser {
      id: string;
      email: string;
      name: string;
    }

    interface Request {
      id?: string;
      user?: AuthUser;
      validatedQuery?: Record<string, unknown>;
      rawBody?: Buffer;
    }
  }
}

export {};
