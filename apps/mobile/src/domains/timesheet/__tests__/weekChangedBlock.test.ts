/**
 * @module domains/timesheet/__tests__/weekChangedBlock.test
 *
 * A3 — WHICH FIGURE GOES IN THE BIG SLOT, and what the sentence under it
 * claims. Two shapes reach `WeekTotal.weekChanged` and they mean opposite
 * things:
 *
 * - UNPAID / demoted (111): the approval was destroyed, so the big figure is
 *   the NEW TOTAL FOR THE WHOLE WEEK and the delta is a clause in the
 *   sentence. It used to be the delta — `CA$0.83` in the same 28pt tabular
 *   slot that holds a TOTAL everywhere else on the screen, under a sentence
 *   reading "replaces the total you approved before". A parent read that as
 *   "this may destroy her pay" and did not approve, which is the single most
 *   expensive misread this product can produce.
 * - PAID (102): the approval and its payments stand, so the delta genuinely
 *   IS a separate amount still to settle — it keeps the big slot, and gets a
 *   caption saying which of the two numbers it is.
 *
 * The builders take `t` as a parameter, so this drives them with a REAL
 * interpolating translate over the shipped `en/hours.json` — the key-echo
 * mock in `bun.setup.ts` would hide both the figure and the copy, which are
 * the only two things this file is about.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

type Bundle = { [key: string]: string | Bundle };

let enHours: Bundle;
let buildDemotedWeekChanged: typeof import('../components/ParentWeekView').buildDemotedWeekChanged;
let buildPaidWeekChanged: typeof import('../components/ParentWeekView').buildPaidWeekChanged;

/** `t` as i18next actually behaves: resolve the dotted key, interpolate. */
function translate(key: string, options?: Record<string, unknown>): string {
  const raw = key
    .split('.')
    .reduce<string | Bundle | undefined>(
      (node, part) =>
        node && typeof node === 'object' ? node[part] : undefined,
      enHours
    );
  if (typeof raw !== 'string') {
    throw new Error(`hours:${key} is not a string in en/hours.json`);
  }
  return raw.replace(/{{(\w+)}}/g, (_match, name: string) =>
    String(options?.[name] ?? `{{${name}}}`)
  );
}

const APPROVED = {
  approved_at: '2026-08-10T09:00:00.000Z',
  approved_by: 'parent-1',
  gross_minor: 23_612,
  currency: 'GBP',
  worked_minutes: 2460,
};

const LIVE = {
  status: 'ok' as const,
  week_start: '2026-08-03',
  currency: 'GBP',
  lines: [],
  gross_minor: 30_612,
  reimbursements_minor: 0,
  worked_minutes: 2940,
  payable_minutes: 2940,
  guaranteed_minutes_per_week: null,
};

const FROZEN = { ...LIVE, gross_minor: 23_612, worked_minutes: 2460 };

beforeAll(async () => {
  enHours = (await Bun.file(
    join(__dirname, '../../../i18n/locales/en/hours.json')
  ).json()) as Bundle;
  const mod = await import('../components/ParentWeekView');
  buildDemotedWeekChanged = mod.buildDemotedWeekChanged;
  buildPaidWeekChanged = mod.buildPaidWeekChanged;
});

describe('the demoted week — the approval was destroyed', () => {
  const build = () =>
    buildDemotedWeekChanged({
      t: translate,
      name: 'Amara',
      date: '12 August',
      approvedDate: '10 August',
      previous: APPROVED,
      live: LIVE,
    });

  it('puts the NEW WHOLE-WEEK TOTAL in the big slot, never the delta', () => {
    // £306.12 is the week. £70.00 is the delta, and it belongs in the
    // sentence — a bare £70.00 at 28pt reads as "this is what she gets".
    expect(build().amountLabel).toBe('£306.12');
    expect(build().amountLabel).not.toBe('£70.00');
  });

  it('captions the figure so it cannot be read as the whole payment', () => {
    expect(build().amountCaption).toBe('The whole week now comes to');
  });

  it('says approving again CONFIRMS the week, never that it replaces it', () => {
    expect(build().detail).toBe(
      "Amara logged 8h 00m on 12 August. That's £70.00 more than the £236.12 you approved for 41h 00m. Approving again confirms £306.12 for the whole week — it doesn't take anything away."
    );
  });

  it('omits the caption on every branch that omits the figure', () => {
    const lower = buildDemotedWeekChanged({
      t: translate,
      name: 'Amara',
      date: '12 August',
      approvedDate: '10 August',
      previous: APPROVED,
      live: { ...LIVE, gross_minor: 10_000, worked_minutes: 1000 },
    });
    expect(lower.amountLabel).toBeNull();
    expect(lower.amountCaption).toBeNull();

    const unpriced = buildDemotedWeekChanged({
      t: translate,
      name: 'Amara',
      date: '12 August',
      approvedDate: '10 August',
      previous: APPROVED,
      live: null,
    });
    expect(unpriced.amountLabel).toBeNull();
    expect(unpriced.amountCaption).toBeNull();
  });

  // The week SHRANK: there is nothing to reassure anyone about, and saying
  // "it doesn't take anything away" there would be false.
  it('offers no reassurance on a week that came out lower', () => {
    const lower = buildDemotedWeekChanged({
      t: translate,
      name: 'Amara',
      date: '12 August',
      approvedDate: '10 August',
      previous: APPROVED,
      live: { ...LIVE, gross_minor: 10_000, worked_minutes: 1000 },
    });
    expect(lower.detail).not.toContain("doesn't take anything away");
  });
});

describe('the paid week — the approval and its payments stand', () => {
  const build = () =>
    buildPaidWeekChanged({
      t: translate,
      name: 'Amara',
      date: '12 August',
      frozen: FROZEN,
      revised: LIVE,
    });

  it('keeps the delta in the big slot — it is a real separate amount', () => {
    expect(build().amountLabel).toBe('£70.00');
  });

  it('names which of the two numbers the figure is', () => {
    expect(build().amountCaption).toBe('Not covered by the approved total');
  });

  it('omits the caption wherever it omits the figure', () => {
    const unpriced = buildPaidWeekChanged({
      t: translate,
      name: 'Amara',
      date: '12 August',
      frozen: FROZEN,
      revised: null,
    });
    expect(unpriced.amountLabel).toBeNull();
    expect(unpriced.amountCaption).toBeNull();
  });
});

/**
 * `previous_approval` is CLEARED on re-approve
 * (`timesheetRepository.ts:295–301`), so no surface may claim the earlier
 * approval survives — that would be a false statement on a money screen.
 * And "replaces" is the word that produced the misread in the first place.
 */
describe('the approve dialog — the same fear, one screen later', () => {
  it('says the earlier approval is INCLUDED in this total', () => {
    expect(
      translate('approveDialog.supersedes', {
        amount: '£236.12',
        date: '10 August',
      })
    ).toBe('The £236.12 you approved on 10 August is included in this total.');
  });

  // Narrow on purpose: `withdrawQueryDialogBody` says what's ALREADY BEEN
  // SAID stays on the record, which is true — the thread is append-only.
  // It is the APPROVAL that does not survive.
  it('never claims the earlier approval stays on the record', () => {
    const everyString = JSON.stringify(enHours);
    expect(everyString).not.toContain('approval stays on the record');
    expect(everyString).not.toContain('replaces the total you approved');
  });
});
