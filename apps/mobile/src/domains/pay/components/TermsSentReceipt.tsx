/**
 * @module domains/pay/components/TermsSentReceipt
 *
 * What happened when you tapped Send. A PERSISTENT CARD, NOT A TOAST
 * (`screens-today.md` Table B puts this at receipt tier: "a persistent
 * positive-toned card, not a toast that vanishes") — it replaces the
 * `changeSheet.savedToast` / `setup.savedToast` pair, which announced a save
 * that no longer happens: terms are now a round the other side must accept.
 *
 * IT IS LOAD-BEARING, not a nicety. The owner chose a named button plus a
 * receipt over a pre-send confirmation dialog, and the reason is in the copy:
 * a dialog shown BEFORE the tap cannot say "she needs to agree before she can
 * clock in", because at that moment it has not happened. The receipt can, and
 * it is still on screen when she rings to ask.
 *
 * Nothing here is local state. It renders off the open `terms_proposals` row,
 * so it survives a navigation, a cold start, and the other party's device —
 * which is what "persistent" has to mean on a record two people rely on.
 *
 * `viewed_at` is the seen line, and it is a fact the server already stamps on
 * the review screen's first mount with data. "Not opened yet" is the honest
 * negative: the app knows whether the screen was opened, and says only that.
 *
 * WP-G ADDS THE NUDGE, AND IT IS ON BOTH RECEIPTS. This card is the AUTHOR's
 * own side of the negotiation whoever authored it — the parent's in
 * `PayArrangementScreen`/`PaySetupScreen`, the nanny's in `MyPayScreen` —
 * and the person waiting is the person who may ask. The 48-hour limit is the
 * server's (`termsProposalCommandService.remind`); this component only
 * renders one of three states, and the "too soon" one goes INLINE, because a
 * toast that vanishes is the wrong shape for "come back on Thursday".
 */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, Small } from '@/src/components/ui/typography';
import { localDateInZone } from '@/src/lib/localDate';
import { formatRate } from '@/src/lib/money';
import { formatShortDate } from '../utils/payArrangementForm';

interface TermsSentReceiptProps {
  /** The open round this is the receipt for. */
  proposal: TermsProposal;
  /** Who has to answer it — named, because a receipt with no addressee is a
   * toast with a border. */
  counterpartyName: string;
  householdTimezone: string;
  /** Which side is reading. Decides ONLY the consequence sentence: the
   * parent's clock is not the one that opens. */
  viewer: 'parent' | 'carer';
  onWithdraw: () => void;
  isWithdrawing: boolean;
  /** WP-G — send the counterparty a reminder about this round. */
  onRemind: () => void;
  /** When one was last sent from this screen, or null while none has been. */
  remindedAt: string | null;
  /** The last attempt was refused by the 48-hour rule (`isRemindTooSoon`). */
  remindTooSoon: boolean;
  testID?: string;
}

export function TermsSentReceipt({
  proposal,
  counterpartyName,
  householdTimezone,
  viewer,
  onWithdraw,
  isWithdrawing,
  onRemind,
  remindedAt,
  remindTooSoon,
  testID = 'pay-terms-receipt',
}: TermsSentReceiptProps) {
  const { t } = useTranslation('pay');

  const sentDate = formatShortDate(
    localDateInZone(householdTimezone, new Date(proposal.created_at))
  );
  const viewedDate = proposal.viewed_at
    ? formatShortDate(
        localDateInZone(householdTimezone, new Date(proposal.viewed_at))
      )
    : null;

  // Carried off the proposal's own terms, never recomputed — a receipt that
  // disagreed with what was sent is worse than no receipt (docs/11-MONEY.md
  // §1: the display conversion lives in exactly one util).
  const rate = formatRate(
    proposal.terms.rate_minor,
    proposal.terms.currency ?? 'USD'
  );

  // Literal `t()` per branch, never a ternary INSIDE `t(...)` — the second
  // key is invisible to the locale-key guard that way.
  const consequence =
    viewer === 'parent'
      ? t('receipt.mustAgreeParent', { name: counterpartyName })
      : t('receipt.mustAgreeCarer', { name: counterpartyName });
  const seenLine = viewedDate
    ? t('receipt.seenBy', { name: counterpartyName, date: viewedDate })
    : t('receipt.notOpened');

  return (
    <Card testID={testID}>
      <CardContent className="gap-2">
        <Body testID={`${testID}-title`} weight="medium">
          {t('receipt.sentTo', { name: counterpartyName, date: sentDate })}
        </Body>
        <Body testID={`${testID}-terms`} className="text-muted-strong">
          {t('receipt.terms', {
            rate,
            date: formatShortDate(proposal.terms.valid_from),
          })}
        </Body>
        <Body testID={`${testID}-consequence`} className="text-muted-strong">
          {consequence}
        </Body>
        <Small testID={`${testID}-seen`} className="text-muted-foreground">
          {seenLine}
        </Small>
        {remindedAt ? (
          <Small
            testID={`${testID}-reminded`}
            className="text-muted-foreground"
          >
            {t('receipt.reminded', {
              date: formatShortDate(
                localDateInZone(householdTimezone, new Date(remindedAt))
              ),
            })}
          </Small>
        ) : null}
        {!remindedAt && remindTooSoon ? (
          <Small
            testID={`${testID}-remind-too-soon`}
            className="text-muted-foreground"
          >
            {t('receipt.remindTooSoon')}
          </Small>
        ) : null}
        {/* Two ghost actions, both plain-left: "ask again" and "take it back",
            in the order a person actually reaches for them. */}
        <View className="flex-row gap-5">
          {remindedAt ? null : (
            <Button
              testID={`${testID}-remind`}
              variant="ghost"
              className="self-start px-0"
              onPress={onRemind}
            >
              <Text>{t('receipt.remind')}</Text>
            </Button>
          )}
          <Button
            testID={`${testID}-withdraw`}
            variant="ghost"
            className="self-start px-0"
            disabled={isWithdrawing}
            onPress={onWithdraw}
          >
            <Text>{t('proposal.withdrawButton')}</Text>
          </Button>
        </View>
      </CardContent>
    </Card>
  );
}
