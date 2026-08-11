/**
 * @module domains/draft/utils/proposalTerms
 *
 * A `terms_proposals.terms` payload is a `CreatePayArrangementRequest`; the
 * terms document renderer (`buildTermRows`) reads a `PayArrangement`. This is
 * the one adapter between them, so the draft home renders the SAME rows, in
 * the same order, with the same wording, as the parent's "Pay & terms" card
 * and the nanny's "My pay" card. A second row builder here would drift within
 * a release.
 *
 * IT COMPUTES NOTHING. Every field is copied or defaulted to null, and there
 * is deliberately no `weekly_equivalent_minor` on the result: the only weekly
 * figure this screen may print is the server-computed one on the proposal
 * itself (§17, D23). At $28.00 with overtime after 40h, 50 guaranteed hours
 * is $1,540.00; a naive `rate × hours` prints $1,400.00, on the screen where
 * the contract is signed.
 *
 * NULL SURVIVES. An unstated term stays null so `AmountRow` can render the
 * agreement ("No cancellation pay") or the blank ("Not set") — never a
 * fabricated $0.00 (T16).
 */
import type {
  CreatePayArrangementRequest,
  PayArrangement,
} from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { formatMoney } from '@/src/lib/money';

/**
 * The salary-framing figure, formatted — or null when the server did not
 * compute one (no rate, or no guaranteed hours).
 *
 * THE ONLY INPUT IS `weekly_equivalent_minor`. It is deliberately impossible
 * to call this with a rate and a number of hours: the argument it takes is
 * the answer, not the ingredients. Null renders NOTHING rather than a figure
 * we cannot stand behind (T16).
 */
export function weeklyEquivalentAmount(proposal: TermsProposal): string | null {
  if (proposal.weekly_equivalent_minor === null) return null;
  return formatMoney(
    proposal.weekly_equivalent_minor,
    proposal.terms.currency ?? 'USD'
  );
}

interface ProposalIdentity {
  proposalId: string;
  householdId: string;
  carerId: string;
  carerDisplayName: string;
}

export function proposalTermsToArrangement(
  terms: CreatePayArrangementRequest,
  identity: ProposalIdentity
): PayArrangement {
  return {
    // Identity fields exist because the type demands them; nothing on the
    // draft home reads them, and no row is ever persisted from this object.
    id: identity.proposalId,
    household_id: identity.householdId,
    carer_id: identity.carerId,
    carer_display_name: identity.carerDisplayName,
    rate_minor: terms.rate_minor,
    bill_rate_minor: null,
    // A draft has no household currency yet (§4.1) — hers came from the
    // device and travels on the proposal.
    currency: terms.currency ?? 'USD',
    overtime_threshold_minutes: terms.overtime_threshold_minutes ?? null,
    overtime_multiplier: terms.overtime_multiplier,
    overtime_daily_threshold_minutes:
      terms.overtime_daily_threshold_minutes ?? null,
    doubletime_daily_threshold_minutes:
      terms.doubletime_daily_threshold_minutes ?? null,
    doubletime_multiplier: terms.doubletime_multiplier ?? null,
    seventh_day_multiplier: terms.seventh_day_multiplier ?? null,
    seventh_day_doubletime_after_minutes:
      terms.seventh_day_doubletime_after_minutes ?? null,
    worked_holiday_multiplier: terms.worked_holiday_multiplier ?? null,
    pay_frequency: terms.pay_frequency ?? null,
    pay_day_of_week: terms.pay_day_of_week ?? null,
    pay_day_of_month: terms.pay_day_of_month ?? null,
    guaranteed_minutes_per_week: terms.guaranteed_minutes_per_week ?? null,
    pto_entitlement_minutes_per_year:
      terms.pto_entitlement_minutes_per_year ?? null,
    mileage_rate_per_mile_minor: terms.mileage_rate_per_mile_minor ?? null,
    cancellation_paid_within_hours:
      terms.cancellation_paid_within_hours ?? null,
    valid_from: terms.valid_from,
    valid_to: null,
    note: terms.note ?? null,
    created_by: identity.carerId,
    created_at: new Date(0).toISOString(),
    terms: terms.terms,
  };
}
