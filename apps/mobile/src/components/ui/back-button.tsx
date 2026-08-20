/**
 * @module components/ui/back-button
 *
 * The "< Back" affordance for every screen that needs a top-of-content back
 * affordance. Extracted so the accessibility props (`accessibilityRole`,
 * `accessibilityLabel`, `hitSlop`) and the chevron icon can't drift between
 * the ~15 sites that used to hand-roll a `< {label}` text-only `Pressable`.
 * `domains/pay/components/BackRow` wraps this component so its own 5 call
 * sites pick up the chevron without changing their imports.
 */
import { ChevronLeft } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { Icon } from '@/lib/icons/iconWithClassName';
import { Body } from '@/src/components/ui/typography';

interface BackButtonProps {
  onPress: () => void;
  label: string;
  testID?: string;
}

export function BackButton({ onPress, label, testID }: BackButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={12}
      className="-ml-2 h-11 flex-row items-center gap-1 self-start pl-2 pr-3"
    >
      <Icon icon={ChevronLeft} size={20} className="text-primary" />
      <Body className="text-primary">{label}</Body>
    </Pressable>
  );
}
