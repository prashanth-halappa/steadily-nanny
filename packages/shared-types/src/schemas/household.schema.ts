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
// The invite's pay OFFER is a full arrangement request (P8, 098). No cycle:
// `payArrangement.schema` imports nothing but zod, and `termsProposal.schema`
// already leans on it the same way for the `terms` bag it carries.
import { PhoneNumberSchema } from './contact.schema';
import { CreatePayArrangementRequestSchema } from './payArrangement.schema';

/**
 * `households.emergency_contact_*` (099) — THE NEXT PERSON DOWN THE LIST.
 *
 * Not the parent's own alternate number. A second number for the same parent
 * solves nothing when that parent is the one not answering; she needs a
 * partner, a grandparent, a neighbour — someone who could actually get
 * there. The column names invite the other reading, which is why this says
 * so here and in 099's column comments.
 *
 * All three are `.nullable()`: most households have not been asked yet (the
 * question is put the day a carer first goes active, not during onboarding,
 * where it collects "my other mobile").
 *
 * On the RESPONSE schema they are `.nullable().optional()` rather than
 * `.nullable().default(null)` — the `profile_name` treatment, not the
 * `pay_offer` one — so a client on this schema parses a response from a
 * server that predates 099 AND every existing `Household` literal in both
 * apps' tests keeps compiling. Read them as `?? null`; absent and null both
 * mean "no contact recorded" and no caller should distinguish them.
 *
 * Parent-editable through `PATCH /households/:id` and nothing else — there is
 * no second endpoint, and `householdCommandService.update`'s existing
 * owner/parent gate is the whole authorisation story.
 */
const EmergencyContactNameSchema = z.string().min(1).max(200);
const EmergencyContactRelationshipSchema = z.string().min(1).max(80);

// =============================================================================
// Const-maps — mirror the SQL `check` constraints exactly. If these drift,
// writes fail at runtime with a constraint violation.
// =============================================================================

