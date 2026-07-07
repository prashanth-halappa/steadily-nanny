/**
 * Base layout for transactional emails.
 *
 * Wraps content in a responsive, brand-aligned HTML shell:
 * - Warm cream background set via table bgcolor (Gmail strips body bg) so it
 *   survives across clients.
 * - Webfonts loaded via `<head>` @import, guarded from Outlook (which would
 *   otherwise fall back to Times New Roman).
 * - Light-mode only (`color-scheme:light` prevents client auto-inversion).
 * - Text wordmark instead of an image logo (clients block images).
 * - Inline CSS for content, accessibility-friendly tables (role="presentation"),
 *   hidden preheader, `List-Unsubscribe` header.
 *
 * App identity (name, links) comes from `APP_IDENTITY` — never a hardcoded brand.
 *
 * @module domains/email/templates/baseLayout
 */

import { APP_IDENTITY } from '../../../config/app.identity';
import { createEmailI18n } from '../i18n';
import { heroImage } from './components';
import { EMAIL } from './designTokens';

interface BaseLayoutOptions {
  /** URL for the unsubscribe link in the footer. */
  unsubscribeUrl?: string;
  /** Recipient locale — drives footer copy, `lang`, and LTR/RTL direction. */
  locale?: string;
  /** Hidden preheader text shown in email client previews. */
  preheaderText?: string;
  /** Optional transparent hero illustration shown atop the content card. */
  heroImageUrl?: string;
  /** Alt text for the hero image (required when heroImageUrl is set). */
  heroImageAlt?: string;
}

const { color, font, radius } = EMAIL;

/**
 * Wraps email content in the responsive, brand-aligned layout.
 *
 * @param content - The inner HTML to render inside the card.
 * @param options - Optional layout configuration.
 * @returns Full HTML document string ready to send.
 */
export function baseLayout(
  content: string,
  options?: BaseLayoutOptions
): string {
  const { unsubscribeUrl, preheaderText, heroImageUrl, heroImageAlt, locale } =
    options ?? {};
  const { t, locale: lang, dir } = createEmailI18n(locale);
  const currentYear = new Date().getFullYear();
  const appName = APP_IDENTITY.name;

  const heroRow = heroImageUrl
    ? `<tr><td style="padding:0;font-size:0;line-height:0;">${heroImage({ src: heroImageUrl, alt: heroImageAlt ?? '' })}</td></tr>`
    : '';

  const preheaderHtml = preheaderText
    ? `<div style="display:none;font-size:1px;color:${color.bgPage};line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preheaderText}</div>`
    : '';

  const unsubscribeHtml = unsubscribeUrl
    ? `<a href="${unsubscribeUrl}" style="color:${color.textMuted};text-decoration:underline;font-size:12px;">${t('common.unsubscribe')}</a>`
    : '';

  const unsubscribeHeaders = unsubscribeUrl
    ? `<meta name="List-Unsubscribe" content="<${unsubscribeUrl}>" />`
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}" dir="${dir}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  ${unsubscribeHeaders}
  <title>${appName}</title>
  <!--[if !mso]><!-->
  <style type="text/css">
    @import url('${EMAIL.fontImportUrl}');
    :root { color-scheme: light; supported-color-schemes: light; }
  </style>
  <!--<![endif]-->
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body dir="${dir}" style="margin:0;padding:0;background-color:${color.bgPage};font-family:${font.sans};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  ${preheaderHtml}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${color.bgPage}" style="background-color:${color.bgPage};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <!-- Wordmark -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;">
          <tr>
            <td align="center" style="padding:8px 0 20px;">
              <a href="${APP_IDENTITY.webUrl}" style="font-family:${font.serif};font-size:26px;font-weight:600;color:${color.text};letter-spacing:-0.3px;text-decoration:none;">${appName}</a>
            </td>
          </tr>
        </table>
        <!-- Content Card -->
        <table role="presentation" dir="${dir}" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${color.bgCard}" style="max-width:600px;background-color:${color.bgCard};border-radius:${radius.card};overflow:hidden;">
          ${heroRow}
          <tr>
            <td style="padding:32px;">
              ${content}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;">
          <tr>
            <td style="padding:24px 32px;text-align:center;">
              <p style="margin:0 0 8px;font-family:${font.sans};font-size:12px;color:${color.textMuted};line-height:1.5;">
                ${t('common.footerCopyright', { year: currentYear, appName })}
              </p>
              <p style="margin:0 0 8px;font-family:${font.sans};font-size:12px;color:${color.textMuted};line-height:1.5;">
                ${t('common.footerHelp')} <a href="mailto:${APP_IDENTITY.supportEmail}" style="color:${color.textMuted};text-decoration:underline;">${APP_IDENTITY.supportEmail}</a>
              </p>
              ${unsubscribeHtml ? `<p style="margin:0;font-size:12px;line-height:1.5;">${unsubscribeHtml}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
