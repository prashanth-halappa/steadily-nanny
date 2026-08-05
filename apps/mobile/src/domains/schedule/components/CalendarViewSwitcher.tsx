/**
 * @module domains/schedule/components/CalendarViewSwitcher
 *
 * Segmented control for calendar views 2a–2d. Persists preference per role
 * in MMKV via `useCalendarViewStore`.
 */

import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { cn } from '@/lib/utils';
import { Caption } from '@/src/components/ui/typography';
import { SETUP_ROLES } from '@/src/domains/setup/types';
import { useActiveHousehold } from '@/src/hooks/queries/useActiveHousehold';
import { useIsOnboarded } from '@/src/hooks/queries/useIsOnboarded';
import {
  CALENDAR_VIEWS,
  type CalendarViewId,
  resolveCalendarView,
  useCalendarViewStore,
} from '@/src/store/calendarViewStore';

const VIEW_OPTIONS: {
  id: CalendarViewId;
  nannyOnly?: boolean;
  multiHouseholdOnly?: boolean;
}[] = [
  { id: CALENDAR_VIEWS.AGENDA },
  { id: CALENDAR_VIEWS.WEEK_RIBBON },
  {
    id: CALENDAR_VIEWS.CROSS_FAMILY,
    nannyOnly: true,
    multiHouseholdOnly: true,
  },
];

interface CalendarViewSwitcherProps {
  value: CalendarViewId;
  onChange: (view: CalendarViewId) => void;
}

export function CalendarViewSwitcher({
  value,
  onChange,
}: CalendarViewSwitcherProps) {
  const { t } = useTranslation('schedule');
  const onboarding = useIsOnboarded();
  const activeHousehold = useActiveHousehold();
  const isNanny = onboarding.role === SETUP_ROLES.NANNY;
  const multiHousehold = (activeHousehold.households?.length ?? 0) >= 2;

  const visibleOptions = VIEW_OPTIONS.filter(opt => {
    if (opt.nannyOnly && !isNanny) return false;
    if (opt.multiHouseholdOnly && !multiHousehold) return false;
    return true;
  });

  return (
    <View
      testID="calendar-view-switcher"
      className="flex-row rounded-chip bg-muted p-1"
    >
      {visibleOptions.map(opt => (
        <Pressable
          key={opt.id}
          testID={`calendar-view-${opt.id}`}
          accessibilityRole="button"
          accessibilityState={{ selected: value === opt.id }}
          onPress={() => onChange(opt.id)}
          className={cn(
            'flex-1 items-center rounded-chip px-3 py-2',
            value === opt.id ? 'bg-primary' : 'bg-transparent'
          )}
        >
          <Caption
            className={cn(
              value === opt.id ? 'text-primary-foreground' : 'text-foreground'
            )}
            weight="medium"
          >
            {t(`calendarViews.${opt.id}`)}
          </Caption>
        </Pressable>
      ))}
    </View>
  );
}

/** Hook: resolved view for the current role, with setter. */
export function useCalendarViewPreference(): [
  CalendarViewId,
  (view: CalendarViewId) => void,
] {
  const onboarding = useIsOnboarded();
  const role = onboarding.role === SETUP_ROLES.NANNY ? 'nanny' : 'parent';
  const store = useCalendarViewStore();
  const view = resolveCalendarView(role, store);
  const setView = (next: CalendarViewId) => store.setView(role, next);
  return [view, setView];
}
