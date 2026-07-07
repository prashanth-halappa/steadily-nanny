/**
 * Utility Typography Components
 *
 * UI-focused typography for labels, buttons, captions, and special treatments.
 */

import { typography } from '@/lib/design-tokens/typography';
import { createTypographyComponent } from './factory';

export const Caption = createTypographyComponent(typography.caption, 'Caption');
export const Label = createTypographyComponent(typography.label, 'Label');
export const MetadataLabel = createTypographyComponent(
  typography.metadataLabel,
  'MetadataLabel'
);
export const Button = createTypographyComponent(typography.button, 'Button');
export const ButtonSmall = createTypographyComponent(
  typography.buttonSmall,
  'ButtonSmall'
);
export const Achievement = createTypographyComponent(
  typography.achievement,
  'Achievement'
);
export const Encouragement = createTypographyComponent(
  typography.encouragement,
  'Encouragement'
);
