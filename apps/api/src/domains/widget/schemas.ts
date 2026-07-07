/**
 * Widget domain schemas — re-exported from the shared wire contract.
 *
 * The widget wire shape lives in ONE place —
 * `@yourapp/shared-types/schemas/widget.schema` — imported by BOTH the API and
 * the mobile app so the contract can never drift. This module re-exports it so
 * domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (repository rows, internal DTOs, DB records) belong HERE,
 * alongside this re-export — they must NOT go in the shared package, which is
 * kept to wire shapes only.
 *
 * @module domains/widget/schemas
 */

export type {
  CreateWidgetInput,
  UpdateWidgetInput,
  Widget,
  WidgetDescription,
} from '@yourapp/shared-types/schemas/widget.schema';
export {
  CreateWidgetSchema,
  UpdateWidgetSchema,
  WidgetDescriptionSchema,
  WidgetIdParamSchema,
  WidgetSchema,
} from '@yourapp/shared-types/schemas/widget.schema';
