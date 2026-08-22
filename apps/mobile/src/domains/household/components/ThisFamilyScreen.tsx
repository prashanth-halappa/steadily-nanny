/**
 * @module domains/household/components/ThisFamilyScreen
 *
 * Direction §4 — the nanny's map of where she works. Settings -> "This
 * family" (nanny/helper only), and the Today household-name line routes
 * here too.
 *
 * SECTION ORDER IS THE ARGUMENT — do not reorder it: name + address, then
 * "If something happens" (the parents, then the emergency contact) ABOVE
 * the children, then terms, then days off. It exists for one bad afternoon,
 * and on that afternoon nobody scrolls.
 *
 * PRIVACY RULE, load-bearing: `useHouseholdMembers` returns EVERY member of
 * the household (candidates included — the terms-proposal inbox needs
 * that), so this screen must filter to `owner`/`parent` roles itself before
 * rendering a single row. Nothing about the family's other carers, past or
 * present, is ever read off `members.data` here.
 *
 * No clipboard module is in this app (see `ShareTermsSheet`'s precedent) —
 * "tap to copy" the address hands it to the OS share sheet, whose first
 * action IS Copy.
 *
 * LEAVING sits LAST, outside every Card and under no heading. The section
 * order above is written for one bad afternoon; leaving is not that
 * afternoon, and a heading would put "Leaving" into the screen's outline
 * where a person scanning for a phone number has to read past it. Until now
 * the only "Leave household" button in the app lived on
 * `ManageHouseholdScreen`, which is parent-only — so the member the action
 * exists for could not reach it.
 */
import type { Household } from '@steadily-nanny/shared-types/schemas/household.schema';
import {
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Share,
  View,
} from 'react-native';
import { illustrations } from '@/assets/illustrations';
import { SCREEN_CONTENT_STYLE, spacing } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { RestrictedActionButton } from '@/src/components/custom/RestrictedActionButton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { BackButton } from '@/src/components/ui/back-button';
import { Button, buttonVariants } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H3, Small } from '@/src/components/ui/typography';
import { HouseholdSwitcher } from '@/src/domains/household/components/HouseholdSwitcher';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { ageFromBirthDate } from '@/src/domains/setup/childAge';
import {
  formatTimeOffRangeLabel,
  isPastTimeOff,
} from '@/src/domains/timeOff/utils/timeOffDate';
import { useLeaveHousehold } from '@/src/hooks/mutations/useLeaveHousehold';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdClosures } from '@/src/hooks/queries/useHouseholdClosures';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';
import { useRunningTimeEntry } from '@/src/hooks/queries/useRunningTimeEntry';
import { showSuccessToast } from '@/src/lib/toast';
import { useAuthStore } from '@/src/store/auth';

function callNumber(phone: string) {
  void Linking.openURL(`tel:${phone}`);
}

/**
 * The leave action and its confirm, in their OWN component so the two hooks
 * they need (`useRunningTimeEntry`, `useLeaveHousehold`) only run for the
 * member who is actually offered the door — same reasoning as
 * `PaySetupPromptCard`. The parent gates on `canLeave` below, so an owner, a
 * candidate or a removed member never mounts either one.
 */
