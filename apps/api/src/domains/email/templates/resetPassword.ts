/**
 * Password-reset email template, sent by Better Auth's `sendResetPassword`
 * hook (`src/auth.ts`). Same shape as `welcome.ts`.
 *
 * @module domains/email/templates/resetPassword
 */

import { APP_IDENTITY } from '../../../config/app.identity';
import { createEmailI18n } from '../i18n';
import type { RenderedEmail, ResetPasswordEmailData } from '../types';
import { baseLayout } from './baseLayout';
import { emailButton, paragraph, sectionHeading } from './components';

/** Render the reset-password email subject + HTML. */
export function renderResetPasswordEmail(
  data: ResetPasswordEmailData
): RenderedEmail {
  const { resetUrl, locale } = data;
  const { t } = createEmailI18n(locale);
  const appName = APP_IDENTITY.name;

  const content = `
    ${sectionHeading(t('resetPassword.heading'))}

    ${paragraph(t('resetPassword.intro', { appName }))}

    ${emailButton({ href: resetUrl, label: t('resetPassword.cta') })}

    ${paragraph(t('resetPassword.expiry'), { muted: true, small: true })}
    ${paragraph(t('resetPassword.ignore'), { muted: true, small: true })}
  `;

  return {
    subject: t('resetPassword.subject', { appName }),
    html: baseLayout(content, {
      locale,
      preheaderText: t('resetPassword.preheader', { appName }),
    }),
  };
}
