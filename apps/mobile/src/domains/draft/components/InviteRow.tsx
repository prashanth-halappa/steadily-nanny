/**
 * @module domains/draft/components/InviteRow
 *
 * One "Sent to" row (§5.2/§5.3): her private label for the family, one filled
 * pill for where the invite has got to, a sub-line that keeps every date, and
 * a 44pt `⋯` opening the per-row menu.
 *
 * THE MENU IS LOAD-BEARING, NOT A CONVENIENCE. §6.2's argument for putting
 * her rate on a public web page rests on three conditions (D-51): she chose
 * the recipient, the link is short-lived, and she can turn THIS ONE off.
 * Strip the row control and the only revoke left is Archive, which kills
 * every link at once — at which point the honest version of the argument
 * becomes "she can withdraw from all her interviews simultaneously". Do not
 * cut it.
 *
 * The pill uses `cancelled` for revoked/expired. `status-pill.tsx` has six
 * variants and none is named `neutral` — `cancelled` IS the neutral
 * treatment, and this screen adds no seventh (§16 item 8).
 */
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { MoreHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { BottomSheetBase } from '@/src/components/custom/BottomSheetBase';
import { Button } from '@/src/components/ui/button';
import { InlineError } from '@/src/components/ui/inline-error';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { Body, H3, Small } from '@/src/components/ui/typography';
import { formatDateShort } from '@/src/utils/dateFormatting';
import { useElevation } from '~/lib/design-tokens/elevation';
import { buildInviteTimeline, resolveInviteState } from '../utils/inviteState';

/** Closed, the menu, or the revoke confirmation. Never two at once — a second
 * open sheet would fight `useBottomSheetStore` for `activeSheetId`. */
type OpenSheet = 'none' | 'menu' | 'confirmStop';

interface InviteRowProps {
  invite: HouseholdInvite;
  /** `terms_proposals.viewed_at` for the proposal this invite carried. */
  viewedAt: string | null;
  now: Date;
  onCopyCode: () => void;
  onShareAgain: () => void;
  onRevoke: () => void;
  isRevoking: boolean;
  isRevokeError: boolean;
}

export function InviteRow({
  invite,
  viewedAt,
  now,
  onCopyCode,
  onShareAgain,
  onRevoke,
  isRevoking,
  isRevokeError,
}: InviteRowProps) {
  const { t } = useTranslation('draft');
  const elevation = useElevation();
  const [open, setOpen] = useState<OpenSheet>('none');

  const state = resolveInviteState(invite, { viewedAt, now });
  const timeline = buildInviteTimeline(invite, { viewedAt })
    .map(entry =>
      t(`sentTo.timeline.${entry.key}`, { date: formatDateShort(entry.date) })
    )
    .join(' · ');
  const name = invite.label ?? t('sentTo.noLabel');
  // Nothing left to stop once it has been joined, revoked or run out.
  const canStop = state.variant === 'pending';

  return (
    <View
      testID={`draft-invite-row-${invite.id}`}
      className="gap-1 rounded-row bg-card px-4 py-3"
      style={elevation.row}
    >
      <View className="flex-row items-center gap-3">
        <Body testID="draft-invite-name" className="flex-1" weight="medium">
          {name}
        </Body>
        <StatusPill
          testID="draft-invite-pill"
          variant={state.variant}
          label={t(`sentTo.state.${state.word}`)}
        />
        <Pressable
          testID="draft-invite-more"
          accessibilityRole="button"
          accessibilityLabel={t('sentTo.moreOptions', { name })}
          onPress={() => setOpen('menu')}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center"
        >
          <Icon
            icon={MoreHorizontal}
            size={20}
            className="text-muted-foreground"
          />
        </Pressable>
      </View>
      <Small testID="draft-invite-timeline" className="text-muted-foreground">
        {timeline}
      </Small>

      <BottomSheetBase
        sheetId={`draft-invite-menu-${invite.id}`}
        visible={open === 'menu'}
        onDismiss={() => setOpen('none')}
        testID="draft-invite-menu-sheet"
        fitContent
        showCloseButton
      >
        <View className="gap-2 px-6 pb-4">
          <Button
            testID="draft-invite-copy"
            variant="ghost"
            onPress={() => {
              setOpen('none');
              onCopyCode();
            }}
          >
            <Text>{t('rowMenu.copyCode')}</Text>
          </Button>
          <Button
            testID="draft-invite-share-again"
            variant="ghost"
            onPress={() => {
              setOpen('none');
              onShareAgain();
            }}
          >
            <Text>{t('rowMenu.shareAgain')}</Text>
          </Button>
          {canStop ? (
            <Button
              testID="draft-invite-stop"
              variant="ghost"
              onPress={() => setOpen('confirmStop')}
            >
              <Text className="text-destructive">{t('rowMenu.stopLink')}</Text>
            </Button>
          ) : null}
        </View>
      </BottomSheetBase>

      <BottomSheetBase
        sheetId={`draft-invite-stop-${invite.id}`}
        visible={open === 'confirmStop'}
        onDismiss={() => setOpen('none')}
        testID="draft-invite-stop-confirm-sheet"
        fitContent
        showCloseButton
      >
        <View className="gap-4 px-6 pb-4">
          <H3>{t('rowMenu.stopTitle')}</H3>
          <Body className="text-muted-strong">
            {t('rowMenu.stopBody', { name })}
          </Body>
          {/* GOLDEN-FIXES #40 — inline, never a toast behind the sheet. */}
          {isRevokeError ? (
            <InlineError
              testID="draft-invite-stop-error"
              message={t('rowMenu.stopFailed')}
            />
          ) : null}
          <Button
            testID="draft-invite-stop-confirm"
            variant="ghost"
            disabled={isRevoking}
            onPress={onRevoke}
          >
            <Text className="text-destructive">{t('rowMenu.stopConfirm')}</Text>
          </Button>
          <Button
            testID="draft-invite-stop-cancel"
            variant="ghost"
            onPress={() => setOpen('none')}
          >
            <Text>{t('rowMenu.stopCancel')}</Text>
          </Button>
        </View>
      </BottomSheetBase>
    </View>
  );
}
