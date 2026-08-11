/**
 * @module domains/pay/utils/termsDiff
 *
 * §7's diff-first change and §8.5's version history share ONE function for
 * "what changed between two arrangements" (`buildTermsDiff`) so the history
 * can never describe a change differently from how it was reviewed (§8.5:
 * "one function, three call sites"). §7.3's per-term consequence sentences
 * live here too (`buildTermsChangeConsequence`) — T11 closed by construction,
 * the same discipline `buildMidWeekConsequence` used for the rate alone.
 *
 * Both are pure and take a `Translate` function (the `termRows.ts`
 * convention) rather than hardcoding English, so every string here is a
 * real i18n key with `en`/`es` catalogue entries.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { formatMoney } from '@/src/lib/money';
import { buildTermRows } from './termRows';

type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface TermDiffRow {
  key: string;
  label: string;
  /** `null` when the term is newly set (no predecessor to show). */
  before: string | null;
  after: string;
}

/**
 * Every term that differs between `previous` (or `null` for "first terms
 * set") and `next`, in the fixed §3 order — `termRows.ts`'s own order, since
 * `buildTermRows` IS the read-only document's formatting and this function
 * must never invent a second one (§8.5: "a closed sheet must read as a
 * complete contract").
 *
 * Rate + currency are diffed separately, ahead of the term-row set: they are
 * the header figure, not a `termRows.ts` row, and D-6's weekly-equivalent
 * line is a DERIVED figure (never diffed on its own — it moves only because
 * the rate or the guarantee did, and diffing it too would double-report the
 * same change).
 */
export function buildTermsDiff(
  previous: PayArrangement | null,
  next: PayArrangement,
  t: Translate
): TermDiffRow[] {
  const rows: TermDiffRow[] = [];

  const nextRate = formatMoney(next.rate_minor, next.currency);
  const prevRate = previous
    ? formatMoney(previous.rate_minor, previous.currency)
    : null;
  if (prevRate !== nextRate) {
    rows.push({
      key: 'rate',
      label: t('history.diffRateLabel'),
      before: prevRate,
      after: nextRate,
    });
  }

  const prevTermRows = previous ? buildTermRows(previous, t) : [];
  const nextTermRows = buildTermRows(next, t);
  for (const nextRow of nextTermRows) {
    // The PTO balance row is a LIVE READ (the ledger), not a term of the
    // arrangement — it always "changes" between any two calls and diffing
    // it would flood every version's history with a row that says nothing
    // about what was AGREED.
    if (nextRow.key === 'ptoBalance') continue;
    const prevRow = prevTermRows.find(row => row.key === nextRow.key);
    const prevValue = prevRow?.value ?? null;
    const prevText = prevValue ?? t('history.notSet');
    const nextText = nextRow.value ?? t('history.notSet');
    if (prevValue === nextRow.value && prevRow !== undefined) continue;
    if (prevRow === undefined && nextRow.value === null) continue; // stayed unset
    rows.push({
      key: nextRow.key,
      label: nextRow.label,
      before: previous ? prevText : null,
      after: nextText,
    });
  }

  return rows;
}

export interface TermsChangeConsequence {
  /** i18n key + params, ready for `t(key, params)`. */
  key: string;
  params?: Record<string, unknown>;
}

/**
 * §7.3, T11 closed by construction: a consequence sentence for EVERY term
 * that changed, not just the rate — `buildMidWeekConsequence`'s successor.
 * Fires only when `effectiveDateISO` is NOT the household's week start (a
 * change taking effect exactly on the week boundary never splits anything).
 * The trailing "check the week" sentence (David, D5) is appended whenever
 * ANY consequence fires, always last.
 */
export function buildTermsChangeConsequence(
  diff: readonly TermDiffRow[],
  isWeekStart: boolean
): TermsChangeConsequence[] {
  if (diff.length === 0 || isWeekStart) return [];

  const keys = new Set(diff.map(row => row.key));
  const consequences: TermsChangeConsequence[] = [];

  if (keys.has('rate')) {
    consequences.push({ key: 'consequence.rate' });
  }
  if (keys.has('overtime') || keys.has('guaranteedHours')) {
    consequences.push({ key: 'consequence.weeklyOvertimeOrGuarantee' });
  }
  if (
    keys.has('dailyOvertime') ||
    keys.has('doubletime') ||
    keys.has('seventhDay')
  ) {
    consequences.push({ key: 'consequence.dailyTiers' });
  }
  if (keys.has('cancellations')) {
    consequences.push({ key: 'consequence.cancellations' });
  }
  if (keys.has('mileage')) {
    consequences.push({ key: 'consequence.mileage' });
  }
  if (keys.has('pto')) {
    consequences.push({ key: 'consequence.pto' });
  }
  if (keys.has('workedHolidayPremium')) {
    consequences.push({ key: 'consequence.holidays' });
  }
  // Outside wages, pay schedule, in writing: no consequence line — nothing
  // already priced changes (spec §7.3's table, last row).

  if (consequences.length > 0) {
    consequences.push({ key: 'consequence.checkTheWeek' });
  }
  return consequences;
}
