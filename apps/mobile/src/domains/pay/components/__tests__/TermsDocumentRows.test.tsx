/**
 * @module domains/pay/components/__tests__/TermsDocumentRows
 *
 * THE THREE-SURFACE TEST (`screens-onboarding-terms-proposal.md` §7.2):
 *
 *   "the proposal review, the parent's terms document, and MyPayScreen render
 *    the same group keys in the same order for the same input. One assertion
 *    over three call sites; it is the only thing standing between one contract
 *    and three descriptions of it."
 *
 * Two halves, and both are load-bearing. The render half proves the shared
 * component emits one order whatever prefix it is given. The source half
 * proves the three screens actually go through it — because a component
 * nobody uses cannot enforce anything, and the failure this test exists to
 * catch is precisely somebody hand-rolling a shorter row list on the review
 * screen and shipping a parent an Agree button over half a contract (M22).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import { render } from '@testing-library/react-native';
import { buildTermRows } from '../../utils/termRows';
import { TermsDocumentRows } from '../TermsDocumentRows';

const arrangement: PayArrangement = {
  id: 'arr-1',
  household_id: 'hh-1',
  carer_id: 'carer-1',
  rate_minor: 2800,
  bill_rate_minor: null,
  currency: 'USD',
  overtime_threshold_minutes: 2400,
  overtime_multiplier: 1.5,
  overtime_daily_threshold_minutes: 480,
  doubletime_daily_threshold_minutes: null,
  doubletime_multiplier: null,
  seventh_day_multiplier: null,
  seventh_day_doubletime_after_minutes: null,
  worked_holiday_multiplier: 1.5,
  pay_frequency: 'weekly',
  pay_day_of_week: 5,
  pay_day_of_month: null,
  guaranteed_minutes_per_week: 3000,
  pto_entitlement_minutes_per_year: 4800,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: 24,
  valid_from: '2026-08-17',
  valid_to: null,
  carer_display_name: 'Marisol',
  note: null,
  terms: { notice_period_days: 28, recurring: [] },
  weekly_equivalent_minor: 154000,
  created_by: 'carer-1',
  created_at: '2026-08-10T15:00:00.000Z',
};

/** The prefixes the three surfaces really pass. */
const PARENT_DOCUMENT = 'pay-term';
const MY_PAY = 'my-pay-term-hh-1';
const PROPOSAL_REVIEW = 'proposal-term';

function keysRenderedWith(testIDPrefix: string): string[] {
  const { toJSON } = render(
    <TermsDocumentRows arrangement={arrangement} testIDPrefix={testIDPrefix} />
  );
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const element = node as {
      props?: { testID?: string };
      children?: unknown;
    };
    const testID = element.props?.testID;
    if (
      typeof testID === 'string' &&
      testID.startsWith(`${testIDPrefix}-`) &&
      !testID.endsWith('-value') &&
      !testID.endsWith('-subline')
    ) {
      ids.push(testID.slice(testIDPrefix.length + 1));
    }
    walk(element.children);
  };
  walk(toJSON());
  return ids;
}

describe('the one terms document, rendered on three surfaces', () => {
  it('renders the same group keys in the same order for the same input', () => {
    const parent = keysRenderedWith(PARENT_DOCUMENT);
    const nanny = keysRenderedWith(MY_PAY);
    const proposal = keysRenderedWith(PROPOSAL_REVIEW);

    expect(parent).toEqual(nanny);
    expect(nanny).toEqual(proposal);
    // …and that one order is the §3 inventory, not a shorter list all three
    // happen to agree on.
    expect(parent).toEqual(
      buildTermRows(arrangement, (key: string) => key).map(row => row.key)
    );
    expect(parent).toContain('outsideWages');
    expect(parent).toContain('inWriting');
  });

  it('all three surfaces route through this component and none builds its own rows', () => {
    const componentsDir = join(import.meta.dir, '..');
    const surfaces = [
      'PayArrangementScreen.tsx',
      'MyPayScreen.tsx',
      'ProposalTermsDocument.tsx',
    ];
    for (const file of surfaces) {
      const source = readFileSync(join(componentsDir, file), 'utf8');
      expect(source).toContain('TermsDocumentRows');
      // `buildTermRows` belongs to the shared component alone — a screen that
      // imports it is a screen writing its own second description of the
      // contract.
      expect(source).not.toContain('buildTermRows');
    }
  });

  it('a per-key subLine overrides the row own second line — §7.6’s "was $28.00/hr"', () => {
    const { getByTestId } = render(
      <TermsDocumentRows
        arrangement={arrangement}
        testIDPrefix={PROPOSAL_REVIEW}
        subLineByKey={{ guaranteedHours: 'was 45h a week' }}
      />
    );
    expect(getByTestId('proposal-term-guaranteedHours')).toBeTruthy();
    expect(
      getByTestId('proposal-term-guaranteedHours-subline').props.children
    ).toBe('was 45h a week');
  });
});
