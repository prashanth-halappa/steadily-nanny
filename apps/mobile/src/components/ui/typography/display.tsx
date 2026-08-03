/**
 * Display Typography Components
 *
 * Large, impactful typography for hero sections and major headings.
 */

import { typography } from '@/lib/design-tokens/typography';
import { createTypographyComponent } from './factory';

export const DisplayLarge = createTypographyComponent(
  typography.displayLarge,
  'DisplayLarge',
  { role: 'heading', ariaLevel: '1' }
);

export const Display = createTypographyComponent(
  typography.display,
  'Display',
  {
    role: 'heading',
    ariaLevel: '1',
  }
);

export const Timer = createTypographyComponent(typography.timer, 'Timer', {
  tabular: true,
});

export const DayGroup = createTypographyComponent(
  typography.dayGroup,
  'DayGroup',
  {
    role: 'heading',
    ariaLevel: '2',
  }
);
