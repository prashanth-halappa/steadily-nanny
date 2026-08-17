import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from '@/src/components/ui/button';
import { ChildChip } from '@/src/components/ui/child-chip';
import { StatusPill } from '@/src/components/ui/status-pill';
import { Text } from '@/src/components/ui/text';
import { TimeRangePicker } from '@/src/components/ui/time-range-picker';
import { Body, Caption } from '@/src/components/ui/typography';
import {
  type AvailabilityRow,
  type DayBlock,
  hasOverlappingBlocks,
  isOutsideAvailability,
  timeToMinutes,
} from '../utils';

interface WeekBlocksEditorProps {
  displayOrder: number[];
  selectedDays: number[];
  dayBlocks: Record<number, DayBlock[]>;
  children: { id: string; name: string; colour?: string | null }[];
  availability: AvailabilityRow[] | undefined;
  onChange: (next: {
    selectedDays: number[];
    dayBlocks: Record<number, DayBlock[]>;
  }) => void;
  testIDPrefix?: string;
}

const MAX_SLOTS_PER_DAY = 3;

export function WeekBlocksEditor({
  displayOrder,
  selectedDays,
  dayBlocks,
  children,
  availability,
  onChange,
  testIDPrefix = 'schedule-build',
}: WeekBlocksEditorProps) {
  const { t } = useTranslation('schedule');

  const updateDayBlocks = (
    day: number,
    updater: (blocks: DayBlock[]) => DayBlock[]
  ) => {
    const currentBlocks = dayBlocks[day] || [];
    const newBlocks = updater(currentBlocks).sort(
      (a, b) => (timeToMinutes(a.start) ?? 0) - (timeToMinutes(b.start) ?? 0)
    );

    let newSelectedDays = [...selectedDays];
    if (newBlocks.length === 0) {
      newSelectedDays = newSelectedDays.filter(d => d !== day);
    } else if (!newSelectedDays.includes(day)) {
      newSelectedDays.push(day);
      newSelectedDays.sort((a, b) => a - b);
    }

    onChange({
      selectedDays: newSelectedDays,
      dayBlocks: {
        ...dayBlocks,
        [day]: newBlocks,
      },
    });
  };

  const handleAddSlot = (day: number) => {
    updateDayBlocks(day, blocks => {
      if (blocks.length === 0) {
        return [
          { start: '09:00', end: '17:00', children: children.map(c => c.id) },
        ];
      }

      const lastBlock = blocks[blocks.length - 1];
      if (!lastBlock) return blocks;

      let [hours, minutes] = lastBlock.end.split(':').map(Number);
      if (hours === undefined || minutes === undefined) return blocks;

      hours += 2;
      if (hours > 23) {
        hours = 23;
        minutes = 59;
      }

      const newStart = lastBlock.end;
      const newEnd = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

      return [
        ...blocks,
        { start: newStart, end: newEnd, children: [...lastBlock.children] },
      ];
    });
  };

  const handleRemoveSlot = (day: number, index: number) => {
    updateDayBlocks(day, blocks => blocks.filter((_, i) => i !== index));
  };

  const handleTimeChange = (
    day: number,
    index: number,
    start: string,
    end: string
  ) => {
    updateDayBlocks(day, blocks => {
      const newBlocks = [...blocks];
      const block = newBlocks[index];
      if (block) {
        newBlocks[index] = { ...block, start, end };
      }
      return newBlocks;
    });
  };

  const toggleChild = (day: number, index: number, childId: string) => {
    updateDayBlocks(day, blocks => {
      const newBlocks = [...blocks];
      const block = newBlocks[index];
      if (block) {
        const hasChild = block.children.includes(childId);
        newBlocks[index] = {
          ...block,
          children: hasChild
            ? block.children.filter(id => id !== childId)
            : [...block.children, childId],
        };
      }
      return newBlocks;
    });
  };

  return (
    <View className="gap-8">
      {displayOrder.map(day => {
        const blocks = dayBlocks[day] || [];
        const isDayOff = blocks.length === 0;
        const isOverlapping = hasOverlappingBlocks(blocks);

        return (
          <View key={day} className="gap-3">
            <Body weight="medium">{t(`weekday.${day}`)}</Body>
            {isDayOff ? (
              <Body
                className="text-muted-foreground"
                testID={`${testIDPrefix}-day-off-${day}`}
              >
                {t('build.dayOff')}
              </Body>
            ) : (
              <View className="gap-4">
                {blocks.map((block, i) => {
                  const outsideAvailability =
                    availability !== undefined &&
                    isOutsideAvailability(
                      {
                        weekday: day,
                        start_time: block.start,
                        end_time: block.end,
                      },
                      availability
                    );

                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: blocks don't have stable IDs
                    <View key={i} className="gap-3 rounded-row bg-muted p-3">
                      <TimeRangePicker
                        testID={`${testIDPrefix}-time-range-${day}-${i}`}
                        start={block.start}
                        end={block.end}
                        onChange={(start, end) =>
                          handleTimeChange(day, i, start, end)
                        }
                      />

                      <View className="gap-2">
                        <Body>{t('build.childrenLabel')}</Body>
                        <View className="flex-row flex-wrap gap-2">
                          {children.map(child => (
                            <ChildChip
                              key={child.id}
                              testID={`${testIDPrefix}-child-${day}-${i}-${child.id}`}
                              name={child.name}
                              colour={child.colour ?? undefined}
                              selected={block.children.includes(child.id)}
                              onPress={() => toggleChild(day, i, child.id)}
                            />
                          ))}
                        </View>
                      </View>

                      {outsideAvailability ? (
                        <View className="gap-1 items-start">
                          <StatusPill
                            variant="outside-hours"
                            label={t('build.outsideHoursWarning')}
                            testID={`${testIDPrefix}-outside-hours-${day}-${i}`}
                          />
                          <Caption className="text-warning">
                            {t('build.outsideHoursNote')}
                          </Caption>
                        </View>
                      ) : null}

                      <View className="flex-row justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onPress={() => handleRemoveSlot(day, i)}
                          testID={`${testIDPrefix}-remove-slot-${day}-${i}`}
                          accessibilityLabel={t('build.removeSlotA11y', {
                            start: block.start,
                            end: block.end,
                          })}
                        >
                          <Text>{t('build.removeSlot')}</Text>
                        </Button>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {!isDayOff && isOverlapping ? (
              <Caption
                className="text-destructive"
                testID={`${testIDPrefix}-overlap-${day}`}
              >
                {t('build.slotsOverlapError')}
              </Caption>
            ) : null}

            {blocks.length >= MAX_SLOTS_PER_DAY ? (
              <Caption className="text-muted-foreground">
                {t('build.maxSlotsNote')}
              </Caption>
            ) : (
              <Button
                variant="ghost"
                style={{ alignSelf: 'flex-start' }}
                onPress={() => handleAddSlot(day)}
                testID={`${testIDPrefix}-add-slot-${day}`}
              >
                <Text>{t('build.addSlot')}</Text>
              </Button>
            )}
          </View>
        );
      })}
    </View>
  );
}
