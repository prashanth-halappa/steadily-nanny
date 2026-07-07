// Tabs component - Pill-shaped segmented control for tab navigation
// Structure:
// - Tabs: Root component that manages tab state
// - TabsList: Container with pill-shaped background (rounded-full)
// - TabsTrigger: Individual tab buttons with active/inactive states
// - TabsContent: Content panels for each tab
// Features: Pill-shaped design, clear active/inactive states, smooth transitions

import * as TabsPrimitive from '@rn-primitives/tabs';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import { TextClassContext } from '@/src/components/ui/text';

const Tabs = TabsPrimitive.Root;

function TabsList({
  className,
  ...props
}: TabsPrimitive.ListProps & {
  ref?: React.RefObject<TabsPrimitive.ListRef>;
}) {
  return (
    <TabsPrimitive.List
      className={cn(
        'web:inline-flex h-auto native:min-h-[60px] items-center justify-center rounded-full bg-muted/50 p-1.5 native:px-2 gap-1.5',
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: TabsPrimitive.TriggerProps & {
  ref?: React.RefObject<TabsPrimitive.TriggerRef>;
}) {
  return (
    <TextClassContext.Provider
      value={cn(
        'text-sm native:text-base font-medium web:transition-all',
        'data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground'
      )}
    >
      <TabsPrimitive.Trigger
        className={cn(
          'inline-flex items-center justify-center shadow-none web:whitespace-nowrap rounded-full px-4 py-3 text-sm font-medium web:ring-offset-background web:transition-all web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2',
          'data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground',
          'data-[state=inactive]:bg-transparent data-[state=inactive]:text-muted-foreground',
          'native:min-h-[56px]',
          props.disabled && 'web:pointer-events-none opacity-50',
          className
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function TabsContent({
  className,
  ...props
}: TabsPrimitive.ContentProps & {
  ref?: React.RefObject<TabsPrimitive.ContentRef>;
}) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'web:ring-offset-background web:focus-visible:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring web:focus-visible:ring-offset-2',
        className
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
