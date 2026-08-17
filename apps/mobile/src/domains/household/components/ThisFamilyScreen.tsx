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
 */
import { type Href, useRouter } from 'expo-router';
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
import { SCREEN_CONTENT_STYLE } from '@/lib/design-tokens';
import { usePullToRefresh } from '@/lib/layout/usePullToRefresh';
import { BackButton } from '@/src/components/ui/back-button';
import { Button } from '@/src/components/ui/button';
import { Card } from '@/src/components/ui/card';
import { PersonAvatar } from '@/src/components/ui/person-avatar';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H3, Small } from '@/src/components/ui/typography';
import { resolveCarerName } from '@/src/domains/schedule/utils/memberDisplayName';
import { ageFromBirthDate } from '@/src/domains/setup/childAge';
import {
  formatTimeOffRangeLabel,
  isPastTimeOff,
} from '@/src/domains/timeOff/utils/timeOffDate';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useChildren } from '@/src/hooks/queries/useChildren';
import { useHouseholdClosures } from '@/src/hooks/queries/useHouseholdClosures';
import { useHouseholdMembers } from '@/src/hooks/queries/useHouseholdMembers';

function callNumber(phone: string) {
  void Linking.openURL(`tel:${phone}`);
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

  // ONLY owner/parent — see the privacy-rule comment above. Never widen this
  // to render a co-carer's row.
  const activeParents = (members.data ?? []).filter(
    m => m.status === 'active' && (m.role === 'owner' || m.role === 'parent')
  );

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

      <Pressable
        testID="this-family-terms-row"
        accessibilityRole="button"
        onPress={() => router.push('/settings/my-pay' as Href)}
        className="mt-6 flex-row items-center justify-between rounded-row border border-border bg-background px-4 py-3"
      >
        <Body>{t('thisFamily.termsRow')}</Body>
      </Pressable>

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
    </ScrollView>
  );
}
