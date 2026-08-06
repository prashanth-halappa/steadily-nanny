/**
 * Me domain schemas — shared wire contract re-export + server-only query
 * validation for GET /me/shifts and GET /me/change-requests.
 *
 * @module domains/me/schemas
 */
import { z } from 'zod';

export type {
  ClashWarning,
  ClashWarningKind,
  ClashWarningList,
  MeShift,
  MeShiftListResponse,
} from '@steadily-nanny/shared-types/schemas/me.schema';
export {
  CLASH_WARNING_KINDS,
  ClashWarningListSchema,
  ClashWarningSchema,
  MeShiftListResponseSchema,
  MeShiftSchema,
} from '@steadily-nanny/shared-types/schemas/me.schema';

export type { ShiftChangeRequestListResponse } from '@steadily-nanny/shared-types/schemas/shift.schema';
export { ShiftChangeRequestListResponseSchema } from '@steadily-nanny/shared-types/schemas/shift.schema';

/** Query validation for GET /me/shifts?from=&to= and /me/change-requests. */
export const MeShiftRangeQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine(
    // Instant compare — lexicographic ISO strings break across offsets
    // (e.g. `…T11:00:00-01:00` vs `…T12:00:00+00:00`).
    data => Date.parse(data.to) > Date.parse(data.from),
    {
      message: 'to must be after from',
      path: ['to'],
    }
  );
export type MeShiftRangeQuery = z.infer<typeof MeShiftRangeQuerySchema>;
