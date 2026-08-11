/**
 * @module domains/pay/utils/proposalTerms
 *
 * The three pure things 3-O's proposal screens need
 * (`docs/design/screens-onboarding-terms-proposal.md` §7, §10).
 *
 * **A proposal is read as the terms document.** `arrangementFromProposal`
 * turns a `TermsProposal` into the `PayArrangement` shape `buildTermRows`
 * already formats, so the review screen renders the SAME rows, in the SAME
 * order, worded the SAME way as the parent's Pay & terms card and the
 * nanny's My pay card. It is a projection, never a second formatter.
 *
 * **The weekly figure is carried, never computed.** `weekly_equivalent_minor`
 * comes off the proposal untouched. At $28.00 with overtime after 40h, 50
 * guaranteed hours is $1,540.00; `rate × hours` prints $1,400.00, which is
 * only wrong on arrangements WITH overtime — so it passes every test written
 * against a no-overtime fixture and then disagrees with payroll on the one
 * screen where the contract is agreed (§17, D23). There is no multiply here
 * and there must never be one.
 *
 * **State words never render alone.** §10: the word appears with a date,
 * beside the figure, every time the figure is shown — and a Countered row
 * always also names the actor, because Proposed and Countered share the ochre
 * pill on purpose and `daylight-v2.md` §5.2 forbids colour as the only
 * channel for a distinction.
 */
import type { PayArrangement } from '@steadily-nanny/shared-types/schemas/payArrangement.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { localDateInZone } from '@/src/lib/localDate';
import { formatShortDate } from './payArrangementForm';

/** The `termRows.ts` convention — a narrow translate fn, so this module is
 * exhaustively unit-testable without i18next's overloaded generics. */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * A proposal as the terms document reads it.
 *
 * `terms` IS a `CreatePayArrangementRequest` on the wire (the schema's own
 * decision — mirroring twenty columns would double T17's trap), so every
 * optional field is spread through with an explicit `?? null`: an omitted
 * tier is an agreed "no tier", never a fabricated default.
 */
export function arrangementFromProposal(
  proposal: TermsProposal
): PayArrangement {
  const terms = proposal.terms;
  return {
    id: proposal.id,
    household_id: proposal.household_id,
    carer_id: proposal.carer_id,
    rate_minor: terms.rate_minor,
    bill_rate_minor: null,
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
    carer_display_name: proposal.carer_display_name,
    note: proposal.note,
    terms: terms.terms,
    // Carried, never computed. See this module's header.
    weekly_equivalent_minor: proposal.weekly_equivalent_minor,
    created_by: proposal.proposed_by,
    created_at: proposal.created_at,
  };
}

/**
 * §7.2's "How we got here" — this proposal and every round behind it, newest
 * first, walked back along `supersedes_id`.
 *
 * A `seen` set guards the walk: a counter is an append and the chain is a
 * line, but a hand-edited or replicated row could point at itself, and a
 * history screen must not hang because the data lied.
 */
export function buildProposalChain(
  all: readonly TermsProposal[],
  proposal: TermsProposal
): TermsProposal[] {
  const chain: TermsProposal[] = [proposal];
  const seen = new Set([proposal.id]);
  let cursor: TermsProposal | undefined = proposal;
  while (cursor?.supersedes_id && !seen.has(cursor.supersedes_id)) {
    const previousId: string = cursor.supersedes_id;
    seen.add(previousId);
    cursor = all.find(row => row.id === previousId);
    if (!cursor) break;
    chain.push(cursor);
  }
  return chain;
}

type StateKind = 'proposed' | 'countered' | 'agreed' | 'withdrawn';

/** The date the state word is about: when it was answered, or when it was
 * written. Household-local, because the day terms were proposed is a day in
 * the family's week, not in whatever zone the reader's device sits in. */
function stateDate(
  proposal: TermsProposal,
  kind: StateKind,
  timezone: string
): string {
  const timestamp =
    kind === 'agreed' || kind === 'withdrawn' || proposal.status === 'countered'
      ? (proposal.responded_at ?? proposal.created_at)
      : proposal.created_at;
  return formatShortDate(localDateInZone(timezone, new Date(timestamp)));
}

function stateKind(proposal: TermsProposal): StateKind {
  if (proposal.status === 'accepted') return 'agreed';
  if (proposal.status === 'withdrawn') return 'withdrawn';
  if (proposal.status === 'countered') return 'countered';
  return proposal.supersedes_id ? 'countered' : 'proposed';
}

export interface ProposalStateWord {
  /** No new `status-pill` variants (§16 item 8) — Proposed and Countered
   * share the ochre `pending` pill and the WORD carries the distinction. */
  variant: 'pending' | 'confirmed' | 'cancelled';
  label: string;
}

/**
 * §10's word, with its date, for the header pill beside the figure.
 *
 * Never "Pending approval", "Awaiting sign-off" or "Contract active" — those
 * are verdicts about people or HR words about a family. "Agreed" is this
 * flow's word (D-41); "Accepted" and "Approved" belong to other flows and
 * must not appear in user-facing copy here.
 */
export function proposalStateWord(
  proposal: TermsProposal,
  opts: { counterpartyName: string; timezone: string },
  t: Translate
): ProposalStateWord {
  const kind = stateKind(proposal);
  const date = stateDate(proposal, kind, opts.timezone);
  switch (kind) {
    case 'agreed':
      return {
        variant: 'confirmed',
        label: t('proposal.state.agreedWith', {
          name: opts.counterpartyName,
          date,
        }),
      };
    case 'withdrawn':
      return {
        variant: 'cancelled',
        label: t('proposal.state.withdrawn', { date }),
      };
    case 'countered':
      return {
        variant: 'pending',
        label: t('proposal.state.countered', { date }),
      };
    default:
      return {
        variant: 'pending',
        label: t('proposal.state.proposed', { date }),
      };
  }
}

/**
 * §7.2's history row — always names the actor, which is what makes the two
 * ochre states distinguishable without a second colour token.
 *
 * It describes the AUTHORING act, not the row's current status: the first
 * round reads "Proposed by Marisol · Aug 10" for as long as it exists, even
 * once it has been countered, because that is what she did.
 */
export function proposalHistoryLabel(
  proposal: TermsProposal,
  opts: { authorName: string; timezone: string },
  t: Translate
): string {
  const date = formatShortDate(
    localDateInZone(opts.timezone, new Date(proposal.created_at))
  );
  return proposal.supersedes_id
    ? t('proposal.state.counteredBy', { name: opts.authorName, date })
    : t('proposal.state.proposedBy', { name: opts.authorName, date });
}
