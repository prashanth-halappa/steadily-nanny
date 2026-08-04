/**
 * @module domains/pay/components/BackRow
 *
 * The "< Back" affordance shared by every pay-domain screen state
 * (`PayArrangementScreen`'s not-available/main arms, `MyPayScreen`'s
 * loading/not-available/main arms — review finding 5). Extracted to one
 * place so the accessibility props sibling screens already set
 * (`PaySetupScreen.tsx:130-136`, `TimeOffScreen.tsx:83-89`) can't drift
 * between the pay domain's own screens (review finding 10):
 * `accessibilityRole="button"`, `accessibilityLabel`, `hitSlop`.
 */
import { Pressable } from 'react-native';
import { Body } from '@/src/components/ui/typography';

interface BackRowProps {
  onPress: () => void;
  label: string;
  testID?: string;
}

export function BackRow({ onPress, label, testID }: BackRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      className="self-start"
    >
      <Body className="text-primary">{`< ${label}`}</Body>
    </Pressable>
  );
}
