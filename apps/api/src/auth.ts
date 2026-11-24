/**
 * Better Auth: email/password plus Apple and Google id-token sign-in, over the
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
import { EmailService } from './domains/email/services/emailService';
import { renderResetPasswordEmail } from './domains/email/templates/resetPassword';

/** The app screen a reset email opens (universal link, AASA in infra/nanny-site). */
export const RESET_PASSWORD_PATH = '/auth/reset';

/** The link in the reset email: the app's reset route, carrying the token. */
export const resetPasswordUrl = (token: string): string =>
  `${APP_IDENTITY.webUrl}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token)}`;

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
  // site that hosts the reset link, so `redirectTo` passes the origin check.
  // appleid.apple.com: Apple's web flow (Android) POSTs the callback from there.
  trustedOrigins: [
    'steadilynanny://',
    APP_IDENTITY.webUrl,
    'https://appleid.apple.com',
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    requireEmailVerification: false,
    // Better Auth's own `url` routes through its /reset-password endpoint; the
    // app opens the token directly instead, then calls resetPassword({ token }).
    sendResetPassword: async ({ user, token }) => {
      const { subject, html } = renderResetPasswordEmail({
        resetUrl: resetPasswordUrl(token),
      });
      await EmailService.sendEmail({
        userId: user.id,
        to: user.email,
        emailType: 'reset_password',
        subject,
        html,
      });
    },
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
