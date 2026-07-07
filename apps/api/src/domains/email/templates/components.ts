/**
 * Reusable email content components.
 *
 * Pure functions returning inline-styled HTML fragments. Email clients strip
 * `<style>` blocks, so every visual rule here is inline; only `baseLayout`'s
 * `<head>` style survives (for webfonts). Emails are light-mode only.
 *
 * @module domains/email/templates/components
 */

import { EMAIL } from './designTokens';

const { color, font, radius, size } = EMAIL;

/**
 * Call-to-action button.
 *
 * - `primary` (default): pill-shaped, brand-accent, with an MSO (Outlook) VML
 *   roundrect fallback so the rounded fill renders on Windows.
 * - `text`: a quiet underlined secondary link in the AA-safe ink-accent color.
 */
export function emailButton(opts: {
  href: string;
  label: string;
  variant?: 'primary' | 'text';
}): string {
  const { href, label, variant = 'primary' } = opts;
  if (variant === 'text') {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding:0 0 ${EMAIL.space.sm};">
          <a href="${href}" style="display:inline-block;padding:10px 24px;font-family:${font.sans};color:${color.inkAccent};font-size:${size.small};font-weight:600;text-decoration:underline;text-align:center;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
  }
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td align="center" style="padding:${EMAIL.space.xs} 0 ${EMAIL.space.sm};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="50%" fillcolor="${color.accent}" stroke="f">
            <w:anchorlock/>
            <center style="color:${color.accentText};font-family:Arial,sans-serif;font-size:16px;font-weight:600;">${label}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${href}" style="display:inline-block;padding:14px 32px;background-color:${color.accent};color:${color.accentText};font-family:${font.sans};font-size:${size.body};font-weight:600;text-decoration:none;border-radius:${radius.pill};text-align:center;">
            ${label}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>`;
}

/**
 * Section heading. Level 1 is an editorial serif headline; level 2 is a
 * semibold sans subheading.
 */
export function sectionHeading(
  text: string,
  opts?: { level?: 1 | 2; serif?: boolean }
): string {
  const level = opts?.level ?? 1;
  const useSerif = opts?.serif ?? level === 1;
  const family = useSerif ? font.serif : font.sans;
  if (level === 1) {
    return `<h1 style="margin:0 0 ${EMAIL.space.sm};font-family:${family};font-size:${size.h1};font-weight:600;color:${color.text};line-height:1.3;">${text}</h1>`;
  }
  return `<h2 style="margin:0 0 12px;font-family:${family};font-size:${size.h2};font-weight:600;color:${color.text};line-height:1.35;">${text}</h2>`;
}

/**
 * Body paragraph. Defaults to primary text; `muted` for secondary copy,
 * `center` to center-align, `small` for finer print.
 */
export function paragraph(
  html: string,
  opts?: { muted?: boolean; center?: boolean; small?: boolean }
): string {
  const textColor = opts?.muted ? color.textMuted : color.text;
  const fontSize = opts?.small ? size.small : size.body;
  const align = opts?.center ? 'text-align:center;' : '';
  return `<p style="margin:0 0 ${EMAIL.space.sm};font-family:${font.sans};font-size:${fontSize};color:${textColor};line-height:1.6;${align}">${html}</p>`;
}

/**
 * Rounded tinted info card wrapping arbitrary inner HTML.
 */
export function infoCard(
  innerHtml: string,
  opts?: { tint?: 'cream' | 'warm' }
): string {
  const bg = opts?.tint === 'warm' ? color.bgTint : color.bgPage;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 ${EMAIL.space.md};background-color:${bg};border-radius:${radius.box};">
      <tr>
        <td style="padding:20px 24px;">
          ${innerHtml}
        </td>
      </tr>
    </table>`;
}

/**
 * Callout box: an uppercase label over a short body, with a left accent border.
 * A generic, brand-neutral highlight for a tip, note, or aside.
 */
export function calloutBox(
  content: { label: string; body: string },
  opts?: { accent?: string }
): string {
  const accent = opts?.accent ?? color.accent;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 ${EMAIL.space.md};background-color:${color.bgTint};border-radius:${radius.box};border-left:3px solid ${accent};">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 4px;font-family:${font.sans};font-size:${size.label};font-weight:600;color:${color.inkAccent};text-transform:uppercase;letter-spacing:0.5px;">
            ${content.label}
          </p>
          <p style="margin:0;font-family:${font.sans};font-size:${size.small};color:${color.text};line-height:1.6;">
            ${content.body}
          </p>
        </td>
      </tr>
    </table>`;
}

/**
 * A row of headline stats (value over label). Numbers take the accent (or a
 * caller-supplied) color.
 */
export function statRow(
  stats: Array<{ value: string | number; label: string }>,
  opts?: { color?: string }
): string {
  const valueColor = opts?.color ?? color.accent;
  const width = `${Math.floor(100 / Math.max(stats.length, 1))}%`;
  const cells = stats
    .map(
      s => `
      <td width="${width}" style="padding:8px 0;text-align:center;">
        <span style="font-family:${font.sans};font-size:24px;font-weight:700;color:${valueColor};">${s.value}</span>
        <br />
        <span style="font-family:${font.sans};font-size:${size.label};color:${color.textMuted};">${s.label}</span>
      </td>`
    )
    .join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>${cells}</tr>
    </table>`;
}

/**
 * A small pill badge. Background is the accent at 10% (`1A`); the label uses the
 * AA-safe ink accent for contrast.
 */
export function badge(opts: { label: string; color?: string }): string {
  const hex = opts.color ?? color.accent;
  return `<span style="display:inline-block;padding:6px 14px;background-color:${hex}1A;border-radius:${radius.pill};font-family:${font.sans};font-size:${size.label};font-weight:600;color:${color.inkAccent};">${opts.label}</span>`;
}

/**
 * Full-bleed hero illustration for the top of an email. A transparent PNG
 * floats on the card's cream color. Explicit `width` for Outlook; meaningful
 * `alt` for clients that block images.
 */
export function heroImage(opts: { src: string; alt: string }): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding:0;font-size:0;line-height:0;">
          <img src="${opts.src}" alt="${opts.alt}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;" />
        </td>
      </tr>
    </table>`;
}
