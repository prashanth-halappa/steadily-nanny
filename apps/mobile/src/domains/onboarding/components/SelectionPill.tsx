import { AnimatedPressable } from '@/lib/animations';
import { cn } from '@/lib/utils';
import { Body } from '@/src/components/ui/typography';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** A selectable pill for single/multi-select onboarding questions. */
export function SelectionPill({ label, selected, onPress }: Props) {
  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Body
        className={cn(
          'rounded-full border px-4 py-2',
          selected
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-foreground'
        )}
      >
        {label}
      </Body>
    </AnimatedPressable>
  );
}
