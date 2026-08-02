/**
 * @module domains/schedule/components/CoverageLanesView
 *
 * Calendar view 2c — one lane per child from shift_children.
 */
import { FlashList } from '@shopify/flash-list';
import type { Child } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ChildChip } from '@/src/components/ui/child-chip';
import { Body, H3 } from '@/src/components/ui/typography';
import { formatShiftTime } from '@/src/domains/schedule/utils/shiftGrouping';

interface CoverageLanesViewProps {
  shifts: Shift[];
  householdChildren: Child[];
  displayTimeZone?: string | null;
}

interface LaneRow {
  key: string;
  childId: string;
  childName: string;
  colour?: string;
  segments: { shiftId: string; label: string }[];
}

function buildLanes(
  shifts: Shift[],
  children: Child[],
  displayTimeZone: string | null | undefined,
  labels: { allChildren: string; childFallback: string }
): LaneRow[] {
  const childMap = new Map(children.map(c => [c.id, c]));
  const byChild = new Map<string, LaneRow>();

  for (const shift of shifts) {
    const scList = shift.shift_children ?? [];
    if (scList.length === 0) {
      const key = 'all';
      const existing = byChild.get(key) ?? {
        key,
        childId: key,
        childName: labels.allChildren,
        segments: [],
      };
      existing.segments.push({
        shiftId: shift.id,
        label: `${shift.local_date} ${formatShiftTime(shift.starts_at, displayTimeZone)}–${formatShiftTime(shift.ends_at, displayTimeZone)}`,
      });
      byChild.set(key, existing);
      continue;
    }
    for (const sc of scList) {
      const child = childMap.get(sc.child_id);
      const name = child?.name ?? labels.childFallback;
      const existing = byChild.get(sc.child_id) ?? {
        key: sc.child_id,
        childId: sc.child_id,
        childName: name,
        colour: child?.colour ?? undefined,
        segments: [],
      };
      existing.segments.push({
        shiftId: shift.id,
        label: `${shift.local_date} ${formatShiftTime(shift.starts_at, displayTimeZone)}–${formatShiftTime(shift.ends_at, displayTimeZone)}`,
      });
      byChild.set(sc.child_id, existing);
    }
  }

  return [...byChild.values()].sort((a, b) =>
    a.childName.localeCompare(b.childName)
  );
}

export function CoverageLanesView({
  shifts,
  householdChildren,
  displayTimeZone,
}: CoverageLanesViewProps) {
  const { t } = useTranslation('schedule');
  const lanes = buildLanes(shifts, householdChildren, displayTimeZone, {
    allChildren: t('coverageLanes.allChildren'),
    childFallback: t('coverageLanes.childFallback'),
  });

  return (
    <View testID="calendar-coverage-lanes-view" style={{ flex: 1 }}>
      <FlashList
        testID="coverage-lanes-list"
        data={lanes}
        keyExtractor={item => item.key}
        renderItem={({ item }) => (
          <View
            testID={`coverage-lane-${item.childId}`}
            className="mx-4 mb-3 rounded-lg bg-muted p-3"
          >
            <View className="mb-2 flex-row items-center gap-2">
              {item.childId !== 'all' ? (
                <ChildChip
                  name={item.childName}
                  colour={item.colour}
                  testID={`coverage-lane-chip-${item.childId}`}
                />
              ) : (
                <H3 className="text-base">{item.childName}</H3>
              )}
            </View>
            {item.segments.map(seg => (
              <Body
                key={`${item.childId}-${seg.shiftId}`}
                testID={`coverage-segment-${item.childId}-${seg.shiftId}`}
                className="text-sm text-muted-foreground"
                tabular
              >
                {seg.label}
              </Body>
            ))}
          </View>
        )}
      />
    </View>
  );
}
