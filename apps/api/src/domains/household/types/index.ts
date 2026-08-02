/**
 * Household domain types.
 *
 * The concrete shapes are Zod-inferred in `../schemas` (single source of
 * truth); this module re-exports them so consumers can
 * `import type { Household } from '../types'` following the domain-anatomy
 * convention.
 *
 * @module domains/household/types
 */
export type {
  CoParentApproval,
  CoParentApprovalAction,
  CoParentApprovalListResponse,
  CoParentApprovalStatus,
  CreateCoParentApprovalInput,
  CreateHouseholdInput,
  CreateHouseholdInviteInput,
  Household,
  HouseholdApprovalIdParam,
  HouseholdInvite,
  HouseholdInviteListResponse,
  HouseholdListResponse,
  HouseholdMember,
  HouseholdMemberListResponse,
  InvitePreview,
  RedeemHouseholdInviteInput,
  RespondToCoParentApprovalInput,
  UpdateHouseholdInput,
  UpdateHouseholdInviteInput,
  UpdateHouseholdMemberInput,
} from '../schemas';