function LeaveHouseholdAction({ household }: { household: Household }) {
  const { t } = useTranslation('household');
  const router = useRouter();
  const runningEntry = useRunningTimeEntry();
  const leaveHousehold = useLeaveHousehold();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const name = household.name ?? t('untitledDraft');

  // Scoped to THIS household, both times it matters: the server scopes its
  // 409 the same way, so a nanny clocked in at another family may still leave
  // this one — and naming family B's clock-in on family A's screen would tell
  // this family where else she works.
  const clockedInHere = runningEntry.data?.household_id === household.id;

  const handleConfirmLeave = async () => {
    setIsConfirmOpen(false);
    // `name` is resolved at render, above — which is both the capture the
    // toast needs (this household stops being the active one the moment the
    // mutation invalidates memberships) and the one that carries the
    // untitled-draft fallback. Re-reading `household.name` here would take
    // the raw column and interpolate a null into "You've left ".
    try {
      await leaveHousehold.mutateAsync(household.id);
    } catch {
      // useLeaveHousehold's onError already named the refusal (owner /
      // clocked in) in a toast, and staying on this screen is the honest
      // outcome — nothing changed.
      return;
    }
    showSuccessToast(t('householdSettings.leftToast', { name }));
    // Back through the ENTRY ROUTER rather than a guessed destination: after
    // leaving, "where does this user belong" depends on whether they have
    // another active household, a past-household-only history, or nothing at
    // all — and `app/index.tsx` is the one place that answers that, from the
    // memberships the mutation just invalidated. `replace`, not `push`: the
    // household settings screen for a household you are no longer in must
    // not be reachable with a back gesture.
    router.replace('/' as Href);
  };

  return (
    <View style={{ marginTop: spacing.xl }}>
      <RestrictedActionButton
        testID="this-family-leave-button"
        variant="outline"
        size="lg"
        destructive
        label={t('householdSettings.leaveButton', { name })}
        reason={
          clockedInHere
            ? t('householdSettings.leaveClockedInError', { name })
            : null
        }
        disabled={leaveHousehold.isPending}
        onPress={() => setIsConfirmOpen(true)}
      />
      {/* The hint and the restriction reason occupy the same slot — the
          button already renders the reason itself, and two sentences under
          one disabled button is one too many. */}
      {clockedInHere ? null : (
        <Small
          testID="this-family-leave-hint"
          className="mt-2 text-center text-muted-foreground"
        >
          {t('householdSettings.leaveHint')}
        </Small>
      )}

      {/* Controlled, no Trigger. AlertDialog and not BottomSheetBase because
          there is no text input here, so no keyboard to avoid. */}
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('householdSettings.leaveConfirmTitle', { name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('householdSettings.leaveConfirmBody', { name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* What actually changes, in the order she will feel it: the
              schedule stops, the record stays, the way back is not hers. */}
          <View className="gap-1" testID="this-family-leave-consequences">
            <Body className="text-muted-strong">
              {`• ${t('householdSettings.leaveConsequenceSchedule', { name })}`}
            </Body>
            <Body className="text-muted-strong">
              {`• ${t('householdSettings.leaveConsequenceRecord', { name })}`}
            </Body>
            <Body className="text-muted-strong">
              {`• ${t('householdSettings.leaveConsequenceReturn', { name })}`}
            </Body>
          </View>
          <Small className="text-muted-strong">
            {t('householdSettings.leaveConfirmMoney', { name })}
          </Small>
          <AlertDialogFooter>
            <AlertDialogCancel testID="this-family-leave-cancel">
              <Text>{t('householdSettings.leaveConfirmCancel')}</Text>
            </AlertDialogCancel>
            {/* `className` styles the BUTTON only; the label colour goes on
                the inner Text. A scoped `active:` on that Text would make
                css-interop attach press handlers to it, and the Text would
                win the touch responder — an inert confirm. See
                alert-dialog.tsx's own note. */}
            <AlertDialogAction
              testID="this-family-leave-confirm"
              className={buttonVariants({ variant: 'destructive' })}
              onPress={() => void handleConfirmLeave()}
            >
              <Text className="text-destructive-foreground">
                {t('householdSettings.leaveConfirmConfirm')}
              </Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

export function ThisFamilyScreen() {
  const { refreshControl } = usePullToRefresh();
  const { t } = useTranslation('household');
  const { t: tCommon } = useTranslation('common');
  const router = useRouter();
  const active = useActiveHousehold();
  const household = active.household;
  const members = useHouseholdMembers(active.householdId);
  const children = useChildren(active.householdId);
  const closures = useHouseholdClosures(active.householdId);
  const currentUserId = useAuthStore(s => s.session?.user?.id);

  // ONLY owner/parent — see the privacy-rule comment above. Never widen this
  // to render a co-carer's row.
  const activeParents = (members.data ?? []).filter(
    m => m.status === 'active' && (m.role === 'owner' || m.role === 'parent')
  );

  // The viewer's OWN row, from the same list the parent rows are built from —
  // never `useIsOnboarded().role`, which collapses owner and parent into one
  // `SetupRole`. Both conditions are doors that would otherwise never open:
  // a DRAFT-AUTHOR NANNY is her own household's `owner` and the server
  // refuses her with 403 CANNOT_LEAVE_AS_OWNER, and a `candidate` (redeemed a
  // code, terms not accepted yet) is invisible to `findActiveMembership`, so
  // her leave 404s. `active`, not merely non-removed, for that second reason.
  const ownMembership =
    (members.data ?? []).find(m => m.user_id === currentUserId) ?? null;
  const canLeave =
    ownMembership !== null &&
    ownMembership.status === HOUSEHOLD_MEMBER_STATUSES.ACTIVE &&
    ownMembership.role !== HOUSEHOLD_ROLES.OWNER;

  const upcomingClosures = (closures.data ?? []).filter(
    c => !isPastTimeOff(c.ends_at)
  );

  const hasEmergencyContact = !!household?.emergency_contact_name;

  return (
    <ScrollView
      testID="settings-this-family-screen"
      className="flex-1 bg-background"
      contentContainerStyle={SCREEN_CONTENT_STYLE}
      refreshControl={refreshControl}
    >
      <BackButton onPress={() => router.back()} label={tCommon('back')} />
      <View className="mt-1 flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <H1>{household?.name ?? t('untitledDraft')}</H1>
          <Pressable
            testID="this-family-address"
            accessibilityRole="button"
            disabled={!household?.address_line}
            onPress={() =>
              household?.address_line
                ? void Share.share({ message: household.address_line })
                : undefined
            }
            className="mt-1"
          >
            <Body className="text-muted-foreground">
              {household?.address_line ?? t('thisFamily.addressEmpty')}
            </Body>
          </Pressable>
        </View>
        <Image
          testID="this-family-art"
          accessibilityRole="image"
          source={illustrations.emptyHousehold}
          style={{ width: 80, height: 80 }}
          resizeMode="contain"
        />
      </View>

      {/* Self-hides at one selectable household, so a one-family nanny sees
          nothing new; a two-family nanny gets the chip that says which
          family this screen is about. */}
      <HouseholdSwitcher />

      <View testID="this-family-if-something-happens" className="mt-6 gap-2">
        <H3>{t('thisFamily.ifSomethingHappens')}</H3>
        <Card tone="default" className="overflow-hidden p-0">
          {activeParents.map(parent => (
            <View
              key={parent.id}
              testID={`this-family-parent-row-${parent.id}`}
              className="flex-row items-center justify-between gap-3 px-4 py-3"
            >
              <View className="flex-1 gap-0.5">
                <Body>
                  {resolveCarerName(parent, t(`settings:role.${parent.role}`))}
                </Body>
                <Small className="text-muted-foreground">
                  {t(`settings:role.${parent.role}`)}
                </Small>
              </View>
              {parent.profile_phone ? (
                <Button
                  testID={`this-family-call-parent-${parent.id}`}
                  variant="ghost"
                  onPress={() => callNumber(parent.profile_phone as string)}
                >
                  <Text>{t('thisFamily.callButton')}</Text>
                </Button>
              ) : null}
            </View>
          ))}
          {hasEmergencyContact ? (
            <View
              testID="this-family-emergency-contact"
              className="flex-row items-center justify-between gap-3 px-4 py-3"
            >
              <View className="flex-1 gap-0.5">
                <Body>{household?.emergency_contact_name}</Body>
                {household?.emergency_contact_relationship ? (
                  <Small className="text-muted-foreground">
                    {household.emergency_contact_relationship}
                  </Small>
                ) : null}
              </View>
              {household?.emergency_contact_phone ? (
                <Button
                  testID="this-family-call-emergency-contact"
                  variant="ghost"
                  onPress={() =>
                    callNumber(household.emergency_contact_phone as string)
                  }
                >
                  <Text>{t('thisFamily.callButton')}</Text>
                </Button>
              ) : null}
            </View>
          ) : null}
        </Card>
      </View>

      <View testID="this-family-children" className="mt-6 gap-2">
        <H3>{t('thisFamily.childrenTitle')}</H3>
        {(children.data ?? []).length === 0 ? (
          <Body className="text-muted-foreground">
            {t('thisFamily.childrenEmpty')}
          </Body>
        ) : (
          <Card tone="default" className="overflow-hidden p-0">
            {(children.data ?? []).map(child => {
              const age = ageFromBirthDate(child.birth_date);
              return (
                <View
                  key={child.id}
                  testID={`this-family-child-${child.id}`}
                  className="flex-row items-center gap-3 px-4 py-3"
                >
                  <PersonAvatar
                    name={child.avatar_initial ?? child.name}
                    colour={child.colour ?? undefined}
                    size="sm"
                  />
                  <Body className="flex-1">
                    {child.name}
                    {age !== null ? ` · ${age}` : ''}
                    {child.routine_notes ? ` · ${child.routine_notes}` : ''}
                  </Body>
                </View>
              );
            })}
          </Card>
        )}
      </View>

      <Card tone="default" className="mt-6 p-0">
        <Pressable
          testID="this-family-terms-row"
          accessibilityRole="button"
          onPress={() => router.push('/settings/my-pay' as Href)}
          className="flex-row items-center justify-between px-4 py-3"
        >
          <Body>{t('thisFamily.termsRow')}</Body>
        </Pressable>
      </Card>

      <View testID="this-family-days-off" className="mt-6 gap-2">
        <H3>{t('thisFamily.daysOffTitle')}</H3>
        {upcomingClosures.length === 0 ? (
          <Body className="text-muted-foreground">
            {t('thisFamily.daysOffEmpty')}
          </Body>
        ) : (
          <Card tone="default" className="overflow-hidden p-0">
            {upcomingClosures.map(closure => (
              <View
                key={closure.id}
                testID={`this-family-closure-${closure.id}`}
                className="gap-0.5 px-4 py-3"
              >
                <Body>
                  {formatTimeOffRangeLabel(
                    closure.starts_at,
                    closure.ends_at,
                    household?.timezone
                  )}
                </Body>
                {closure.message ? (
                  <Small className="text-muted-foreground">
                    {closure.message}
                  </Small>
                ) : null}
              </View>
            ))}
          </Card>
        )}
      </View>

      {household && canLeave ? (
        <LeaveHouseholdAction household={household} />
      ) : null}
    </ScrollView>
  );
}
