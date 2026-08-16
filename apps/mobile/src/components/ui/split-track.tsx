/**
 * @module SplitTrack
 *
 * A single horizontal bar split into proportional segments. Colours are
 * caller-supplied — this component chooses no semantic hue of its own.
 * A zero total is absence, not an empty track.
 */

import { View } from 'react-native';

interface SplitTrackSegment {
  value: number;
  colour: string;
  testID?: string;
}

interface SplitTrackProps {
  segments: SplitTrackSegment[];
  testID?: string;
}

export function SplitTrack({ segments, testID }: SplitTrackProps) {
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.value),
    0
  );
  if (total <= 0) {
    return null;
  }

  return (
    <View testID={testID} className="h-2 flex-row overflow-hidden rounded-chip">
      {segments.map((segment, index) => (
        <View
          key={segment.testID ?? String(index)}
          testID={segment.testID}
          style={{
            flex: Math.max(0, segment.value),
            backgroundColor: segment.colour,
          }}
        />
      ))}
    </View>
  );
}

export type { SplitTrackProps, SplitTrackSegment };