/** households.approval_mode */
export const HOUSEHOLD_APPROVAL_MODES = {
  EITHER: 'either',
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

/**
 * household_members.status
 *
 * MATCHED PAIR with the CHECK in 009_households.sql, widened by
 * 093_draft_households.sql.
 *
 * `candidate` (D-49, screens-onboarding-terms-proposal.md §8.2.1) is the
 * nanny who has redeemed a code into a LIVE household but whose terms the
 * family has not accepted yet. Redemption is not hiring: until acceptance she
 * must read nothing of that household — not the schedule, not the children,
 * not the other carer.
 *
 * That rule is enforced FAIL-CLOSED rather than enumerated. Every RLS
 * predicate and every service gate in this codebase filters
 * `status = 'active'` POSITIVELY (`009:163`, `:185`, `:203`, the partial
 * index at `:104-106`, `findActiveMembership`), so a `candidate` row matches
 * none of them and reads nothing by default. The single exception is her own
 * proposal, scoped to `terms_proposals.carer_id = auth.uid()`.
 *
 * DO NOT "simplify" any of those filters to `status != 'removed'`. A negated
 * filter is the one shape that would silently grant a candidate full
 * household read access, and nothing would fail.
 */
export const HOUSEHOLD_MEMBER_STATUSES = {
  ACTIVE: 'active',
  REMOVED: 'removed',
  CANDIDATE: 'candidate',
} as const;
export type HouseholdMemberStatus =
  (typeof HOUSEHOLD_MEMBER_STATUSES)[keyof typeof HOUSEHOLD_MEMBER_STATUSES];

/**
 * The two statuses that mean "is, or once was, a member of this household".
 *
 * This is the set the money-read gates want when they ask "who is this
 * person here?" — a removed nanny keeps her own audit trail, a candidate has
 * no trail to keep. Kept as a POSITIVE list so a future status is excluded
 * by construction rather than by somebody remembering to exclude it.
 */
export const HOUSEHOLD_MEMBERSHIP_STATUSES: readonly HouseholdMemberStatus[] = [
  HOUSEHOLD_MEMBER_STATUSES.ACTIVE,
  HOUSEHOLD_MEMBER_STATUSES.REMOVED,
];

/**
 * households.state (D-34/D-36, 093_draft_households.sql).
 *
 * A `draft` is a household a NANNY created to author her own terms before she
 * has a family. It has no owner and no parent member — her membership is
 * `role='nanny'` — which is what makes D-36's "nothing priceable" a property
 * of the membership table rather than of hidden buttons: `pay_arrangements`
 * inserts are gated on `WRITE_ROLES = {owner, parent}`, so in a draft there
 * is literally nobody who can insert one.
 *
 * Drafts are invisible to every cron sweep, digest and horizon job (D-34).
 */
export const HOUSEHOLD_STATES = {
  DRAFT: 'draft',
  LIVE: 'live',
} as const;
export type HouseholdState =
  (typeof HOUSEHOLD_STATES)[keyof typeof HOUSEHOLD_STATES];

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

/**
 * `households.currency` — ISO-4217, house style matches every other money
 * table's `CurrencyCodeSchema` (`docs/11-MONEY.md` §1): a regex, not
 * `.length(3)`, because `"ab1"`/`"gbp"` are three characters and neither is
 * a currency.
 */
const HouseholdCurrencySchema = z.string().regex(/^[A-Z]{3}$/);

/**
 * `households.jurisdiction` — a US state code. Nullable: a device can name a
 * country from its locale but never a state (`getDeviceCurrency`'s sibling
 * has no `getDeviceJurisdiction`), so this stays unset until a parent picks
 * one in settings.
 */
const HouseholdJurisdictionSchema = z.string().regex(/^[A-Z]{2}$/);

/**
 * `households.week_starts_on` — 0=Sunday..6=Saturday, matching Postgres
 * `extract(dow)` and the same convention `user_profiles.week_starts_on`
 * (011_availability.sql) already uses. Required, not nullable: the SQL
 * column is `not null default 1`.
 */
const HouseholdWeekStartsOnSchema = z.int().min(0).max(6);

/** The persisted entity as returned to clients. */
export const HouseholdSchema = z.object({
  id: z.uuid(),
  /**
   * NULLABLE since 093 (§4.2). A nanny authoring a terms draft is never asked
   * for a family name — she has not met them yet, and a wizard that demands
   * one before she has it is why interview-stage tools get abandoned. A draft
   * is created with `name = null` and rendered "Untitled draft"; the label is
   * asked for at the SHARE moment, where it is finally useful and finally
   * known. Every live household still has one (see CreateHouseholdSchema's
   * refine).
   */
  name: z.string().min(1).nullable(),
  timezone: z.string().min(1),
  address_line: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  approval_mode: z.enum(Object.values(HOUSEHOLD_APPROVAL_MODES)),
  approval_scope: z.enum(Object.values(HOUSEHOLD_APPROVAL_SCOPES)),
  short_notice_hours: z.int().min(0).max(336),
  cancellation_paid_within_hours: z.int().min(0).max(336),
  currency: HouseholdCurrencySchema,
  jurisdiction: HouseholdJurisdictionSchema.nullable(),
  week_starts_on: HouseholdWeekStartsOnSchema,
  /**
   * `.default(HOUSEHOLD_STATES.LIVE)` keeps a client on this schema working
   * against a server that predates the column, and every household that
   * exists today IS live. The SQL column carries the same default, so no
   * backfill was needed.
   */
  state: z.enum(Object.values(HOUSEHOLD_STATES)).default(HOUSEHOLD_STATES.LIVE),
  /** See `EmergencyContactNameSchema` above — a THIRD PARTY, not a parent. */
  emergency_contact_name: EmergencyContactNameSchema.nullable().optional(),
  emergency_contact_phone: PhoneNumberSchema.nullable().optional(),
  emergency_contact_relationship:
    EmergencyContactRelationshipSchema.nullable().optional(),
  created_by: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/**
 * POST body — what a client sends to create one.
 *
 * `name` is optional ONLY for a draft. The refine below is the wire's half of
 * the "a live household always has a name" invariant; the service and the
 * SQL CHECK in 093 carry the other halves.
 */
export const CreateHouseholdSchema = z
  .object({
    name: z.string().min(1, 'name is required').optional(),
    state: z.enum(Object.values(HOUSEHOLD_STATES)).optional(),
    timezone: z.string().min(1).optional(),
    address_line: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    approval_mode: z.enum(Object.values(HOUSEHOLD_APPROVAL_MODES)).optional(),
    approval_scope: z.enum(Object.values(HOUSEHOLD_APPROVAL_SCOPES)).optional(),
    short_notice_hours: z.int().min(0).max(336).optional(),
    cancellation_paid_within_hours: z.int().min(0).max(336).optional(),
    currency: HouseholdCurrencySchema.optional(),
    jurisdiction: HouseholdJurisdictionSchema.nullable().optional(),
    week_starts_on: HouseholdWeekStartsOnSchema.optional(),
  })
  .refine(
    data =>
      data.state === HOUSEHOLD_STATES.DRAFT ||
      (data.name !== undefined && data.name.length > 0),
    { message: 'name is required unless the household is a draft' }
  );

/**
 * PATCH body — every field optional, but at least one must be present.
 *
 * `state` is NOT patchable: a draft goes live exactly once, inside the
 * redemption function (094), in the same transaction that makes a parent its
 * owner. A household that could be flipped live by a PATCH would be a
 * household with no owner and full cron exposure.
 */
export const UpdateHouseholdSchema = z
  .object({
    name: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    address_line: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    approval_mode: z.enum(Object.values(HOUSEHOLD_APPROVAL_MODES)).optional(),
    approval_scope: z.enum(Object.values(HOUSEHOLD_APPROVAL_SCOPES)).optional(),
    short_notice_hours: z.int().min(0).max(336).optional(),
    cancellation_paid_within_hours: z.int().min(0).max(336).optional(),
    currency: HouseholdCurrencySchema.optional(),
    jurisdiction: HouseholdJurisdictionSchema.nullable().optional(),
    week_starts_on: HouseholdWeekStartsOnSchema.optional(),
    /**
     * The emergency contact (099). Nullable as well as optional, unlike most
     * of this body: a contact can be taken back DOWN — the grandparent moved
     * away, the neighbour fell out with the family — and a field that can
     * only ever be set is a stale number a nanny would ring in a crisis.
     */
    emergency_contact_name: EmergencyContactNameSchema.nullable().optional(),
    emergency_contact_phone: PhoneNumberSchema.nullable().optional(),
    emergency_contact_relationship:
      EmergencyContactRelationshipSchema.nullable().optional(),
  })
  .refine(data => Object.keys(data).length > 0, {
    message: 'at least one field is required',
  });

/** URL param validation for /households/:householdId routes. */
export const HouseholdIdParamSchema = z.object({
  householdId: z.uuid(),
});

/**
 * List response envelope.
 *
 * `past_households` are the households the caller was REMOVED from. They are
 * a SEPARATE array, never merged into `households`, because everything that
 * asks "which household am I in" — writes, role gating, the picker's default
 * — reads `households`, and a removed member must never land in that set.
 * She keeps read-only access to the hours and pay she accrued there, so the
 * app still needs a route to them.
 *
 * `.default([])` keeps a client on this schema working against a server that
 * predates the field; the field being additive keeps a client that predates
 * the schema working against this server (Zod objects are non-strict and
 * strip it). Both directions are pinned by tests.
 */
export const HouseholdListResponseSchema = z.object({
  households: z.array(HouseholdSchema),
  past_households: z.array(HouseholdSchema).default([]),
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
  /**
   * The member's own `user_profiles.phone`, joined by the SAME members-list
   * read as `profile_name` (099). This is the ONLY route a co-member's number
   * takes out of the database: `user_profiles` RLS stays owner-only, and
   * widening it to co-members would hand over the whole profile row to
   * deliver one field.
   *
   * `null` means one of three things and the client must treat them alike:
   * the member gave no number, her profile row is gone, or she is not an
   * ACTIVE member of this household — `householdQueryService.listMembers`
   * nulls the field on every `candidate` and `removed` row it returns. A
   * candidate has redeemed a code but her terms are not accepted; neither
   * side has agreed to be reachable by the other yet.
   *
   * `.optional()` for the same reason as `profile_name`: absent on every
   * producer of a member row that is not the roster read (redeem, patch).
   */
  profile_phone: z.string().nullable().optional(),
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
  /**
   * When the PUBLIC terms page at `/t/:code` stops rendering (M26, §6.1).
   *
   * A SEPARATE clock from `expires_at`, deliberately. The code keeps its 30
   * days because a family may reasonably take three weeks to decide and she
   * may read the code out over the phone. The web page is the surface that
   * carries her RATE in public, and 30 days of a live URL is 30 days of
   * exposure for a conversation that is usually over in a week.
   *
   * This is one of Marisol's three standing conditions for the rate being on
   * that page at all (D-51). Defaulted to `created_at + 7 days` in SQL.
   * `.nullable()` covers invites minted before 093.
   */
  link_expires_at: z.iso.datetime({ offset: true }).nullable().default(null),
  /**
   * When the web page first rendered for this code (§5.3 "Opened"), stamped
   * by the CF worker. Whether it reached them — never how many times, from
   * where, or for how long. Between sending her terms and hearing back this
   * is the only question the nanny has.
   */
  opened_at: z.iso.datetime({ offset: true }).nullable().default(null),
  /**
   * Her private label for the recipient ("The Bakers"), asked for at the
   * share moment. FOR HER EYES ONLY — it never leaves the API to anyone but
   * the inviting household, and it is never on the public page.
   */
  label: z.string().nullable().default(null),
  /**
   * The inviting parent's pay OFFER (P8, 098) — non-binding, and the mirror
   * of what a nanny's draft already does for her side.
   *
   * A parent cannot record terms before a nanny exists: `pay_arrangements`
   * and `terms_proposals` are both `(household_id, carer_id)`-scoped, and
   * during onboarding there is no carer. So the terms ride the CODE. When a
   * nanny redeems it, `redeemInvite` promotes this into a real
   * `direction: 'parent'` terms proposal she reviews and accepts through the
   * flow 3-O already shipped.
   *
   * It never binds on its own — nothing is priced from it — and it dies with
   * the invite: revoke or expire the code and the offer goes with it.
   *
   * A `CreatePayArrangementRequest` and not a looser shape, for 092's reason:
   * one wire contract makes "what he offered is what she is asked to accept"
   * a property of the type system rather than a promise in a doc.
   *
   * `.default(null)` like `label` and `opened_at` above — a row read before
   * 098 is applied, or by a client that predates it, has no column to send.
   */
  pay_offer: CreatePayArrangementRequestSchema.nullable().default(null),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/**
 * The two link windows §6.1's share sheet offers, in days. 7 is the default:
 * the public surface is short-lived unless she says otherwise.
 */
export const INVITE_LINK_WINDOW_DAYS = [7, 30] as const;
export const DEFAULT_INVITE_LINK_WINDOW_DAYS = 7;

/** POST body — what a parent sends to invite someone. `code` is server-assigned. */
export const CreateHouseholdInviteSchema = z.object({
  email: z.email().optional(),
  role: z.enum(Object.values(HOUSEHOLD_INVITE_ROLES)),
  /** §6.1 — optional, hers, never shown to the recipient. */
  label: z.string().min(1).max(80).optional(),
  /**
   * A closed pair, not a free integer: the share sheet is a two-chip toggle,
   * and an arbitrary window would be a setting nobody asked for and a longer
   * public exposure than D-51 permits.
   */
  link_expires_in_days: z.union([z.literal(7), z.literal(30)]).optional(),
  /**
   * P8 — the terms this parent is offering, written before he has a nanny to
   * hang them on. Optional: most invites carry none, and an omitted offer is
   * "nothing stated", never an invented rate.
   *
   * Only meaningful on a NANNY invite — pay is per-carer (D-21), so a
   * co-parent or helper invite carrying terms is a client bug and
   * `createInvite` refuses it rather than storing something nobody will ever
   * read.
   */
  pay_offer: CreatePayArrangementRequestSchema.optional(),
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
