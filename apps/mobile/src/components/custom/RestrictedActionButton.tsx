/**
 * @module components/custom/RestrictedActionButton
 *
 * The ONE presentational treatment for S4's restricted state
 * (`docs/design/attention-and-notifications.md` §7): a button that stays
 * visible and disabled, with the reason — naming the person who CAN act —
 * beneath it.
 *
 * ```
 * Button size="lg" disabled          "Approve the week"
 * Small  mutedForeground centered    "Only David can approve hours in this household."
 * ```
 *
 * Never hidden: a missing button is indistinguishable from a bug, and the
 * person needs to know the capability exists and sits with someone else. The
 * button keeps its full 44pt target (`size` defaults to `lg`) and stays a
 * focusable, announced control with the reason as its `accessibilityHint` —
 * a disabled control a screen reader skips teaches nobody anything.
 *
 * `reason` comes from `useRestrictedAction`; `null` means unrestricted, in
 * which case this renders an ordinary button and nothing else.
 */
import { View } from 'react-native';
import { Button, type ButtonProps } from '@/src/components/ui/button';
import { Text } from '@/src/components/ui/text';
import { Small } from '@/src/components/ui/typography';

export interface RestrictedActionButtonProps {
  testID: string;
  label: string;
  /** The restriction sentence, or null when the action is allowed. */
  reason: string | null;
  onPress: () => void;
  /** The button's OWN disabled state (a mutation in flight), independent of `reason`. */
  disabled?: boolean;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  /** Render the label in the destructive colour (a cancel/decline action). */
  destructive?: boolean;
  className?: string;
}

export function RestrictedActionButton({
  testID,
  label,
  reason,
  onPress,
  disabled = false,
  variant,
  size = 'lg',
  destructive = false,
  className,
}: RestrictedActionButtonProps) {
  const restricted = reason !== null;

  return (
    <View className={className}>
      <Button
        testID={testID}
        variant={variant}
        size={size}
        disabled={disabled || restricted}
        accessibilityHint={reason ?? undefined}
        onPress={onPress}
      >
        <Text className={destructive ? 'text-error-inline-text' : undefined}>
          {label}
        </Text>
      </Button>
      {restricted ? (
        <Small
          testID={`${testID}-reason`}
          className="mt-2 text-center text-muted-foreground"
        >
          {reason}
        </Small>
      ) : null}
    </View>
  );
}
