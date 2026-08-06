/**
 * Household, membership, and invite wire contract.
 * @module packages/shared-types/src/schemas/household.schema
 *
 * Backing tables: `households`, `household_members`, `household_invites`
 * (supabase/migrations/009_households.sql). This is the ONE place these
 * shapes are defined — the API validates requests against these, the mobile
 * app validates responses against these. Never redefine a `Household` type
 * in either app.
 */

import { z } from 'zod';

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly. If these drift,
// writes fail at runtime with a constraint violation.
// =============================================================================

/** households.approval_mode */
export const HOUSEHOLD_APPROVAL_MODES = {
  EITHER: 'either',
  ASK_OTHER: 'ask_other',
  OWNER_ONLY: 'owner_only',
} as const;
export type HouseholdApprovalMode =
  (typeof HOUSEHOLD_APPROVAL_MODES)[keyof typeof HOUSEHOLD_APPROVAL_MODES];

/** households.approval_scope */
export const HOUSEHOLD_APPROVAL_SCOPES = {
  ALL: 'all',
  SHORT_NOTICE_AND_CANCELLATIONS: 'short_notice_and_cancellations',
} as const;
export type HouseholdApprovalScope =
  (typeof HOUSEHOLD_APPROVAL_SCOPES)[keyof typeof HOUSEHOLD_APPROVAL_SCOPES];

/**
 * household_members.role
 *
 * MATCHED PAIR: this const-map and the CHECK constraint in
 * supabase/migrations/009_households.sql only ever change together — one
 * migration widens the constraint, the same change widens this map (the
 * planned path for agency roles; see TIER0-PLAN.md Phase 0-B).
 */
export const HOUSEHOLD_ROLES = {
  OWNER: 'owner',
  PARENT: 'parent',
  NANNY: 'nanny',
  HELPER: 'helper',
} as const;
export type HouseholdRole =
  (typeof HOUSEHOLD_ROLES)[keyof typeof HOUSEHOLD_ROLES];

/** household_members.status */
export const HOUSEHOLD_MEMBER_STATUSES = {
  ACTIVE: 'active',
  REMOVED: 'removed',
} as const;
export type HouseholdMemberStatus =
  (typeof HOUSEHOLD_MEMBER_STATUSES)[keyof typeof HOUSEHOLD_MEMBER_STATUSES];

/** household_invites.role — a subset of HOUSEHOLD_ROLES; an invite can never grant 'owner'. */
export const HOUSEHOLD_INVITE_ROLES = {
  PARENT: 'parent',
  NANNY: 'nanny',
  HELPER: 'helper',
} as const;
export type HouseholdInviteRole =
  (typeof HOUSEHOLD_INVITE_ROLES)[keyof typeof HOUSEHOLD_INVITE_ROLES];

/** household_invites.status */
export const HOUSEHOLD_INVITE_STATUSES = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const;
export type HouseholdInviteStatus =
  (typeof HOUSEHOLD_INVITE_STATUSES)[keyof typeof HOUSEHOLD_INVITE_STATUSES];

// =============================================================================
// households
// =============================================================================

/** The persisted entity as returned to clients. */
export const HouseholdSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  timezone: z.string().min(1),
  address_line: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  approval_mode: z.enum(Object.values(HOUSEHOLD_APPROVAL_MODES)),
  approval_scope: z.enum(Object.values(HOUSEHOLD_APPROVAL_SCOPES)),
  approval_timeout_minutes: z.int().min(0).max(10080),
  short_notice_hours: z.int().min(0).max(336),
  cancellation_paid_within_hours: z.int().min(0).max(336),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST body — what a client sends to create one. */
export const CreateHouseholdSchema = z.object({
  name: z.string().min(1, 'name is required'),
  timezone: z.string().min(1).optional(),
  address_line: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  approval_mode: z.enum(Object.values(HOUSEHOLD_APPROVAL_MODES)).optional(),
  approval_scope: z.enum(Object.values(HOUSEHOLD_APPROVAL_SCOPES)).optional(),
  approval_timeout_minutes: z.int().min(0).max(10080).optional(),
  short_notice_hours: z.int().min(0).max(336).optional(),
  cancellation_paid_within_hours: z.int().min(0).max(336).optional(),
});

/** PATCH body — every field optional, but at least one must be present. */
export const UpdateHouseholdSchema = CreateHouseholdSchema.partial().refine(
  data => Object.keys(data).length > 0,
  { message: 'at least one field is required' }
);

/** URL param validation for /households/:householdId routes. */
export const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});

