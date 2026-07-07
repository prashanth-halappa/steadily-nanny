/**
 * Welcome email template.
 *
 * A generic "welcome to {app}" email, built from `baseLayout` + component
 * helpers + the i18n catalog. Use it as the pattern for your own templates:
 * resolve copy through `t(...)`, escape any user-supplied value with
 * `escapeHtml`, and pull app identity from `APP_IDENTITY`.
 *
 * @module domains/email/templates/welcome
 */

import { APP_IDENTITY } from '../../../config/app.identity';
import { createEmailI18n, escapeHtml } from '../i18n';
import type { RenderedEmail, WelcomeEmailData } from '../types';
import { baseLayout } from './baseLayout';
import {
  calloutBox,
  emailButton,
  paragraph,
  sectionHeading,
} from './components';

/**
 * Render the welcome email subject + HTML.
 *
 * @param data - Recipient name (optional) and locale.
 * @returns `{ subject, html }` ready to pass to the email service.
 */
export function renderWelcomeEmail(data: WelcomeEmailData): RenderedEmail {
  const { name, locale } = data;
  const { t } = createEmailI18n(locale);
  const appName = APP_IDENTITY.name;

  // The subject is plain text (not HTML), so it uses the raw name; escaping
  // there would turn "&" into "&amp;" in the inbox. Body contexts use escaped.
  const displayName =
    name && name.trim().length > 0 ? name : t('welcome.fallbackName');
  const safeName = escapeHtml(displayName);

  const subject = t('welcome.subject', { appName });

  const content = `
    ${sectionHeading(t('welcome.greeting', { name: safeName }))}

    ${paragraph(t('welcome.intro', { appName }))}
    ${paragraph(t('welcome.body', { appName }))}

    ${calloutBox({ label: t('welcome.tipLabel'), body: t('welcome.tipBody') })}

    ${emailButton({ href: APP_IDENTITY.webUrl, label: t('welcome.ctaOpen', { appName }) })}

    ${paragraph(t('welcome.closing'), { muted: true, center: true, small: true })}
  `;

  const html = baseLayout(content, {
    locale,
    preheaderText: t('welcome.preheader', { appName }),
  });

  return { subject, html };
}
