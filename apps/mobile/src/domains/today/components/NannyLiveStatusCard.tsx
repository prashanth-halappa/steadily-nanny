/**
 * @module domains/today/components/NannyLiveStatusCard
 *
 * Parent Today — "Today's cover": who is with my children today, ONE ROW PER
 * CARER. It used to pick a single winner state and name one carer, so the
 * second carer of a two-carer day was simply not mentioned; worse, the winning
 * row's name sat next to a duration the parent could not attribute. Rows are
 * derived per carer, sorted live -> finished -> arriving -> scheduled, and each
 * duration covers that carer's entries alone. Tapping opens Hours.
 *
 * Row derivation lives in `useTodayCoverRows` (Wave 2-D) so `TodayCalmCard`
 * can ask "is there cover today" from the same cached queries without a
 * second bucket/sort implementation.
 */
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Card } from '@/src/components/ui/card';
import { LiveDot } from '@/src/components/ui/live-dot';
import { H4, MetadataLabel, Small } from '@/src/components/ui/typography';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';
import { type CoverKind, useTodayCoverRows } from '../hooks/useTodayCoverRows';

interface NannyLiveStatusCardProps {
  householdId: string;
  timeZone: string;
}

export function NannyLiveStatusCard({
  householdId,
  timeZone,
}: NannyLiveStatusCardProps) {
  const { t } = useTranslation('today');
  const router = useRouter();
  const colors = useThemeColors();
  const { rows } = useTodayCoverRows(householdId, timeZone);

  const anyLive = rows.some(row => row.kind === 'live');
  const isEmpty = rows.length === 0;

  /** `live` dots are the protected apricot `LiveDot` (GOLDEN-FIXES vocabulary,
   * left untouched); the other three kinds get a plain 8px dot in the state's
   * own hue. */
  const dotColorFor = (kind: CoverKind): string =>
    kind === 'finished'
      ? colors.success
      : kind === 'arriving'
        ? colors.warning
        : colors.borderStrong;

  return (
    <Pressable
      testID="today-nanny-live-status"
      accessibilityRole="button"
      onPress={() => router.push('/(private)/(tabs)/hours' as Href)}
    >
      <Card
        testID="today-nanny-live-status-card"
        tone={anyLive ? 'live' : 'default'}
        // Nothing is happening, so nothing should lift — no elevation.
        className={isEmpty ? 'gap-3 bg-muted p-5.5' : 'gap-3 p-5.5'}
        style={isEmpty ? { boxShadow: [] } : undefined}
      >
        <MetadataLabel className="text-muted-foreground">
          {t('todayCoverTitle')}
        </MetadataLabel>
        {isEmpty ? (
          <View className="gap-0.5">
            <H4>{t('nannyNoShiftTitle')}</H4>
            <Small className="text-muted-foreground">
              {t('nannyNoShiftBody')}
            </Small>
          </View>
        ) : (
          rows.map(row => (
            <View
              key={row.key}
              testID={`today-cover-row-${row.key}`}
              className="gap-0.5"
            >
              <View className="flex-row items-center gap-2">
                {row.kind === 'live' ? (
                  <LiveDot testID={`today-cover-live-dot-${row.key}`} />
                ) : (
                  <View
                    testID={`today-cover-dot-${row.key}`}
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: dotColorFor(row.kind) }}
                  />
                )}
                <H4 numberOfLines={1}>{row.name}</H4>
              </View>
              <Small className="text-muted-foreground">{row.detail}</Small>
            </View>
          ))
        )}
      </Card>
    </Pressable>
  );
}
