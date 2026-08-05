/**
 * Apricot live/on-the-clock indicator dot.
 * `highlight` is reserved for this state — colour is not configurable.
 */
import type { ViewProps } from 'react-native';
import { View } from 'react-native';

type LiveDotProps = Pick<ViewProps, 'testID'>;

function LiveDot({ testID }: LiveDotProps) {
  return (
    <View
      testID={testID}
      accessible={false}
      className="h-2.5 w-2.5 rounded-full bg-highlight"
    />
  );
}

export type { LiveDotProps };
export { LiveDot };
