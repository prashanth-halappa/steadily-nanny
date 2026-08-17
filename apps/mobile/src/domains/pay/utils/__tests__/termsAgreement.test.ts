/**
 * @module domains/pay/utils/__tests__/termsAgreement
 *
 * P1: "an arrangement exists ⇔ someone tapped Agree with the checkbox
 * ticked" is only true of rows written from now on. This file pins the two
 * halves of the honest label — the join that proves agreement, and the two
 * rows that legitimately carry agreed terms without an acceptance of their
 * own.
 */
import { describe, expect, it } from 'bun:test';
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { resolveTermsAgreement } from '../termsAgreement';

const t = (key: string) => key;

const NOW = '2026-08-16T09:00:00.000Z';

function arrangement(over: Partial<PayArrangement> = {}): PayArrangement {
  return {
    id: 'pa-1',
    household_id: 'h1',
    carer_id: 'c1',
    rate_minor: 2500,
    bill_rate_minor: null,
    currency: 'USD',
    overtime_threshold_minutes: 2400,
    overtime_multiplier: 1.5,
    overtime_daily_threshold_minutes: null,
    doubletime_daily_threshold_minutes: null,
    doubletime_multiplier: null,
    seventh_day_multiplier: null,
    seventh_day_doubletime_after_minutes: null,
    worked_holiday_multiplier: null,
    holiday_hours_minutes: null,
    pay_frequency: null,
    pay_day_of_week: null,
    pay_day_of_month: null,
    guaranteed_minutes_per_week: null,
    pto_entitlement_minutes_per_year: null,
    mileage_rate_per_mile_minor: null,
    cancellation_paid_within_hours: null,
    valid_from: '2026-08-01',
    valid_to: null,
    carer_display_name: 'Andrea',
    note: null,
    terms: {},
    weekly_equivalent_minor: null,
    created_by: 'parent-1',
    created_at: NOW,
    ...over,
  } as PayArrangement;
}

function acceptedProposal(arrangementId: string | null): TermsProposal {
  return {
    id: `prop-for-${arrangementId}`,
    household_id: 'h1',
    carer_id: 'c1',
    proposed_by: 'parent-1',
    direction: 'parent',
    status: 'accepted',
    terms: {
      rate_minor: 2500,
      currency: 'USD',
      overtime_multiplier: 1.5,
      valid_from: '2026-08-01',
    },
    note: null,
    supersedes_id: null,
    from_invite_id: null,
    carer_display_name: 'Andrea',
    weekly_equivalent_minor: null,
    viewed_at: null,
    responded_at: NOW,
    accepted_by: 'c1',
    accepted_arrangement_id: arrangementId,
    responsibility_confirmed: true,
    created_at: NOW,
    updated_at: NOW,
  } as TermsProposal;
}

describe('resolveTermsAgreement', () => {
  it('an arrangement an accepted proposal points at is agreed, and carries that proposal', () => {
    const row = arrangement();
    const proposal = acceptedProposal('pa-1');

    const result = resolveTermsAgreement(row, [proposal], [row], t);

    expect(result.kind).toBe('agreed');
    expect(result.kind === 'agreed' && result.proposal.id).toBe(proposal.id);
  });

  it('a legacy row nothing points at is NOT agreed — no fabricated acceptance', () => {
    const row = arrangement();

    expect(resolveTermsAgreement(row, [], [row], t).kind).toBe(
      'notAgreedInSteadily'
    );
  });

  it('an accepted proposal pointing at a DIFFERENT row does not launder this one', () => {
    const legacy = arrangement({ id: 'pa-legacy', rate_minor: 1800 });
    const agreed = arrangement({ id: 'pa-agreed' });

    const result = resolveTermsAgreement(
      legacy,
      [acceptedProposal('pa-agreed')],
      [legacy, agreed],
      t
    );

    expect(result.kind).toBe('notAgreedInSteadily');
  });

  /**
   * `payArrangementCommandService.cancelScheduled` is the SECOND writer: it
   * appends a row cloning the currently-in-effect terms to undo a scheduled
   * change. Nothing accepts that row, and calling it "not agreed" would be
   * exactly the untrue statement this work exists to remove — it restores
   * terms both sides agreed to. The label follows the TERMS, not the row.
   */
  it('a revert row restoring agreed terms reads as agreed', () => {
    const agreed = arrangement({ id: 'pa-agreed', valid_from: '2026-08-01' });
    const revert = arrangement({
      id: 'pa-revert',
      // The scheduled row's own date, and cancelScheduled's own note — the
      // shape this predicate must NOT depend on.
      valid_from: '2026-09-01',
      note: 'Scheduled change cancelled',
      created_at: '2026-08-20T09:00:00.000Z',
    });

    const result = resolveTermsAgreement(
      revert,
      [acceptedProposal('pa-agreed')],
      [revert, agreed],
      t
    );

    expect(result.kind).toBe('agreed');
  });

  it('a row that restores DIFFERENT terms is not laundered by the same rule', () => {
    const agreed = arrangement({ id: 'pa-agreed', rate_minor: 2500 });
    const other = arrangement({ id: 'pa-other', rate_minor: 1800 });

    const result = resolveTermsAgreement(
      other,
      [acceptedProposal('pa-agreed')],
      [other, agreed],
      t
    );

    expect(result.kind).toBe('notAgreedInSteadily');
  });

  it('an OPEN proposal is not an acceptance', () => {
    const row = arrangement();
    const open = {
      ...acceptedProposal('pa-1'),
      status: 'proposed',
      accepted_arrangement_id: null,
    } as TermsProposal;

    expect(resolveTermsAgreement(row, [open], [row], t).kind).toBe(
      'notAgreedInSteadily'
    );
  });

  it('tolerates undefined proposals and history', () => {
    expect(
      resolveTermsAgreement(arrangement(), undefined, undefined, t).kind
    ).toBe('notAgreedInSteadily');
  });
});
