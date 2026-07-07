/**
 * Widget domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of truth);
 * this module re-exports them so consumers can `import { Widget } from '../types'`
 * following the domain-anatomy convention.
 *
 * @module domains/widget/types
 */
export type {
  CreateWidgetInput,
  UpdateWidgetInput,
  Widget,
  WidgetDescription,
} from '../schemas';
