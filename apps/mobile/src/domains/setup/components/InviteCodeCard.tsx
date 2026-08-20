/**
 * @module domains/setup/components/InviteCodeCard
 *
 * Presentational invite-code display (code box + error/retry), extracted
 * out of `InviteScreen` so both the wizard and the settings entry point
 * (`ManageInviteScreen`) render identical UI. Deliberately holds no mutation
 * state of its own — both callers wait for an explicit "Generate" tap (see
 * InviteScreen's header for why the wizard no longer auto-fires on mount),
 * so the minted invite plus `isError`/`onRetry` are passed in.
 *
 * D6a: takes the whole invite row, not just its code. The role picker is gone
 * by the time this renders, so two codes generated back to back (nanny, then
 * co-parent) were indistinguishable — the card states which role it grants
 * and when it expires, both already on the wire.
 *
 * D3: `onRevoke` is optional and presentational-only, same as `onRetry` — the
 * caller owns `useRevokeInvite` and decides what happens on success (clear
 * the invite it's holding). Rendered only once a code exists; there is
 * nothing to revoke while one is still minting.
 *
 * The attached pay offer (when present) is already on the invite row. This
 * card renders it via `InviteOfferSummary` so a parent who comes back to
 * the code later can still read the terms. Currency is passed in — the
 * card stays presentational and does not call `useActiveHousehold`.
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { LoadingIndicator } from '@/src/components/ui/loading-indicator';
import { Text } from '@/src/components/ui/text';
import { Body, Display } from '@/src/components/ui/typography';
import { formatDisplayDateWithYear } from '@/src/domains/pay/utils/payArrangementForm';
import { getDeviceCurrency } from '@/src/lib/deviceLocale';
import { formatRate } from '@/src/lib/money';
import { formatDateShort } from '@/src/utils/dateFormatting';
import { InviteOfferSummary } from './InviteOfferSummary';

interface InviteCodeCardProps {
  invite: HouseholdInvite | null;
  isError: boolean;
  onRetry: () => void;
  onRevoke?: () => void;
  isRevoking?: boolean;
  currency?: string;
}

export function InviteCodeCard({
  invite,
  isError,
  onRetry,
  onRevoke,
  isRevoking,
  currency,
}: InviteCodeCardProps) {
  const { t } = useTranslation('household');
  const payOffer = invite?.pay_offer;

  return (
    <Card className="items-center gap-4 p-5.5">
      {invite ? (
        <>
          <View className="items-center gap-1">
            <Display
              testID="invite-code-value"
              selectable
              className="text-primary"
              style={{ letterSpacing: 3.2 }}
            >
              {invite.code}
            </Display>
            <Body testID="invite-code-meta" className="text-muted-foreground">
              {t('invite.codeMeta', {
                role: t(`invite.roles.${invite.role}.title`),
                date: formatDateShort(invite.expires_at),
              })}
            </Body>
          </View>
          {payOffer ? (
            <View className="w-full">
              <InviteOfferSummary
                rate={formatRate(
                  payOffer.rate_minor,
                  payOffer.currency ?? currency ?? getDeviceCurrency()
                )}
                startDate={formatDisplayDateWithYear(payOffer.valid_from)}
                cancellationPaidWithinHours={
                  payOffer.cancellation_paid_within_hours
                }
              />
            </View>
          ) : null}
        </>
      ) : (
        <LoadingIndicator />
      )}
      {invite && onRevoke ? (
        <Button
          testID="invite-revoke-button"
          variant="ghost"
          disabled={isRevoking}
          onPress={onRevoke}
        >
          <Text className="text-error-inline-text">
            {t('invite.revokeButton')}
          </Text>
        </Button>
      ) : null}
      {isError ? (
        <>
          <Body className="text-center text-error-inline-text">
            {t('invite.errorTitle')}
          </Body>
          <Button
            testID="invite-retry-button"
            variant="outline"
            onPress={onRetry}
          >
            <Text>{t('invite.retryButton')}</Text>
          </Button>
        </>
      ) : null}
    </Card>
  );
}
