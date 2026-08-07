/**
 * @module domains/inbox/api
 *
 * Thin inbox-local client for co-parent approvals. The household endpoint
 * module does not expose these routes yet; keeping the call here avoids
 * expanding shared endpoint ownership while the inbox still needs the data.
 */
import {
  type CoParentApproval,
  CoParentApprovalListResponseSchema,
  CoParentApprovalSchema,
  type RespondToCoParentApprovalInput,
  RespondToCoParentApprovalSchema,
} from '@steadily-nanny/shared-types/schemas/approval.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

export async function listPendingApprovals(
  householdId: string
): Promise<CoParentApproval[]> {
  const response = await apiClient.get(
    `/v1/households/${householdId}/approvals`
  );
  const parsed = CoParentApprovalListResponseSchema.safeParse(
    response.data.data
  );
  if (!parsed.success) throw parsed.error;
  return parsed.data.co_parent_approvals;
}

/**
 * Approve or decline a pending co-parent approval — `PATCH
 * /households/:householdId/approvals/:approvalId`. Responding applies (or
 * rejects) the underlying scheduling action server-side; the caller is
 * responsible for invalidating whatever caches that action can touch (see
 * `useRespondToApproval`).
 */
export async function respondToApproval(
  householdId: string,
  approvalId: string,
  status: RespondToCoParentApprovalInput['status']
): Promise<CoParentApproval> {
  const validated = RespondToCoParentApprovalSchema.safeParse({ status });
  if (!validated.success) throw validated.error;

  const response = await apiClient.patch(
    `/v1/households/${householdId}/approvals/${approvalId}`,
    validated.data
  );
  const parsed = z
    .object({ approval: CoParentApprovalSchema })
    .safeParse(response.data.data);
  if (!parsed.success) throw parsed.error;
  return parsed.data.approval;
}
