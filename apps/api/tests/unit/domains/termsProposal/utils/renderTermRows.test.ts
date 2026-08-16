/**
 * @module tests/unit/domains/termsProposal/utils/renderTermRows
 *
 * THE ORDERING PIN (§6.2, §7.2). "The family reads the same contract on the
 * web as in the app" is only true if the row order and the words are the
 * same, and the two live in different apps — `renderTermRows.ts` here and
 * `apps/mobile/src/domains/pay/utils/termRows.ts` there. Nothing in the type
 * system connects them, so the connection is this test: it READS the mobile
 * builder's source and the en-US locale, derives the expected label sequence
 * from them, and compares. Duplicating the order by eye is exactly what
 * agent-3o's contract forbids, and it is the failure mode that ships a web
 * page missing a term the parent then agrees to unseen.
 *
 * A static-source assertion, the same technique `payArrangementRoutes.test.ts`
 * uses to prove the mount path hasn't drifted. It cannot run the mobile code
 * (React Native imports), but it can prove the two lists agree.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderTermRows,
  renderTermsHeader,
} from '../../../../../src/domains/termsProposal/utils/renderTermRows';

const REPO = join(import.meta.dir, '../../../../../../..');
const MOBILE_TERM_ROWS = join(
  REPO,
  'apps/mobile/src/domains/pay/utils/termRows.ts'
);
const EN_PAY = join(REPO, 'apps/mobile/src/i18n/locales/en/pay.json');

/**
 * The two deliberate deltas between this renderer and the mobile builder,
 * both stated here so the diff is a decision rather than a drift:
 *
 * - `ptoBalance` is DROPPED. It is a live `pto_ledger` figure, and a proposal
 *   has no ledger — rendering it would mean inventing a balance for an
 *   agreement nobody has made yet (T16).
 * - `startsOn` is ADDED, last. `valid_from` is the app's card header, but
 *   §7.4 makes the start date the whole reason D-16 blocks this feature, and
 *   both the §6.2 and §7.2 mocks end the terms card with "Starts".
 */
const DROPPED_FROM_MOBILE = 'ptoBalance';

/**
 * Where a row's label lives in `en/pay.json`. `terms.<key>Label` is the rule;
 * `termGroups.<key>` is the fallback, because `outsideWages` and `inWriting`
 * were served from there until the 3-U pass added their `terms.*Label` twins.
 * Trying both in order means this pin keeps working through that migration
 * instead of going red on somebody else's tidy-up.
 */
function labelFor(
  pay: Record<string, Record<string, string>>,
  key: string
): string | undefined {
  return pay.terms?.[`${key}Label`] ?? pay.termGroups?.[key];
}

function mobileRowKeys(): string[] {
  const source = readFileSync(MOBILE_TERM_ROWS, 'utf8');
  // Every row literal in the RETURNED array sits at exactly six spaces of
  // indent (`return [` → `{` → `key:`). The ptoBalance row is built above the
  // return, inline or at twelve, so this indent is also what excludes it.
  const keys = [...source.matchAll(/^ {6}key: '([a-zA-Z]+)',$/gm)].map(
    match => match[1] as string
  );
  // The ptoBalance row is built above the return and spliced in by name, so
  // it never matches the indented literal form — assert it is absent rather
  // than filtering blindly, or a future reshuffle silently changes what this
  // test compares.
  expect(keys).not.toContain(DROPPED_FROM_MOBILE);
  expect(keys.length).toBeGreaterThan(8);
  return keys;
}

function enLabels(): Record<string, string> {
  const pay = JSON.parse(readFileSync(EN_PAY, 'utf8')) as Record<
    string,
    Record<string, string>
  >;
  const labels: Record<string, string> = {};
  for (const key of mobileRowKeys()) {
    const value = labelFor(pay, key);
    if (typeof value === 'string') labels[key] = value;
  }
  return labels;
}

/** The spec's worked example, as a `CreatePayArrangementRequest`. */
function terms(overrides: Record<string, unknown> = {}) {
  return {
    rate_minor: 2800,
    currency: 'USD',
    overtime_threshold_minutes: 2400,
    overtime_multiplier: 1.5,
    overtime_daily_threshold_minutes: 480,
    guaranteed_minutes_per_week: 3000,
    pto_entitlement_minutes_per_year: 4800,
    valid_from: '2026-08-17',
    ...overrides,
  };
}

