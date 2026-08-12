// File: src/api/endpoints/household.ts
// Description: API endpoints, Zod response validation, and types for
// households, membership, and invites. The wire shapes for Household,
// HouseholdInvite, and HouseholdMember come from the ONE shared source —
// `@steadily-nanny/shared-types/schemas/household.schema` — never redefined
// here. `InvitePreviewSchema` is the one exception: it's a server-only DTO
// (see `apps/api/src/domains/household/schemas.ts`) not published to the
// shared package, so it's mirrored locally, same as `user.ts` does for
// shapes with no shared counterpart.
//
// Every network call goes through the shared `apiClient` and unwraps the
// standard success envelope `{ success, data, message, ... }` at
// `response.data.data` before validating the payload with Zod.

import {
  type CreateHouseholdInput,
  type CreateHouseholdInviteInput,
  CreateHouseholdInviteSchema,
  CreateHouseholdSchema,
  HOUSEHOLD_STATES,
  type Household,
  type HouseholdInvite,
  HouseholdInviteSchema,
  HouseholdListResponseSchema,
  type HouseholdMember,
  HouseholdMemberListResponseSchema,
  HouseholdMemberSchema,
  HouseholdSchema,
  RedeemHouseholdInviteSchema,
  type UpdateHouseholdInput,
  type UpdateHouseholdInviteInput,
  UpdateHouseholdInviteSchema,
  type UpdateHouseholdMemberInput,
  UpdateHouseholdMemberSchema,
  UpdateHouseholdSchema,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import { z } from 'zod';
import { apiClient } from '@/src/api/client';

// --- Endpoint URLs ----------------------------------------------------------
export const householdEndpoints = {
  list: '/v1/households',
  create: '/v1/households',
  getById: (householdId: string) => `/v1/households/${householdId}`,
  update: (householdId: string) => `/v1/households/${householdId}`,
  listMembers: (householdId: string) => `/v1/households/${householdId}/members`,
  updateMember: (householdId: string, memberId: string) =>
    `/v1/households/${householdId}/members/${memberId}`,
  leave: (householdId: string) => `/v1/households/${householdId}/members/leave`,
  createInvite: (householdId: string) =>
    `/v1/households/${householdId}/invites`,
  updateInvite: (householdId: string, inviteId: string) =>
    `/v1/households/${householdId}/invites/${inviteId}`,
  redeemInvite: '/v1/households/invites/redeem',
  previewInvite: (code: string) => `/v1/households/invites/${code}/preview`,
} as const;

// --- Zod schemas not (yet) in the shared package ----------------------------

// API-CONTRACT: GET /v1/households/invites/:code/preview — deliberately
// minimal (no household id, no member list) since the caller isn't a member
// yet. Mirrors `InvitePreviewSchema` in
// apps/api/src/domains/household/schemas.ts.
const InvitePreviewSchema = z.object({
  household_name: z.string(),
  children_first_names: z.array(z.string()),
  role: z.enum(['parent', 'nanny', 'helper']),
  /**
   * D-34/§8.2. A `draft` invite was minted by a NANNY authoring her own terms
   * before she has a family; redeeming it ABSORBS her into the redeemer's
   * existing household rather than joining them to hers. The confirm sheet
   * needs to know which kind of code it is holding before it can name the
   * outcome, and "the redeemer has a household" alone can't tell an
   * absorption from an ordinary second-family co-parent invite.
   *
   * `.default(...)` on both: a server that predates 093 answers neither, and
   * every invite that exists today is a live household's.
   */
  household_state: z
    .enum(Object.values(HOUSEHOLD_STATES))
    .default(HOUSEHOLD_STATES.LIVE),
  /** The draft author's display name, for §8.2's "Add Marisol to your family?". */
  carer_name: z.string().nullable().default(null),
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

// --- API --------------------------------------------------------------------
export const householdApi = {
  /** The caller's own households — ACTIVE memberships only. */
  list: async (): Promise<Household[]> => {
    const response = await apiClient.get(householdEndpoints.list);
    const parsed = HouseholdListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.households;
  },

  /**
   * The households the caller was REMOVED from. A removed nanny still reads
   * the hours, expenses and pay she accrued there — without this the money
   * she is owed has no route in the app, because her old household drops out
   * of `list` the moment the parent removes her.
   *
   * ponytail: same GET as `list`, deliberately fetched twice rather than
   * widening `list`'s array return into the envelope — that contract is
   * mocked in eleven test files across other domains. Collapse the two into
   * one `select`-split query when those mocks are being touched anyway.
   */
  listPast: async (): Promise<Household[]> => {
    const response = await apiClient.get(householdEndpoints.list);
    const parsed = HouseholdListResponseSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.past_households;
  },

  /** Create a household — the caller becomes its owner. */
  create: async (input: CreateHouseholdInput): Promise<Household> => {
    const validated = CreateHouseholdSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      householdEndpoints.create,
      validated.data
    );
    const parsed = z
      .object({ household: HouseholdSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.household;
  },

  /** Fetch a single owned/member household. */
  getById: async (householdId: string): Promise<Household> => {
    const response = await apiClient.get(
      householdEndpoints.getById(householdId)
    );
    const parsed = z
      .object({ household: HouseholdSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.household;
  },

  /**
   * Update mutable household fields (name, timezone, address, approval
   * policy). Owner/parent only — enforced server-side. `input` should be a
   * DIFF (only the fields that actually changed), not the whole household —
   * `UpdateHouseholdSchema` requires at least one field and PATCH semantics
   * mean unset fields are left untouched server-side.
   */
  update: async (
    householdId: string,
    input: UpdateHouseholdInput
  ): Promise<Household> => {
    const validated = UpdateHouseholdSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      householdEndpoints.update(householdId),
      validated.data
    );
    const parsed = z
      .object({ household: HouseholdSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.household;
  },

  /** Active membership rows for a household the caller belongs to. */
  listMembers: async (householdId: string): Promise<HouseholdMember[]> => {
    const response = await apiClient.get(
      householdEndpoints.listMembers(householdId)
    );
    const parsed = HouseholdMemberListResponseSchema.safeParse(
      response.data.data
    );
    if (!parsed.success) throw parsed.error;
    return parsed.data.household_members;
  },

  /**
   * Update a member's mutable fields — in practice, only `status: 'removed'`
   * (soft-remove). Owner/parent only, enforced server-side; 409 CONFLICT if
   * the member has a running time entry. Response envelope key (`member`)
   * follows the same singular-resource convention as `update`'s `household`
   * and `createInvite`'s `invite`.
   */
  updateMember: async (
    householdId: string,
    memberId: string,
    input: UpdateHouseholdMemberInput
  ): Promise<HouseholdMember> => {
    const validated = UpdateHouseholdMemberSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      householdEndpoints.updateMember(householdId, memberId),
      validated.data
    );
    // Envelope key matches the API's house convention: listMembers wraps as
    // `household_members`, so the singular PATCH wraps as `household_member`.
    const parsed = z
      .object({ household_member: HouseholdMemberSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.household_member;
  },

  /**
   * Leave a household yourself — the self-service counterpart to
   * `updateMember({ status: 'removed' })`, which is deliberately somebody
   * ELSE removing you (`CannotRemoveSelfError`). No body: the membership is
   * fully determined by the caller's identity plus the household in the URL.
   *
   * Two refusals, both enforced server-side and both surfaced to the caller
   * rather than swallowed: 403 `CANNOT_LEAVE_AS_OWNER` (the owner membership
   * is created with the household and can never be revoked, so no path may
   * orphan a household) and 409 `CANNOT_LEAVE_WHILE_CLOCKED_IN`.
   *
   * Returns nothing. The response carries no membership row on purpose —
   * after leaving there is no active membership left to describe, and the
   * caller's next honest read is the refetched household/membership lists.
   */
  leave: async (householdId: string): Promise<void> => {
    await apiClient.post(householdEndpoints.leave(householdId));
  },

  /** Generate an invite code (parents only — enforced server-side). */
  createInvite: async (
    householdId: string,
    input: CreateHouseholdInviteInput
  ): Promise<HouseholdInvite> => {
    const validated = CreateHouseholdInviteSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      householdEndpoints.createInvite(householdId),
      validated.data
    );
    const parsed = z
      .object({ invite: HouseholdInviteSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.invite;
  },

  /**
   * Revoke a pending invite (the only client-legal transition — enforced by
   * `UpdateHouseholdInviteSchema`'s literal). Owner/parent only,
   * enforced server-side; 409 CONFLICT if the invite is no longer pending.
   */
  updateInvite: async (
    householdId: string,
    inviteId: string,
    input: UpdateHouseholdInviteInput
  ): Promise<HouseholdInvite> => {
    const validated = UpdateHouseholdInviteSchema.safeParse(input);
    if (!validated.success) throw validated.error;

    const response = await apiClient.patch(
      householdEndpoints.updateInvite(householdId, inviteId),
      validated.data
    );
    const parsed = z
      .object({ invite: HouseholdInviteSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.invite;
  },

  /** Preview an invite by code — no auth-to-household relationship required. */
  previewInvite: async (code: string): Promise<InvitePreview> => {
    const response = await apiClient.get(
      householdEndpoints.previewInvite(code)
    );
    const parsed = InvitePreviewSchema.safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },

  /**
   * Redeem an invite code — creates the caller's membership row.
   *
   * `targetHouseholdId` is D-34's absorption target: when a parent with ≥1
   * live household redeems a NANNY'S draft code, the nanny joins THAT
   * household rather than the redeemer joining her draft, and with ≥2 the
   * parent picks which (§8.2). Omitted on every ordinary redemption, where
   * the invite already names the household.
   *
   * `weekStartsOn` is D-8's FLSA workweek for the household the server
   * INSTANTIATES from a draft when there is no absorption target (096). It
   * belongs on this request because the redeemer is the employer and their
   * device is the only one present: nothing ever sets `week_starts_on` on a
   * nanny-authored draft, so without it a US family onboarded through 3-O
   * takes the SQL default of Monday and D-8 locks it. Ignored on every other
   * path — an existing family's pay week is not this device's to change.
   *
   * The shared `RedeemHouseholdInviteSchema` is `{ code }` only, and a plain
   * Zod object strips unknown keys — parsing the body through it would
   * silently drop the target and absorb into a household nobody chose. Hence
   * the local extend rather than a spread over `validated.data`.
   */
  redeemInvite: async (
    code: string,
    targetHouseholdId?: string,
    weekStartsOn?: number
  ): Promise<HouseholdMember> => {
    const validated = RedeemHouseholdInviteSchema.extend({
      target_household_id: z.uuid().optional(),
      week_starts_on: z.number().int().min(0).max(6).optional(),
    }).safeParse({
      code,
      ...(targetHouseholdId ? { target_household_id: targetHouseholdId } : {}),
      ...(weekStartsOn !== undefined ? { week_starts_on: weekStartsOn } : {}),
    });
    if (!validated.success) throw validated.error;

    const response = await apiClient.post(
      householdEndpoints.redeemInvite,
      validated.data
    );
    const parsed = z
      .object({ membership: HouseholdMemberSchema })
      .safeParse(response.data.data);
    if (!parsed.success) throw parsed.error;
    return parsed.data.membership;
  },
};
