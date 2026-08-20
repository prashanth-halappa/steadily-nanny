/**
 * @module domains/timesheet/utils/weekReceiptHtml
 *
 * The "Share PDF" receipt, as a self-contained HTML document for
 * `expo-print`'s `printToFileAsync`.
 *
 * Built from the ALREADY-FETCHED week payload — the same `earnings.lines`,
 * `gross_minor` and payment ledger the screen is rendering — never a second
 * fetch and never a second money derivation. Every value arrives here
 * ALREADY FORMATTED (`formatMoney`, `formatEarningsDuration`) precisely so
 * this module has no opinion about money at all: `docs/11-MONEY.md` §1 gives
 * `lib/money.ts` the only minor-to-display conversion in the app, and a
 * string builder quietly doing its own `/ 100` is exactly how a receipt ends
 * up disagreeing with the screen it was printed from.
 *
 * Self-contained by necessity, not preference: `printToFileAsync` renders in
 * an isolated web view with no network, and on iOS `WKWebView` cannot load
 * local asset URLs at all (see expo/expo#7940) — an external stylesheet,
 * font or logo silently renders as nothing. Everything is inline.
 *
 * EVERYTHING interpolated is escaped. A carer's display name is
 * user-supplied text that reaches this builder verbatim; unescaped, an
 * apostrophe-and-angle-bracket name is a broken document and a `<script>`
 * name is worse.
 */

import { palette } from '@/lib/design-tokens/palette';

export interface WeekReceiptLine {
  label: string;
  subLine: string | null;
  amount: string;
}

export interface WeekReceiptTotal {
  label: string;
  value: string;
}

export interface WeekReceiptInput {
  title: string;
  carerLabel: string;
  carerName: string;
  weekLabel: string;
  weekRangeLabel: string;
  /** Priced earnings lines, already formatted. May be empty. */
  lines: WeekReceiptLine[];
  /** Gross / paid-to-date / balance-due, already formatted. */
  totals: WeekReceiptTotal[];
  footer: string;
}

/** HTML-escape a value that came from a person, a locale file, or a row. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lineRow(line: WeekReceiptLine): string {
  const sub = line.subLine ? `<div class="sub">${esc(line.subLine)}</div>` : '';
  return `<tr><td class="label">${esc(line.label)}${sub}</td><td class="amount">${esc(line.amount)}</td></tr>`;
}

function totalRow(total: WeekReceiptTotal): string {
  return `<tr><td class="label strong">${esc(total.label)}</td><td class="amount strong">${esc(total.value)}</td></tr>`;
}

export function buildWeekReceiptHtml(input: WeekReceiptInput): string {
  const foregroundHex = palette.light.foreground.hex;
  const mutedForegroundHex = palette.light.mutedForeground.hex;
  const borderHex = palette.light.border.hex;
  const linesBlock =
    input.lines.length > 0
      ? `<table class="rows">${input.lines.map(lineRow).join('')}</table>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: ${foregroundHex}; margin: 0; padding: 40px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
  .meta { font-size: 13px; color: ${mutedForegroundHex}; margin: 0 0 24px; }
  .meta div { margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 0; vertical-align: top; font-size: 14px; }
  td.amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sub { font-size: 12px; color: ${mutedForegroundHex}; margin-top: 2px; }
  .strong { font-weight: 600; }
  .totals { margin-top: 12px; border-top: 1px solid ${borderHex}; }
  .footer { margin-top: 28px; font-size: 11px; color: ${mutedForegroundHex}; }
</style>
</head>
<body>
<h1>${esc(input.title)}</h1>
<div class="meta">
  <div>${esc(input.carerLabel)}: ${esc(input.carerName)}</div>
  <div>${esc(input.weekLabel)}: ${esc(input.weekRangeLabel)}</div>
</div>
${linesBlock}
<table class="totals">${input.totals.map(totalRow).join('')}</table>
<p class="footer">${esc(input.footer)}</p>
</body>
</html>`;
}
