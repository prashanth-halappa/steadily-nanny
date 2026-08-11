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
  CreateHouseholdInput,
  CreateHouseholdInviteInput,
  Household,
  HouseholdHoliday,
  HouseholdHolidayListResponse,
  HouseholdInvite,
  HouseholdInviteListResponse,
  HouseholdListResponse,
  HouseholdMember,
  HouseholdMemberListResponse,
  HouseholdMemberStatus,
  HouseholdState,
  InvitePreview,
  RedeemHouseholdInviteBody,
  RedeemHouseholdInviteInput,
  SetHouseholdHolidaysRequest,
  TermsPreview,
  TermsPreviewSource,
  UpdateHouseholdInput,
  UpdateHouseholdInviteInput,
  UpdateHouseholdMemberInput,
} from '../schemas';
