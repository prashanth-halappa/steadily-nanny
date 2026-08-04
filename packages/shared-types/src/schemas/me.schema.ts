/**
 * Cross-household "me" wire contract: a carer's own shifts across every
 * household they belong to, plus clash-warning shapes returned (never as
 * blocking errors) from shift/pattern write paths.
 *
 * @module packages/shared-types/src/schemas/me.schema
 *
 * Backing reads: `shifts` + `household_members` (for membership context),
 * `v_busy_blocks` + `carer_availability` (for warnings). Migration 015
 * deliberately has no overlap constraint — warnings must never block.
 */

import { z } from 'zod';
import { BUSY_BLOCK_KINDS } from './availability.schema';
import { HOUSEHOLD_ROLES } from './household.schema';
import { ShiftSchema } from './shift.schema';

// =============================================================================
// Const-maps
// =============================================================================

/** Discriminator for a non-blocking clash warning. */
export const CLASH_WARNING_KINDS = {
  BUSY_OVERLAP: 'busy_overlap',
  OUTSIDE_AVAILABILITY: 'outside_availability',
} as const;
export type ClashWarningKind =
  (typeof CLASH_WARNING_KINDS)[keyof typeof CLASH_WARNING_KINDS];

// =============================================================================
// MeShift — a Shift enriched with the caller's membership role in its household
// =============================================================================

/**
 * One of the caller's own shifts (carer_id === caller), across every household
 * they actively belong to. `membership_role` is the caller's role in THAT
 * household so the client can render without a second memberships round-trip.
 */
export const MeShiftSchema = ShiftSchema.extend({
  membership_role: z.enum(Object.values(HOUSEHOLD_ROLES)),
});

/** List response envelope for GET /me/shifts. */
export const MeShiftListResponseSchema = z.object({
  shifts: z.array(MeShiftSchema),
});

export type MeShift = z.infer<typeof MeShiftSchema>;
export type MeShiftListResponse = z.infer<typeof MeShiftListResponseSchema>;

// =============================================================================
// ClashWarning — anonymised; never names another household
// =============================================================================

/**
 * A non-blocking heads-up. For `busy_overlap`, the span is the anonymised
 * busy block (starts_at / ends_at / busy_kind only — same discipline as
 * `AnonymisedBusyBlockSchema`). Never carry a household id or name here.
 */
export const ClashWarningSchema = z.object({
  kind: z.enum(Object.values(CLASH_WARNING_KINDS)),
  starts_at: z.iso.datetime({ offset: true }).optional(),
  ends_at: z.iso.datetime({ offset: true }).optional(),
  busy_kind: z.enum(Object.values(BUSY_BLOCK_KINDS)).optional(),
});

/** List envelope when a write path surfaces warnings alongside the entity. */
export const ClashWarningListSchema = z.object({
  warnings: z.array(ClashWarningSchema),
});

export type ClashWarning = z.infer<typeof ClashWarningSchema>;
export type ClashWarningList = z.infer<typeof ClashWarningListSchema>;
