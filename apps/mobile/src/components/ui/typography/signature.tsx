/**
 * Signature Typography Components
 *
 * Expressive typography for distinctive moments and emotional connection.
 */

import { typography } from '@/lib/design-tokens/typography';
import { createTypographyComponent } from './factory';

export const SignatureHeroLight = createTypographyComponent(
  typography.signature.heroLight,
  'SignatureHeroLight'
);

export const SignatureHeroBold = createTypographyComponent(
  typography.signature.heroBold,
  'SignatureHeroBold'
);

export const SignatureMilestoneHeading = createTypographyComponent(
  typography.signature.milestoneHeading,
  'SignatureMilestoneHeading',
  { role: 'heading', ariaLevel: '1' }
);

export const SignatureContemplative = createTypographyComponent(
  typography.signature.contemplative,
  'SignatureContemplative'
);
