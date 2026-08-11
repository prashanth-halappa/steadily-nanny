/**
 * @module domains/pay/components/AcceptTermsSheet
 *
 * §7.3, the accept moment. This is the binding act, so it is a sheet with a
 * checkbox and not a one-tap button: the figure, the start date, one
 * checkbox, Agree, Cancel.
 *
 * `BottomSheetBase`, never a bare `<Modal>` (GOLDEN-FIXES #1).
 *
 * THE LIABILITY LINE IS TWO STRINGS, NOT ONE (D27). D-7's original wording
 * assumes the person tapping employs the nanny; in the proposal direction the
 * accepter can be either party, and telling a nanny that terms must be right
 * for "our family" is telling her it is not her contract.
 *
 * NO CLASSIFICATION BLOCK. §4.1.1 cut the duties question, so nothing was
 * chosen on anyone's behalf and there is nothing to disclose. No string here
 * — or anywhere in this flow — names a state (owner decision, §4.1.1).
 *
 * Failure renders INLINE (GOLDEN-FIXES #40) and the box stays checked, so a
 * retry after a dropped connection is one tap and not a re-read of the whole
 * contract. Offline the button is disabled outright: an acceptance is a
 * binding write and must never be queued optimistically (§12).
 */
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens';
import { Check } from '@/lib/icons/Check';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { LoadingButton } from '@/src/components/ui/loading-button';
import { Text } from '@/src/components/ui/text';
import { Body, Figure, H3, Small } from '@/src/components/ui/typography';
import { formatMoney } from '@/src/lib/money';
import { formatDisplayDateWithYear } from '../utils/payArrangementForm';

export interface AcceptTermsSheetProps {
  visible: boolean;
  proposal: TermsProposal;
  /** Which side is tapping Agree — the ONLY thing that differs between the
   * two directions, and it changes one string (D27). */
  accepterRole: 'parent' | 'carer';
  isSubmitting: boolean;
  isError: boolean;
  isOnline: boolean;
  onAgree: () => void;
  onDismiss: () => void;
}

export function AcceptTermsSheet({
  visible,
  proposal,
  accepterRole,
  isSubmitting,
  isError,
  isOnline,
  onAgree,
  onDismiss,
}: AcceptTermsSheetProps) {
  const { t } = useTranslation('pay');
  const colors = useThemeColors();
  // Deliberately NOT reset on `isError` — see the module doc.
  const [confirmed, setConfirmed] = useState(false);

  const currency = proposal.terms.currency ?? 'USD';
  const guaranteedMinutes = proposal.terms.guaranteed_minutes_per_week ?? null;
  const weeklyMinor = proposal.weekly_equivalent_minor;
  const startDate = formatDisplayDateWithYear(proposal.terms.valid_from);
  // Same rule as the review header: both halves of the weekly line or
  // neither. The start date always renders — it is the other half of what is
  // being agreed to.
  const summary =
    weeklyMinor !== null && guaranteedMinutes !== null
      ? t('proposal.accept.summary', {
          amount: formatMoney(weeklyMinor, currency),
          hours: guaranteedMinutes / 60,
          date: startDate,
        })
      : t('proposal.accept.summaryNoWeekly', { date: startDate });

  // Two SEPARATE literal `t()` calls, never `t(cond ? a : b)`: the locale-key
  // guard extracts the first string literal it finds inside `t(`, so a ternary
  // there hides the second key from it — and a key no test can see is a key
  // that silently stops resolving in Spanish.
  const responsibilityLabel =
    accepterRole === 'carer'
      ? t('proposal.accept.responsibilityCarer')
      : t('proposal.accept.responsibilityParent');

  const canAgree = confirmed && isOnline;

  return (
    <BottomSheetBase
      sheetId={`proposal-accept-${proposal.id}`}
      visible={visible}
      onDismiss={onDismiss}
      testID="proposal-accept-sheet"
      fitContent
    >
      <View className="gap-4 px-6 pb-4">
        <H3>{t('proposal.accept.title')}</H3>

        <View className="flex-row items-baseline gap-1">
          <Figure testID="proposal-accept-figure" tabular>
            {formatMoney(proposal.terms.rate_minor, currency)}
          </Figure>
          <Body className="text-muted-strong">{t('perHour')}</Body>
        </View>
        <Body testID="proposal-accept-summary" className="text-muted-strong">
          {summary}
        </Body>

        {/* A plain Pressable rather than `components/ui/checkbox`, for the same
            reason `PayTermsGroups`' preset sheet uses one: @rn-primitives ships
            JSX-preserved source bun:test's loader cannot parse. The 44pt row
            target and accessibilityRole are unchanged. */}
        <Pressable
          testID="proposal-accept-checkbox"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmed }}
          accessibilityLabel={responsibilityLabel}
          onPress={() => setConfirmed(value => !value)}
          className="min-h-11 flex-row items-center gap-3"
        >
          <View
            className="h-5 w-5 items-center justify-center rounded border-1.5"
            style={{
              borderColor: confirmed ? colors.primary : colors.borderStrong,
              backgroundColor: confirmed ? colors.primary : 'transparent',
            }}
          >
            {confirmed ? (
              <Check size={14} className="text-primary-foreground" />
            ) : null}
          </View>
          <Body
            testID="proposal-accept-checkbox-label"
            className="flex-1 text-foreground"
          >
            {responsibilityLabel}
          </Body>
        </Pressable>

        {/* T16's promise, in T16's words — one key, both surfaces, so it reads
            as the same rule and not as a second policy. */}
        <Small
          testID="proposal-accept-append-only"
          className="text-muted-foreground"
        >
          {t('appendOnlyNote')}
        </Small>

        {!isOnline ? (
          <Small testID="proposal-accept-offline" className="text-muted-strong">
            {t('proposal.accept.offline')}
          </Small>
        ) : null}
        {isError ? (
          <InlineError
            testID="proposal-accept-error"
            message={t('proposal.accept.failed')}
          />
        ) : null}

        <LoadingButton
          testID="proposal-accept-confirm"
          size="lg"
          label={t('proposal.accept.confirm')}
          isLoading={isSubmitting}
          disabled={!canAgree}
          onPress={() => {
            if (!canAgree) return;
            onAgree();
          }}
        />
        <Button
          testID="proposal-accept-cancel"
          variant="ghost"
          onPress={onDismiss}
        >
          <Text className="text-foreground">{t('proposal.accept.cancel')}</Text>
        </Button>
      </View>
    </BottomSheetBase>
  );
}
