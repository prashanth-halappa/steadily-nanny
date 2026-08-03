/**
 * Section wrapper component — extracts the repeated px-[22px] mt-8 + H2 heading
 * pattern into a reusable layout primitive for screen sections.
 */

import type React from 'react';
import { View } from 'react-native';

import { H2, MetadataLabel } from '@/src/components/ui/typography';
import { cn } from '~/lib/utils';

interface SectionProps {
  title?: string;
  metadataLabel?: string;
  children: React.ReactNode;
  noPadding?: boolean;
  noTopMargin?: boolean;
  className?: string;
  gap?: 'none' | 'sm' | 'md' | 'lg';
  testID?: string;
}

const gapMap: Record<NonNullable<SectionProps['gap']>, string> = {
  none: 'gap-0',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
};

export function Section({
  title,
  metadataLabel,
  children,
  noPadding = false,
  noTopMargin = false,
  className,
  gap = 'md',
  testID,
}: SectionProps) {
  return (
    <View
      testID={testID}
      className={cn(
        !noPadding && 'px-[22px]',
        !noTopMargin && 'mt-8',
        gapMap[gap],
        className
      )}
    >
      {metadataLabel ? <MetadataLabel>{metadataLabel}</MetadataLabel> : null}
      {title ? <H2 className="border-b-0 pb-0">{title}</H2> : null}
      {children}
    </View>
  );
}
