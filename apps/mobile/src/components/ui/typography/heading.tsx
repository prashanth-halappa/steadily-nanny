/**
 * Heading Typography Components
 *
 * H1, H2, H3, H4 heading components for page structure.
 */

import { typography } from '@/lib/design-tokens/typography';
import { createTypographyComponent } from './factory';

export const H1 = createTypographyComponent(typography.h1, 'H1', {
  role: 'heading',
  ariaLevel: '1',
  defaultClassName:
    'web:scroll-m-20 text-foreground lg:text-5xl web:select-text',
});

export const H2 = createTypographyComponent(typography.h2, 'H2', {
  role: 'heading',
  ariaLevel: '2',
  defaultClassName:
    'web:scroll-m-20 border-b border-border pb-2 text-foreground first:mt-0 web:select-text',
});

export const H3 = createTypographyComponent(typography.h3, 'H3', {
  role: 'heading',
  ariaLevel: '3',
  defaultClassName: 'web:scroll-m-20 text-foreground web:select-text',
});

export const H4 = createTypographyComponent(typography.h4, 'H4', {
  role: 'heading',
  ariaLevel: '4',
  defaultClassName: 'web:scroll-m-20 text-foreground web:select-text',
});
