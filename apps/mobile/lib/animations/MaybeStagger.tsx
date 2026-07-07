/**
 * MaybeStagger — Conditional stagger animation wrapper
 *
 * When shouldStagger is true, wraps children in StaggeredFadeIn with the
 * given index. When false, renders children directly via Fragment (no extra
 * wrapper View in the tree).
 *
 * Eliminates the duplicated ternary pattern:
 *   {shouldStagger ? <StaggeredFadeIn index={N}><X/></StaggeredFadeIn> : <X/>}
 */

import type { ReactNode } from 'react';

import { StaggeredFadeIn } from './StaggeredFadeIn';

interface MaybeStaggerProps {
  index: number;
  shouldStagger: boolean;
  children: ReactNode;
}

export function MaybeStagger({
  index,
  shouldStagger,
  children,
}: MaybeStaggerProps) {
  if (shouldStagger) {
    return <StaggeredFadeIn index={index}>{children}</StaggeredFadeIn>;
  }
  return <>{children}</>;
}
