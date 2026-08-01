/**
 * Household domain schemas — re-exported from the shared wire contract.
 *
 * The household/member/invite wire shape lives in ONE place —
 * `@steadily-nanny/shared-types/schemas/household.schema` — imported by BOTH
 * the API and the mobile app so the contract can never drift. This module
 * re-exports it so domain-internal imports (`../schemas`) stay stable.
 *
 * SERVER-ONLY schemas (URL params, internal DTOs) belong HERE, alongside this
 * re-export — they must NOT go in the shared package, which is kept to wire
 * shapes only.
 *
 * @module domains/household/schemas
 */
import { z } from 'zod';

export type {
  CreateHouseholdInput,
  CreateHouseholdInviteInput,
  Household,
  HouseholdInvite,
  HouseholdInviteListResponse,
  HouseholdListResponse,
  HouseholdMember,
  HouseholdMemberListResponse,
  RedeemHouseholdInviteInput,
  UpdateHouseholdInput,
  UpdateHouseholdInviteInput,
  UpdateHouseholdMemberInput,
} from '@steadily-nanny/shared-types/schemas/household.schema';
export {
  CreateHouseholdInviteSchema,
  CreateHouseholdSchema,
  HOUSEHOLD_INVITE_ROLES,
  HOUSEHOLD_INVITE_STATUSES,
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  HouseholdIdParamSchema,
  HouseholdInviteIdParamSchema,
  HouseholdInviteListResponseSchema,
  HouseholdInviteSchema,
  HouseholdListResponseSchema,
  HouseholdMemberIdParamSchema,
  HouseholdMemberListResponseSchema,
  HouseholdMemberSchema,
  HouseholdSchema,
  RedeemHouseholdInviteSchema,
  UpdateHouseholdInviteSchema,
  UpdateHouseholdMemberSchema,
  UpdateHouseholdSchema,
} from '@steadily-nanny/shared-types/schemas/household.schema';

/** URL param validation for GET /households/invites/:code/preview. */
export const InviteCodeParamSchema = z.object({
  code: z.string().min(1, 'code is required'),
});
export type InviteCodeParam = z.infer<typeof InviteCodeParamSchema>;

/**
 * Response shape for the unauthenticated (membership-not-required) invite
 * preview — deliberately excludes everything on Household/HouseholdInvite
 * beyond these three fields.
 */
export const InvitePreviewSchema = z.object({
  household_name: z.string(),
  children_first_names: z.array(z.string()),
  role: z.enum(['parent', 'nanny', 'helper']),
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;
