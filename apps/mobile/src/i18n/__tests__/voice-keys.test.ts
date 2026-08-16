/**
 * Pass-1 CX voice keys — every new lead/moment/dialog string exists in en
 * and es with identical {{placeholders}}. Later streams wire the keys;
 * this file keeps the contract from drifting.
 *
 * @module i18n/__tests__/voice-keys.test
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const localesRoot = join(import.meta.dir, '../locales');

type Namespace =
  | 'common'
  | 'today'
  | 'hours'
  | 'schedule'
  | 'inbox'
  | 'pay'
  | 'settings';

const VOICE_KEYS: ReadonlyArray<readonly [Namespace, string]> = [
  ['common', 'moments.continue'],
  ['today', 'moments.nannyJoined.title'],
  ['today', 'moments.nannyJoined.body'],
  ['today', 'moments.nannyJoined.cta'],
  ['today', 'moments.firstClockIn.title'],
  ['today', 'moments.firstClockIn.body'],
  ['today', 'moments.firstWeekApproved.title'],
  ['today', 'moments.firstWeekApproved.body'],
  ['today', 'lead.parent.here'],
  ['today', 'lead.parent.done'],
  ['today', 'lead.parent.quiet'],
  ['today', 'lead.nanny.here'],
  ['today', 'lead.nanny.scheduled'],
  ['today', 'lead.nanny.done'],
  ['today', 'lead.nanny.quiet'],
  ['hours', 'approveDialog.title'],
  ['hours', 'approveDialog.body'],
  ['hours', 'approveDialog.bodyNothingUnusual'],
  ['hours', 'approveDialog.bodyNoArrangement'],
  ['hours', 'approveDialog.bodyCurrencyChange'],
  ['hours', 'approveDialog.bodyAdjustmentAdded'],
  ['hours', 'approveDialog.bodyAdjustmentDeducted'],
  ['hours', 'approveDialog.cancel'],
  ['hours', 'approveDialog.confirm'],
  ['hours', 'timeline.logged'],
  ['hours', 'timeline.opened'],
  ['hours', 'timeline.notOpened'],
  ['hours', 'timeline.waiting'],
  ['hours', 'receipts.weekClosed.title'],
  ['hours', 'receipts.weekClosed.body'],
  ['hours', 'lead.nanny'],
  ['hours', 'lead.parent'],
  ['hours', 'lead.parentNoCarer'],
  ['hours', 'entryCorrectedToast'],
  ['hours', 'entryRemovedToast'],
  ['schedule', 'lead.nanny_one'],
  ['schedule', 'lead.nanny_other'],
  ['schedule', 'lead.parent_one'],
  ['schedule', 'lead.parent_other'],
  ['inbox', 'lead_one'],
  ['inbox', 'lead_other'],
  ['inbox', 'kinds.change_request'],
  ['inbox', 'kinds.pending_pattern'],
  ['inbox', 'kinds.queried_week'],
  ['inbox', 'kinds.submitted_week'],
  ['inbox', 'kinds.stale_submitted_week'],
  ['inbox', 'kinds.pending_shift'],
  ['inbox', 'kinds.terms_proposal'],
  ['inbox', 'kinds.terms_proposal_sent'],
  ['inbox', 'kinds.terms_ack'],
  ['inbox', 'kinds.reimbursement_owed'],
  ['pay', 'moments.termsAgreed.title'],
  ['pay', 'moments.termsAgreed.body'],
  ['pay', 'moments.termsAgreed.cta'],
  ['pay', 'ack.recordedNow'],
  ['pay', 'dissent.recordedNow'],
  ['settings', 'carerAvailabilitySummary'],
  ['settings', 'householdTimeOff.summary_one'],
  ['settings', 'householdTimeOff.summary_other'],
];

const namespaces = new Set(VOICE_KEYS.map(([ns]) => ns));

const enLocales: Record<string, Record<string, unknown>> = {};
const esLocales: Record<string, Record<string, unknown>> = {};

for (const ns of namespaces) {
  enLocales[ns] = JSON.parse(
    readFileSync(join(localesRoot, 'en', `${ns}.json`), 'utf8')
  ) as Record<string, unknown>;
  esLocales[ns] = JSON.parse(
    readFileSync(join(localesRoot, 'es', `${ns}.json`), 'utf8')
  ) as Record<string, unknown>;
}

/**
 * Resolve the way i18next does: walk nested objects. A dotted key whose
 * parent is a string (or otherwise not an object) is missing — a flat JSON
 * key like `"carerAvailability.summary"` next to `"carerAvailability": "…"`
 * is unreachable at runtime and must not count as present.
 */
function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const key of parts) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function hasPath(obj: Record<string, unknown>, path: string): boolean {
  return typeof getAtPath(obj, path) === 'string';
}

function extractPlaceholders(value: string): string[] {
  const matches = value.matchAll(/\{\{(\w+)\}\}/g);
  return [...matches].map(m => m[1] ?? '').sort();
}

describe('Pass-1 voice keys', () => {
  it('walks nested objects and treats a dotted key whose parent is a string as missing', () => {
    const ns: Record<string, unknown> = {
      carerAvailability: 'Nanny availability',
      'carerAvailability.summary': '{{days}} days a week · {{hours}}h',
      householdTimeOff: {
        summary_one: '{{count}} day off coming up · next {{date}}',
      },
    };
    expect(hasPath(ns, 'carerAvailability')).toBe(true);
    expect(hasPath(ns, 'carerAvailability.summary')).toBe(false);
    expect(hasPath(ns, 'householdTimeOff.summary_one')).toBe(true);
  });

  it('every Pass-1 voice key exists in en and es with identical {{placeholders}}', () => {
    for (const [namespace, dottedKey] of VOICE_KEYS) {
      const enNs = enLocales[namespace];
      const esNs = esLocales[namespace];
      expect(enNs).toBeDefined();
      expect(esNs).toBeDefined();
      if (!enNs || !esNs) continue;

      expect(hasPath(enNs, dottedKey)).toBe(true);
      expect(hasPath(esNs, dottedKey)).toBe(true);

      const enValue = getAtPath(enNs, dottedKey) as string;
      const esValue = getAtPath(esNs, dottedKey) as string;
      expect(extractPlaceholders(enValue)).toEqual(
        extractPlaceholders(esValue)
      );
    }
  });
});
