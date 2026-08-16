/**
 * @module NowLine
 *
 * Static "you are here" marker for a day list: a dot, a hairline rule,
 * and a small tabular label. No timer, no ticking clock.
 */

import { StyleSheet, View } from 'react-native';
import { useThemeColors } from '@/lib/design-tokens/useThemeColors';
import { Small } from '@/src/components/ui/typography';

const DOT_SIZE = 8;
const DEFAULT_TEST_ID = 'now-line';

interface NowLineProps {
  label: string;
  testID?: string;
}

export function NowLine({ label, testID }: NowLineProps) {
  const colors = useThemeColors();
  const baseTestID = testID ?? DEFAULT_TEST_ID;

  return (
    <View testID={baseTestID} className="flex-row items-center gap-2">
      <View
        testID={`${baseTestID}-dot`}
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: colors.primary,
        }}
      />
      <View
        testID={`${baseTestID}-rule`}
        className="flex-1"
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
        }}
      />
      <Small tabular>{label}</Small>
    </View>
  );
}

export type { NowLineProps };
