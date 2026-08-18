/**
 * @module Section
 *
 * Vertical-rhythm primitive. The app had no section concept: headers ran
 * MetadataLabel (13px) over 16px body text — smaller than what they were
 * labelling — and every gap sat at the same density with nothing reading
 * as a boundary. Section fixes both: a bold DayGroup header, and a 32px
 * space above it against 8px below (~4x) that makes grouping legible
 * without a border, hairline, or accent bar (banned — see card.tsx).
 */

import type * as React from 'react';
import { Pressable, View } from 'react-native';
import { spacing } from '@/lib/design-tokens/spacing';
import { cn } from '@/lib/utils';
import { DayGroup } from '@/src/components/ui/typography';

interface SectionProps {
  title: string;
  /** Baseline-aligned with the title: a count, a total, or one ghost action. */
  right?: React.ReactNode;
  /** Suppress the 32px top gap — this section is the screen's first child. */
  first?: boolean;
  /**
   * Makes the header row itself the tap target (a section that navigates to
   * its own fuller view). Pair it with a chevron in `right` so the
   * affordance is visible — a bare coloured label is not one.
   */
  onHeaderPress?: () => void;
  children: React.ReactNode;
  testID?: string;
  className?: string;
}

export function Section({
  title,
  right,
  first = false,
  onHeaderPress,
  children,
  testID,
  className,
}: SectionProps) {
  const headerRow = (
    <View
      testID={testID ? `${testID}-header` : undefined}
      className={cn(
        'flex-row items-baseline justify-between pb-2',
        first ? 'pt-0' : 'pt-8'
      )}
    >
      <DayGroup>{title}</DayGroup>
      {right}
    </View>
  );

  return (
    <View testID={testID} className={className}>
      {onHeaderPress ? (
        <Pressable
          testID={testID ? `${testID}-header-press` : undefined}
          accessibilityRole="button"
          onPress={onHeaderPress}
          style={{ minHeight: spacing.minTouchTarget }}
          hitSlop={8}
        >
          {headerRow}
        </Pressable>
      ) : (
        headerRow
      )}
      <View
        testID={testID ? `${testID}-children` : undefined}
        className="gap-3"
      >
        {children}
      </View>
    </View>
  );
}

export type { SectionProps };
