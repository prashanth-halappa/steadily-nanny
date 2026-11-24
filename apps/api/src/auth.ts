/**
 * Better Auth: Apple and Google id-token sign-in (plus email/password in
 * dev/test only, `EMAIL_AUTH_ENABLED`), over the
 * D1 `user`/`session`/`account`/`verification` tables (`db/schema/auth.ts`).
 *
 * Mounted at `/api/auth/*` in `app.ts`. The mobile client (`@better-auth/expo`)
 * keeps the session cookie in SecureStore and sends it as a `Cookie` header;
 * `middlewares/auth.ts` resolves it with `auth.api.getSession`.
 *
 * @module auth
 */

import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APP_IDENTITY } from './config/app.identity';
import { env } from './config/env';
import { db } from './db/client';
import * as schema from './db/schema';

const present = (values: (string | undefined)[]): string[] =>
  values.filter((v): v is string => Boolean(v));

const appleAudiences = present([
  env.APPLE_CLIENT_ID,
  env.APPLE_APP_BUNDLE_IDENTIFIER,
]);
const googleAudiences = present([
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_IOS_CLIENT_ID,
]);

export const auth = betterAuth({
  appName: APP_IDENTITY.name,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  advanced: {
    // App tables validate user ids as uuids (shared-types `z.uuid()`).
    database: { generateId: 'uuid' },
    // Rate-limit key. Workers have no socket address, and the default
    // x-forwarded-for is client-settable; Cloudflare overwrites this one.
    // (Needs zod >= 4.5.4: Better Auth's IP check calls z.validate.)
    ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
  },
  // The app scheme (expo plugin adds `exp://` itself in development) and the
  // app's web origin, so `redirectTo` passes the origin check.
  // appleid.apple.com: Apple's web flow (Android) POSTs the callback from there.
  trustedOrigins: [
    'steadilynanny://',
    APP_IDENTITY.webUrl,
    'https://appleid.apple.com',
  ],
  // Dev/test only (seeders, Maestro). Production signs in with Apple/Google;
  // no password reset, so nothing here sends email.
  emailAndPassword: {
    enabled: env.EMAIL_AUTH_ENABLED,
    minPasswordLength: 6,
    requireEmailVerification: false,
  },
  socialProviders: {
    ...(env.APPLE_CLIENT_ID && {
      apple: {
        clientId: env.APPLE_CLIENT_ID,
        clientSecret: env.APPLE_CLIENT_SECRET,
        appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
        // Native iOS tokens carry the bundle id; web/Android the Services ID.
        audience: appleAudiences,
      },
    }),
    ...(env.GOOGLE_CLIENT_ID && {
      google: {
        // First id is primary (web, also Android's serverClientId); all are
        // accepted as the id-token audience, so iOS tokens verify too.
        clientId: googleAudiences,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    }),
  },
  plugins: [expo()],
});

/** The authenticated user as Better Auth returns it from `getSession`. */
export type SessionUser = typeof auth.$Infer.Session.user;
