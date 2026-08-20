/**
 * Daylight inline error — the authored errorInline* tokens, finally consumed.
 * Prefer this over a bare `<Small className="text-destructive">` for auth and
 * form failures so the message reads as consequential rather than captions.
 */
import type { ViewProps } from 'react-native';
import { View } from 'react-native';
import { Small } from '@/src/components/ui/typography';
import { useThemeColors } from '~/lib/design-tokens/useThemeColors';

interface InlineErrorProps extends Pick<ViewProps, 'testID' | 'style'> {
  message: string;
}

function InlineError({ message, testID, style }: InlineErrorProps) {
  const colors = useThemeColors();
  if (!message) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      className="rounded-cell px-3 py-2"
      style={[
        {
          backgroundColor: colors.errorInline.bg,
          borderColor: colors.errorInline.border,
          borderWidth: 1,
        },
        style,
      ]}
    >
      <Small style={{ color: colors.errorInline.text }}>{message}</Small>
    </View>
  );
}

export type { InlineErrorProps };
export { InlineError };
