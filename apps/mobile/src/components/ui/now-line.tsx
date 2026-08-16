/**
 * Static "you are here" marker for agenda lists. Callers place it among
 * rows; this is not a ticking clock.
 *
 * @module components/ui/now-line
 */
import type { ViewProps } from 'react-native';
import { View } from 'react-native';

type NowLineProps = Pick<ViewProps, 'testID'>;

function NowLine({ testID }: NowLineProps) {
  return (
    <View
      testID={testID}
      accessible={false}
      className="mx-5.5 mb-2 flex-row items-center gap-2"
    >
      <View className="h-2.5 w-2.5 rounded-full bg-highlight" />
      <View className="h-px flex-1 bg-highlight" />
    </View>
  );
}

export type { NowLineProps };
export { NowLine };