/** List response envelope. */
export const HouseholdListResponseSchema = z.object({
  households: z.array(HouseholdSchema),
});

export type Household = z.infer<typeof HouseholdSchema>;
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdSchema>;
export type UpdateHouseholdInput = z.infer<typeof UpdateHouseholdSchema>;
export type HouseholdListResponse = z.infer<typeof HouseholdListResponseSchema>;

// =============================================================================
// household_members
// =============================================================================

/** The persisted entity as returned to clients. */
export const HouseholdMemberSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  user_id: z.uuid(),
  role: z.enum(Object.values(HOUSEHOLD_ROLES)),
  can_edit: z.boolean(),
  status: z.enum(Object.values(HOUSEHOLD_MEMBER_STATUSES)),
  display_name_override: z.string().nullable(),
  // Joined from `user_profiles` by the members-list read only — absent on
  // rows produced by redeem/patch, and null when the profile row is gone.
  // Clients resolve a label as override -> profile_name -> role fallback.
  profile_name: z.string().nullable().optional(),
  colour: z.string().nullable(),
  joined_at: z.iso.datetime({ offset: true }),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

// No CreateHouseholdMemberSchema: a membership row is always the by-product of
// another action — creating a household (the owner row) or redeeming an
// invite (see RedeemHouseholdInviteSchema below) — never a direct client
// create. Only the mutable fields are ever PATCHed directly.

/** PATCH body — promote/demote, toggle edit rights, or remove a member. */
export const UpdateHouseholdMemberSchema = z
  .object({
    role: z.enum(Object.values(HOUSEHOLD_ROLES)).optional(),
    can_edit: z.boolean().optional(),
    status: z.enum(Object.values(HOUSEHOLD_MEMBER_STATUSES)).optional(),
    display_name_override: z.string().optional(),
    colour: z.string().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  });

/** URL param validation for /household-members/:memberId routes. */
export const HouseholdMemberIdParamSchema = z.object({
  memberId: z.uuid(),
});

/** List response envelope. */
export const HouseholdMemberListResponseSchema = z.object({
  household_members: z.array(HouseholdMemberSchema),
});

export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;
export type UpdateHouseholdMemberInput = z.infer<
  typeof UpdateHouseholdMemberSchema
>;
export type HouseholdMemberListResponse = z.infer<
  typeof HouseholdMemberListResponseSchema
>;

// =============================================================================
// household_invites
// =============================================================================

/** The persisted entity as returned to clients. */
export const HouseholdInviteSchema = z.object({
  id: z.uuid(),
  household_id: z.uuid(),
  // Human-transcribable short code, e.g. 'R4K-92T'. Server-generated.
  code: z.string().min(1),
  email: z.email().nullable(),
  role: z.enum(Object.values(HOUSEHOLD_INVITE_ROLES)),
  invited_by: z.uuid().nullable(),
  expires_at: z.iso.datetime({ offset: true }),
  status: z.enum(Object.values(HOUSEHOLD_INVITE_STATUSES)),
  accepted_by: z.uuid().nullable(),
  accepted_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** POST body — what a parent sends to invite someone. `code` is server-assigned. */
export const CreateHouseholdInviteSchema = z.object({
  email: z.email().optional(),
  role: z.enum(Object.values(HOUSEHOLD_INVITE_ROLES)),
});

/** PATCH body — the only legitimate client transition is revoking a pending invite. */
export const UpdateHouseholdInviteSchema = z
  .object({
    status: z.literal(HOUSEHOLD_INVITE_STATUSES.REVOKED),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  });

/** POST body for redeeming an invite by its human-transcribable code. */
export const RedeemHouseholdInviteSchema = z.object({
  code: z.string().min(1, 'code is required'),
});

/** URL param validation for /household-invites/:inviteId routes. */
export const HouseholdInviteIdParamSchema = z.object({
  inviteId: z.uuid(),
});

/** List response envelope. */
export const HouseholdInviteListResponseSchema = z.object({
  household_invites: z.array(HouseholdInviteSchema),
});

export type HouseholdInvite = z.infer<typeof HouseholdInviteSchema>;
export type CreateHouseholdInviteInput = z.infer<
  typeof CreateHouseholdInviteSchema
>;
export type UpdateHouseholdInviteInput = z.infer<
  typeof UpdateHouseholdInviteSchema
>;
export type RedeemHouseholdInviteInput = z.infer<
  typeof RedeemHouseholdInviteSchema
>;
export type HouseholdInviteListResponse = z.infer<
  typeof HouseholdInviteListResponseSchema
>;
