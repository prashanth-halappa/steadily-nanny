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
import {
  HOUSEHOLD_STATES,
  HouseholdIdParamSchema as HouseholdIdParam,
  HouseholdInviteIdParamSchema as InviteIdParam,
  HouseholdMemberIdParamSchema as MemberIdParam,
  RedeemHouseholdInviteSchema as RedeemInvite,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { z } from 'zod';
// TYPE-ONLY, and it must stay type-only: the terms-proposal domain imports
// this one for membership, so a runtime import here would close a cycle. Types
// are erased, so this costs nothing at run time.
import type { TermsProposalRow } from '../termsProposal/schemas';

export type {
  CreateHouseholdInput,
  CreateHouseholdInviteInput,
  Household,
  HouseholdInvite,
  HouseholdInviteListResponse,
  HouseholdListResponse,
  HouseholdMember,
  HouseholdMemberListResponse,
  HouseholdMemberStatus,
  HouseholdState,
  RedeemHouseholdInviteInput,
  UpdateHouseholdInput,
  UpdateHouseholdInviteInput,
  UpdateHouseholdMemberInput,
} from '@steadily-nanny/shared-types/schemas/household.schema';
export {
  CreateHouseholdInviteSchema,
  CreateHouseholdSchema,
  DEFAULT_INVITE_LINK_WINDOW_DAYS,
  HOUSEHOLD_APPROVAL_MODES,
  HOUSEHOLD_APPROVAL_SCOPES,
  HOUSEHOLD_INVITE_ROLES,
  HOUSEHOLD_INVITE_STATUSES,
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_MEMBERSHIP_STATUSES,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_STATES,
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
export type {
  HouseholdHoliday,
  HouseholdHolidayListResponse,
  SetHouseholdHolidaysRequest,
} from '@steadily-nanny/shared-types/schemas/householdHoliday.schema';
export {
  HouseholdHolidayListResponseSchema,
  HouseholdHolidaySchema,
  SetHouseholdHolidaysRequestSchema,
} from '@steadily-nanny/shared-types/schemas/householdHoliday.schema';

/**
 * POST body for redeeming an invite, SERVER-SIDE.
 *
 * `target_household_id` is §8.2's absorption target — the household the parent
 * explicitly picked in the confirm dialog when he has two or more, and the one
 * 094 joins the nanny to. Absent means "I have no live household", which 094
 * reads as "instantiate one from her draft".
 *
 * Deliberately NOT in the shared wire package. It is meaningful only to the
 * draft-redemption path and only to this server; every other client of
 * `RedeemHouseholdInviteSchema` sends a code and nothing else, and Zod objects
 * are non-strict, so an older client is unaffected either way.
 */
export const RedeemHouseholdInviteBodySchema = RedeemInvite.extend({
  target_household_id: z.uuid().optional(),
});
export type RedeemHouseholdInviteBody = z.infer<
  typeof RedeemHouseholdInviteBodySchema
>;

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
  /** Empty for a draft: it has no family name, and 093's CHECK is why. */
  household_name: z.string(),
  /** Empty for a draft: its "children" are the placeholders SHE typed. */
  children_first_names: z.array(z.string()),
  role: z.enum(['parent', 'nanny', 'helper']),
  /**
   * ADDITIVE (D-34/§8.2). Which kind of code this is, so the absorption
   * confirm sheet can fire on the one case that needs it: redeeming a nanny's
   * DRAFT code absorbs her into the redeemer's own household rather than
   * joining him to hers. "The redeemer already has a household" cannot tell
   * that apart from an ordinary co-parent invite to a second family, so the
   * client cannot derive this and the server has to say it.
   */
  household_state: z.enum(Object.values(HOUSEHOLD_STATES)),
  /** The draft author, first name and last initial. Null on a live invite. */
  carer_name: z.string().nullable(),
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

/**
 * What `termsPreview` hands its controller: the gate's verdict plus the raw
 * proposal row.
 *
 * The rendered rows and the weekly figure are attached at the WIRE EDGE, in
 * the controller, for exactly the reason `termsProposalController`'s
 * `withWeeklyEquivalent` gives — the figure is not a column, and the renderer
 * belongs to the terms domain. Keeping the row raw here is also what keeps the
 * import type-only, so the household domain never takes a runtime dependency
 * on a domain that depends on it.
 */
export interface TermsPreviewSource {
  code: string;
  carer_name: string;
  proposed_at: string;
  link_expires_at: string;
  currency: string;
  proposal: TermsProposalRow;
}

/**
 * The public terms page's response (§6.2), and the whole of what
 * `nanny.getsteadily.app/t/:code` is allowed to know.
 *
 * `rows` are RENDERED STRINGS, not values to format. That is the requirement,
 * not an implementation choice: the worker holding no formatting logic is what
 * makes "the family reads the same contract on the web as in the app" a
 * property of the code rather than a promise in a doc.
 *
 * Everything absent is absent on purpose — children's names, the family's
 * name, her surname, any address, any contact detail, and her private
 * recipient label.
 */
export const TermsPreviewSchema = z.object({
  code: z.string().min(1),
  /** First name and last initial. Never her surname. */
  carer_name: z.string().min(1),
  proposed_at: z.iso.datetime({ offset: true }),
  link_expires_at: z.iso.datetime({ offset: true }),
  /**
   * The card's hero pair, separate from `rows` because the app renders it that
   * way — a rate with the weekly line beneath it and no label of its own.
   * Giving it a label here would put words on the public page that appear
   * nowhere in the product.
   */
  rate: z.string().min(1),
  /** Null when there is no guarantee: render nothing, never a figure we cannot stand behind (T16). */
  weekly_line: z.string().nullable(),
  /** The same figure as a number, for anything that needs to compute rather than print. */
  weekly_equivalent_minor: z.int().min(0).nullable(),
  rows: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type TermsPreview = z.infer<typeof TermsPreviewSchema>;

/**
 * URL params for the household-nested member and invite routes.
 *
 * These exist because `validate(schema, 'params')` writes the PARSED object
 * back over `req.params`, and Zod strips unknown keys — so validating with the
 * single-id `HouseholdMemberIdParamSchema` deletes `householdId` and the
 * ownership middleware that runs next 404s every request with "Resource id
 * (householdId) not provided". Composed from the shared single-id schemas
 * rather than re-declaring the uuid rules.
 */
export const HouseholdMemberParamSchema = HouseholdIdParam.extend(
  MemberIdParam.shape
);
export type HouseholdMemberParam = z.infer<typeof HouseholdMemberParamSchema>;

export const HouseholdInviteParamSchema = HouseholdIdParam.extend(
  InviteIdParam.shape
);
export type HouseholdInviteParam = z.infer<typeof HouseholdInviteParamSchema>;
