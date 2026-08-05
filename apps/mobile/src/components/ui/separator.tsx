import * as SeparatorPrimitive from '@rn-primitives/separator';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorPrimitive.RootProps & {
  ref?: React.RefObject<SeparatorPrimitive.RootRef>;
}) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 border-border',
        orientation === 'horizontal'
          ? 'w-full border-b border-hairline'
          : 'h-full border-r border-hairline',
        className
      )}
      {...props}
    />
  );
}

export { Separator };
