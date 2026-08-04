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
} from '@steadily-nanny/shared-types/schemas/approval.schema';
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
