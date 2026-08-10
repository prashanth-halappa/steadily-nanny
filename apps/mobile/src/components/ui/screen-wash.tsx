/**
 * Full-screen brand or live wash — plum or apricot gradient behind scroll content.
 * Colour stops come from `screenWash()` in `elevation.ts`; keep inline-styled
 * (not `className`) so the gradient stays on the sanctioned inline-style path.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';
import { type ScreenWashKind, screenWash } from '@/lib/design-tokens';
import { useColorScheme } from '@/lib/useColorScheme';

type ScreenWashProps = {
  kind: ScreenWashKind;
  testID?: string;
};

function ScreenWash({ kind, testID = 'screen-wash' }: ScreenWashProps) {
  const { isDarkColorScheme } = useColorScheme();
  const wash = screenWash(isDarkColorScheme, kind);

  return (
    <LinearGradient
      pointerEvents="none"
      testID={testID}
      style={StyleSheet.absoluteFill}
      colors={wash.colors}
      locations={wash.locations}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
    />
  );
}

export type { ScreenWashProps };
export { ScreenWash };
