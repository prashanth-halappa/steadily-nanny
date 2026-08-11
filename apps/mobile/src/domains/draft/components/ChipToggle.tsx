/**
 * @module domains/draft/components/ChipToggle
 *
 * A two-option filled-pill picker (`daylight-v2.md` §6.3). Local to this
 * domain on purpose: the share sheet is the only surface that needs one, and
 * a general n-option toggle with variants and sizes would be a component
 * built for a second caller that does not exist. Promote it to
 * `components/ui/` the day one does.
 */
import { Pressable, View } from 'react-native';
import { cn } from '@/lib/utils';
import { Text } from '@/src/components/ui/text';

export interface ChipToggleOption<T extends string | number> {
  value: T;
  label: string;
  testID?: string;
}

interface ChipToggleProps<T extends string | number> {
  options: readonly ChipToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}

export function ChipToggle<T extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: ChipToggleProps<T>) {
  return (
    <View className="flex-row gap-2" accessibilityLabel={accessibilityLabel}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            testID={option.testID}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            className={cn(
              'rounded-chip px-4 py-2',
              selected ? 'bg-primary' : 'bg-secondary'
            )}
          >
            <Text
              className={cn(
                'font-semibold text-sm',
                selected ? 'text-primary-foreground' : 'text-muted-strong'
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
