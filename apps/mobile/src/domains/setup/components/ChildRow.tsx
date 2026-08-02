/**
 * @module domains/setup/components/ChildRow
 *
 * One row in the children list: a `ChildChip` (name + colour dot) plus the
 * derived age, tappable to edit, with a separate remove affordance.
 */
import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Card } from '@/src/components/ui/card';
import { ChildChip } from '@/src/components/ui/child-chip';
import { Body } from '@/src/components/ui/typography';
import { ageFromBirthDate } from '@/src/domains/setup/childAge';

interface ChildRowProps {
  name: string;
  colour?: string | null;
  birthDate: string | null;
  onPress: () => void;
  onRemove: () => void;
  testID: string;
}

export function ChildRow({
  name,
  colour,
  birthDate,
  onPress,
  onRemove,
  testID,
}: ChildRowProps) {
  const { t } = useTranslation('household');
  const age = ageFromBirthDate(birthDate);

  return (
    <Card testID={testID} className="flex-row items-center gap-3 p-3">
      <Pressable
        testID={`${testID}-edit`}
        accessibilityRole="button"
        onPress={onPress}
        className="flex-1 flex-row items-center gap-3"
      >
        <ChildChip name={name} colour={colour ?? undefined} />
        <Body className="text-muted-foreground">
          {age === null
            ? t('children.ageUnknown')
            : t('children.ageYears', { count: age })}
        </Body>
      </Pressable>
      <Pressable
        testID={`${testID}-remove`}
        accessibilityRole="button"
        accessibilityLabel={t('children.removeLabel', { name })}
        onPress={onRemove}
        hitSlop={8}
      >
        <View className="h-8 w-8 items-center justify-center rounded-full bg-muted">
          <Icon icon={X} className="text-muted-foreground" size="sm" />
        </View>
      </Pressable>
    </Card>
  );
}
