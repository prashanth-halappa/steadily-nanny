/**
 * Co-parent approval queue wire contract (design flow 1f).
 * @module packages/shared-types/src/schemas/approval.schema
 *
 * Backing table: `co_parent_approvals`
 * (supabase/migrations/022_co_parent_approvals.sql).
 *
 * When a household's `approval_mode` is `ask_other`, scoped mutations
 * (short-notice change / cancel, or all changes when scope is `all`) create
 * a pending row here. A silent phone never blocks a day: after
 * `timeout_at` the job (or on-read expiry) auto-approves.
 */

import { z } from 'zod';

/** co_parent_approvals.action */
export const CO_PARENT_APPROVAL_ACTIONS = {
  SHORT_NOTICE_CHANGE: 'short_notice_change',
  CANCEL: 'cancel',
  EXTRA_SHIFT: 'extra_shift',
  OTHER: 'other',
} as const;
export type CoParentApprovalAction =
  (typeof CO_PARENT_APPROVAL_ACTIONS)[keyof typeof CO_PARENT_APPROVAL_ACTIONS];

/** co_parent_approvals.status */
export const CO_PARENT_APPROVAL_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DECLINED: 'declined',
  TIMED_OUT: 'timed_out',
  WITHDRAWN: 'withdrawn',
} as const;
export type CoParentApprovalStatus =
  (typeof CO_PARENT_APPROVAL_STATUSES)[keyof typeof CO_PARENT_APPROVAL_STATUSES];

export const CoParentApprovalSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  requested_by: z.uuid().nullable(),
  action: z.enum(Object.values(CO_PARENT_APPROVAL_ACTIONS)),
  /** Opaque payload the applying side reconstructs (shift id, proposed times, …). */
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(Object.values(CO_PARENT_APPROVAL_STATUSES)),
  timeout_at: z.iso.datetime({ offset: true }),
  responded_by: z.uuid().nullable(),
  responded_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export const CreateCoParentApprovalSchema = z.object({
  action: z.enum(Object.values(CO_PARENT_APPROVAL_ACTIONS)),
  payload: z.record(z.string(), z.unknown()),
});

export const RespondToCoParentApprovalSchema = z.object({
  status: z.enum([
    CO_PARENT_APPROVAL_STATUSES.APPROVED,
    CO_PARENT_APPROVAL_STATUSES.DECLINED,
  ]),
});

export const CoParentApprovalIdParamSchema = z.object({
  approvalId: z.uuid(),
});

export const CoParentApprovalListResponseSchema = z.object({
  co_parent_approvals: z.array(CoParentApprovalSchema),
});

export type CoParentApproval = z.infer<typeof CoParentApprovalSchema>;
export type CreateCoParentApprovalInput = z.infer<
  typeof CreateCoParentApprovalSchema
>;
export type RespondToCoParentApprovalInput = z.infer<
  typeof RespondToCoParentApprovalSchema
>;
export type CoParentApprovalListResponse = z.infer<
  typeof CoParentApprovalListResponseSchema
>;
