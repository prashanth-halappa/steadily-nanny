/**
 * @module domains/pay/components/ProposalTermsDocument
 *
 * §7.2's review body: the terms document in view mode, with a proposal's
 * header state word instead of an arrangement's "in effect since".
 *
 * It is deliberately NOT a list of rows this file designs. The rows come from
 * `TermsDocumentRows`, the same component the parent's Pay & terms card and
 * the nanny's My pay card render, so all three describe one contract
 * (`__tests__/TermsDocumentRows.test.tsx` asserts exactly that). A review
 * screen showing six rows out of an eighteen-term inventory would make the
 * nanny the person who "snuck something in" — the accusation this whole
 * feature exists to make impossible (M22).
 *
 * THE WEEKLY FIGURE IS THE SERVER'S. `weekly_equivalent_minor` comes off the
 * proposal; there is no multiply here and there must never be one. At $28.00
 * with overtime after 40h, 50 guaranteed hours is $1,540.00 — `rate × hours`
 * prints $1,400.00, which is only wrong on arrangements WITH overtime, and
 * this is the screen where the contract is agreed (§17, D23).
 */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { StatusPill } from '@/src/components/ui/status-pill';
import {
  Body,
  MetadataLabel,
  SignatureHeroBold,
  Small,
} from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';
import {
  arrangementFromProposal,
  proposalHistoryLabel,
  proposalStateWord,
} from '../utils/proposalTerms';
import { buildTermsDiff } from '../utils/termsDiff';
import { AmountRow } from './AmountRow';
import { TermsDocumentRows } from './TermsDocumentRows';

export interface ProposalTermsDocumentProps {
  proposal: TermsProposal;
  /** This proposal and every round behind it, newest first
   * (`buildProposalChain`). A first round is a chain of one. */
  chain: readonly TermsProposal[];
  /** The reader — decides whether a round reads "by you" or by their name. */
  viewerId: string;
  /** The other party, as the reader would name them: "Marisol" for a parent,
   * "the Ahmeds" for a nanny. */
  counterpartyName: string;
  /** Household IANA zone — the day terms were proposed is a day in the
   * family's week, not in the reader's device zone. */
  timezone: string;
}

export function ProposalTermsDocument({
  proposal,
  chain,
  viewerId,
  counterpartyName,
  timezone,
}: ProposalTermsDocumentProps) {
  const { t } = useTranslation('pay');

  const arrangement = arrangementFromProposal(proposal);
  const previous = chain[1];
  // §7.6: only a counter has a "was". `buildTermsDiff` is the SAME function
  // the version history and the change review use — a diff described one way
  // here and another way there is how "what did they actually change?"
  // becomes a phone call.
  const diff = previous
    ? buildTermsDiff(arrangementFromProposal(previous), arrangement, t)
    : [];
  const rateWas = diff.find(row => row.key === 'rate')?.before ?? null;
  const subLineByKey = Object.fromEntries(
    diff
      .filter(row => row.key !== 'rate' && row.before !== null)
      .map(row => [row.key, t('proposal.was', { value: row.before })])
  );

  const authorName =
    proposal.proposed_by === viewerId ? t('proposal.you') : counterpartyName;
  // B4 — the decliner is always the AUTHOR's counterparty, so this is
  // `authorName`'s branches swapped: the author's own screen reads "the
  // other side" (counterpartyName); the decliner's own screen reads "you".
  const declinedByName =
    proposal.proposed_by === viewerId ? counterpartyName : t('proposal.you');
  const state = proposalStateWord(
    proposal,
    { counterpartyName, timezone, declinedByName },
    t
  );

  const weeklyMinor = proposal.weekly_equivalent_minor;
  const guaranteedMinutes = arrangement.guaranteed_minutes_per_week;

  return (
    <View className="gap-4">
      <View className="gap-1">
        <View className="flex-row items-baseline gap-1">
          <SignatureHeroBold testID="proposal-rate" tabular>
            {formatMoney(arrangement.rate_minor, arrangement.currency)}
          </SignatureHeroBold>
          <Body className="text-muted-strong">{t('perHour')}</Body>
        </View>
        {rateWas ? (
          <Small testID="proposal-rate-was" className="text-muted-strong">
            {t('proposal.wasRate', { value: rateWas })}
          </Small>
        ) : null}
        {/* Both halves or nothing: a weekly figure with no guarantee behind it
            is a number nobody agreed to. */}
        {weeklyMinor !== null && guaranteedMinutes !== null ? (
          <Body
            testID="proposal-weekly-equivalent"
            className="text-muted-strong"
          >
            {t('termGroups.weeklyEquivalent', {
              amount: formatMoney(weeklyMinor, arrangement.currency),
              hours: guaranteedMinutes / 60,
            })}
          </Body>
        ) : null}
        {/* §10's even-spread caveat: the weekly figure assumes the guarantee
            is spread evenly, and daily overtime makes longer days cost more
            than the line says. */}
        {weeklyMinor !== null &&
        guaranteedMinutes !== null &&
        arrangement.overtime_daily_threshold_minutes !== null ? (
          <Small
            testID="proposal-weekly-caveat"
            className="text-muted-foreground"
          >
            {t('proposal.evenSpreadCaveat')}
          </Small>
        ) : null}
        <View className="mt-1 flex-row flex-wrap gap-2">
          <StatusPill
            testID="proposal-state-pill"
            variant={state.variant}
            label={state.label}
          />
          <StatusPill
            testID="proposal-by-pill"
            variant="cancelled"
            label={t('proposal.by', { name: authorName })}
          />
        </View>
      </View>

      <TermsDocumentRows
        arrangement={arrangement}
        testIDPrefix="proposal-term"
        subLineByKey={subLineByKey}
      />

      {/* The document's last row. `terms.startsLabel` rather than a sentence
          of this screen's own: the API's terms-preview renderer derives its
          expected label sequence from `termRows.ts` plus `en/pay.json`, so a
          shared key pins the two surfaces to each other instead of leaving
          them to agree by coincidence. */}
      <AmountRow
        testID="proposal-starts"
        label={t('terms.startsLabel')}
        value={formatDisplayDateWithYear(arrangement.valid_from)}
      />

      {proposal.note ? (
        <Body testID="proposal-note" className="text-foreground">
          {proposal.note}
        </Body>
      ) : null}

      {chain.length > 1 ? (
        <View className="gap-2" testID="proposal-history">
          <MetadataLabel>{t('proposal.historyHeading')}</MetadataLabel>
          {chain.map(round => (
            <View
              key={round.id}
              className="flex-row items-baseline justify-between gap-3"
            >
              <Small
                testID={`proposal-history-row-${round.id}`}
                className="flex-1 text-muted-foreground"
              >
                {proposalHistoryLabel(
                  round,
                  {
                    authorName:
                      round.proposed_by === viewerId
                        ? t('proposal.you')
                        : counterpartyName,
                    timezone,
                  },
                  t
                )}
              </Small>
              <Small
                testID={`proposal-history-rate-${round.id}`}
                className="text-muted-foreground"
                tabular
              >
                {formatMoney(
                  round.terms.rate_minor,
                  round.terms.currency ?? arrangement.currency
                )}
              </Small>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
