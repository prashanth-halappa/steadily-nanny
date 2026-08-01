/**
 * @module domains/timesheet/components/WeekTotal
 * The week's total hours plus a plainly-stated overtime delta, e.g.
 * "9h 14m, +14 min" against what was scheduled.
 */
import { View } from 'react-native';
import { Card, CardContent } from '@/src/components/ui/card';
import { Body, H2, Small } from '@/src/components/ui/typography';

interface WeekTotalProps {
  totalLabel: string;
  overtimeLabel: string | null;
  weekRangeLabel: string;
  testID?: string;
}

export function WeekTotal({
  totalLabel,
  overtimeLabel,
  weekRangeLabel,
  testID,
}: WeekTotalProps) {
  return (
    <Card testID={testID} className="mb-4">
      <CardContent className="gap-1 p-6">
        <Small className="text-muted-foreground">{weekRangeLabel}</Small>
        <View className="flex-row items-baseline gap-2">
          <H2 testID="hours-total">{totalLabel}</H2>
          {overtimeLabel ? (
            <Body className="text-muted-foreground">{overtimeLabel}</Body>
          ) : null}
        </View>
      </CardContent>
    </Card>
  );
}