/**
 * The ordering pin has to see EVERY row, including the ones the partial
 * `terms()` fixture leaves unset. After T16 stopped printing "Not set" for
 * a null, that partial fixture would render five rows and the pin would
 * stop exercising double time, seventh day, cancellations, mileage, the
 * pay schedule, holiday hours, outside wages and in-writing — the exact
 * inventory it exists to lock. This fixture fills each of those so the
 * comparison against `termRows.ts` still walks the whole list.
 */
function fullyPopulatedTerms() {
  return terms({
    doubletime_daily_threshold_minutes: 720,
    doubletime_multiplier: 2,
    seventh_day_multiplier: 1.5,
    seventh_day_doubletime_after_minutes: 480,
    worked_holiday_multiplier: 1.5,
    holiday_hours_minutes: 480,
    cancellation_paid_within_hours: 24,
    mileage_rate_per_mile_minor: 67,
    pay_frequency: 'weekly',
    terms: {
      recurring: [
        {
          label: 'health stipend',
          amount_minor: 20_000,
          cadence: 'monthly',
        },
      ],
      notice_period_days: 14,
      duties: 'School run.',
    },
  });
}

const render = (t: Record<string, unknown>) => renderTermRows(t as any, 'USD');

describe('renderTermRows — the four-surface ordering contract', () => {
  it('renders the mobile inventory, in the mobile order, with the app`s own words', () => {
    const labels = enLabels();
    // The WHOLE array, no slicing — the mobile keys (which already exclude
    // `ptoBalance`) plus the one added row. A slice with magic indices is the
    // same positional trap the header split just removed, one level down.
    const expected = mobileRowKeys()
      .map(key => labels[key])
      .filter((label): label is string => label !== undefined);
    expect(render(fullyPopulatedTerms()).map(row => row.label)).toEqual([
      ...expected,
      'Starts',
    ]);
  });

  it('drops the PTO BALANCE row — a proposal has no ledger to report', () => {
    const labels = render(terms()).map(row => row.label);
    expect(labels).not.toContain('PTO balance');
  });

  it('ends with the start date, which is what D-16 exists for', () => {
    const rows = render(terms());
    expect(rows.at(-1)).toEqual({
      label: 'Starts',
      value: 'Monday Aug 17',
    });
  });
});

describe('renderTermsHeader — the server-computed figure, never rate x hours', () => {
  const header = (t: Record<string, unknown>, weekly: number | null = 154000) =>
    renderTermsHeader(t as any, weekly, 'USD');

  it('states $1,540.00 a week at 50 guaranteed hours, NOT $1,400.00', () => {
    expect(header(terms())).toEqual({
      rate: '$28.00',
      weeklyLine: '$1,540.00 a week at 50 guaranteed hours',
    });
  });

  it('the header is NOT a row — no invented "Hourly rate" label reaches the page', () => {
    expect(render(terms()).map(r => r.label)).not.toContain('Hourly rate');
  });

  it('omits the weekly line when the server computed none', () => {
    expect(header(terms(), null).weeklyLine).toBeNull();
  });

  it('omits the weekly line when there is no guarantee to spread it over', () => {
    expect(
      header(terms({ guaranteed_minutes_per_week: null })).weeklyLine
    ).toBeNull();
  });

  it('omits the weekly line when there is no rate', () => {
    expect(header(terms({ rate_minor: 0 })).weeklyLine).toBeNull();
  });

  it('formats minor units through Intl, never a hand-rolled decimal', () => {
    expect(header(terms({ rate_minor: 123_456 })).rate).toBe('$1,234.56');
  });

  it('honours a terms currency that differs from the household default', () => {
    expect(
      renderTermsHeader(terms({ currency: 'GBP' }) as any, null, 'USD').rate
    ).toBe('£28.00');
  });
});

describe('renderTermRows — T16 survives the flattening to plain strings', () => {
  it('drops the Overtime row when overtime_threshold_minutes is null', () => {
    const rows = render(terms({ overtime_threshold_minutes: null }));
    expect(rows.map(r => r.label)).not.toContain('Overtime');
  });

  it('drops the Cancellations row when cancellation_paid_within_hours is null', () => {
    const rows = render(terms({ cancellation_paid_within_hours: null }));
    expect(rows.map(r => r.label)).not.toContain('Cancellations');
  });

  it('never prints "Not set" in any row value', () => {
    const values = render(terms()).map(r => r.value);
    expect(values.some(value => value.includes('Not set'))).toBe(false);
  });

  it('never prints "No cancellation pay" in any row value', () => {
    const values = render(terms({ cancellation_paid_within_hours: null })).map(
      r => r.value
    );
    expect(values.some(value => value.includes('No cancellation pay'))).toBe(
      false
    );
  });

  it('a set cancellation window still renders its row normally', () => {
    const rows = render(terms({ cancellation_paid_within_hours: 24 }));
    expect(rows.find(r => r.label === 'Cancellations')?.value).toBe(
      'Paid if within 24h of the start'
    );
  });
});

describe('renderTermRows — the term values themselves', () => {
  it('states weekly overtime with its threshold and multiplier', () => {
    expect(render(terms()).find(r => r.label === 'Overtime')?.value).toBe(
      'After 40h, at 1.5×'
    );
  });

  it('trims a trailing zero from a whole multiplier', () => {
    const rows = render(terms({ overtime_multiplier: 2 }));
    expect(rows.find(r => r.label === 'Overtime')?.value).toBe(
      'After 40h, at 2×'
    );
  });

  it('renders the guarantee and the PTO entitlement in hours', () => {
    const rows = render(terms());
    expect(rows.find(r => r.label === 'Guaranteed hours')?.value).toBe(
      '50h a week'
    );
    expect(rows.find(r => r.label === 'Paid time off')?.value).toBe(
      '80h a year'
    );
  });

  it('summarises outside wages the way the mock does', () => {
    const rows = render(
      terms({
        terms: {
          recurring: [
            {
              label: 'health stipend',
              amount_minor: 20_000,
              cadence: 'monthly',
            },
          ],
        },
      })
    );
    // Label first, then the amount — `terms.outsideWagesItemMonthly`'s own
    // order in en/pay.json, which is what the app renders.
    expect(rows.find(r => r.label === 'Outside wages')?.value).toBe(
      'health stipend $200.00 a month'
    );
  });

  it('DROPS a malformed stipend row rather than rendering it as agreed', () => {
    const rows = render(
      terms({ terms: { recurring: [{ label: 'x' }, 'nonsense'] } })
    );
    expect(rows.find(r => r.label === 'Outside wages')).toBeUndefined();
  });

  it('reports "In writing" as a count only — §6.2 keeps the block collapsed', () => {
    const rows = render(
      terms({ terms: { notice_period_days: 14, duties: 'School run.' } })
    );
    expect(rows.find(r => r.label === 'In writing')?.value).toBe(
      '2 of 5 filled in'
    );
  });
});

describe('renderTermRows — the constraints the public page imposes', () => {
  it('names no US state anywhere (owner decision, §4.1.1)', () => {
    const everything = render(terms())
      .flatMap(row => [row.label, row.value])
      .join(' ');
    for (const state of ['California', 'CA ', 'New York', 'Texas']) {
      expect(everything).not.toContain(state);
    }
  });

  it('is pure — the same input renders identically twice', () => {
    expect(render(terms())).toEqual(render(terms()));
  });

  it('never returns a null or undefined value, so the worker formats nothing', () => {
    for (const row of render(terms({ pay_frequency: null }))) {
      expect(typeof row.value).toBe('string');
      expect(row.value.length).toBeGreaterThan(0);
    }
  });
});

describe('every row label really resolves in en-US', () => {
  // A label the locale cannot supply would silently drop out of `enLabels()`
  // and shrink the expected list, so the ordering pin above would keep passing
  // while the web page and the app diverged on that row. This is what stops
  // that: every key the mobile builder renders must resolve to a real string.
  it('no mobile row key is missing its en-US label', () => {
    const pay = JSON.parse(readFileSync(EN_PAY, 'utf8')) as Record<
      string,
      Record<string, string>
    >;
    const missing = mobileRowKeys().filter(
      key => typeof labelFor(pay, key) !== 'string'
    );
    expect(missing).toEqual([]);
  });
});
