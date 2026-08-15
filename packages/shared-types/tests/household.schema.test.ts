import { describe, expect, it } from 'bun:test';
import {
  CreateHouseholdInviteSchema,
  CreateHouseholdSchema,
  HOUSEHOLD_APPROVAL_MODES,
  HOUSEHOLD_APPROVAL_SCOPES,
  HOUSEHOLD_INVITE_ROLES,
  HOUSEHOLD_INVITE_STATUSES,
  HOUSEHOLD_MEMBER_STATUSES,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_STATES,
  HouseholdIdParamSchema,
  HouseholdInviteSchema,
  HouseholdMemberSchema,
  HouseholdSchema,
  RedeemHouseholdInviteSchema,
  UpdateHouseholdInviteSchema,
  UpdateHouseholdMemberSchema,
  UpdateHouseholdSchema,
} from '../src/schemas/household.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-01T10:00:00Z';

describe('household.schema', () => {
  describe('const-maps match the SQL check constraints', () => {
    // The `: string[]` annotation is what widens Object.values()'s inferred
    // literal-union return type to a plain string array, so it unifies with
    // the plain array literal on the other side of toEqual(). Both sides are
    // sorted so the assertion doesn't depend on key declaration order.
    it('HOUSEHOLD_APPROVAL_MODES matches households.approval_mode', () => {
      const values: string[] = Object.values(HOUSEHOLD_APPROVAL_MODES);
      expect(values.sort()).toEqual(['either', 'owner_only'].sort());
    });

    it('HOUSEHOLD_APPROVAL_SCOPES matches households.approval_scope', () => {
      const values: string[] = Object.values(HOUSEHOLD_APPROVAL_SCOPES);
      expect(values.sort()).toEqual(
        ['all', 'short_notice_and_cancellations'].sort()
      );
    });

    it('HOUSEHOLD_ROLES matches household_members.role', () => {
      const values: string[] = Object.values(HOUSEHOLD_ROLES);
      expect(values.sort()).toEqual(
        ['owner', 'parent', 'nanny', 'helper'].sort()
      );
    });

    it('HOUSEHOLD_MEMBER_STATUSES matches household_members.status', () => {
      const values: string[] = Object.values(HOUSEHOLD_MEMBER_STATUSES);
      expect(values.sort()).toEqual(['active', 'removed', 'candidate'].sort());
    });

    // D-49 / §8.2.1. `candidate` is the redeemed-but-not-yet-accepted nanny.
    // It exists so that EVERY positive `status = 'active'` filter in RLS and
    // in the services excludes her by construction — the visibility rule is
    // fail-closed, never enumerated.
    it('keeps candidate distinct from active and removed', () => {
      expect(HOUSEHOLD_MEMBER_STATUSES.CANDIDATE).toBe('candidate');
      expect(HOUSEHOLD_MEMBER_STATUSES.CANDIDATE).not.toBe(
        HOUSEHOLD_MEMBER_STATUSES.ACTIVE
      );
    });

    it('HOUSEHOLD_STATES matches households.state', () => {
      const values: string[] = Object.values(HOUSEHOLD_STATES);
      expect(values.sort()).toEqual(['draft', 'live'].sort());
    });

    it('HOUSEHOLD_INVITE_ROLES matches household_invites.role (no owner)', () => {
      const values: string[] = Object.values(HOUSEHOLD_INVITE_ROLES);
      expect(values.sort()).toEqual(['parent', 'nanny', 'helper'].sort());
    });

    it('HOUSEHOLD_INVITE_STATUSES matches household_invites.status', () => {
      const values: string[] = Object.values(HOUSEHOLD_INVITE_STATUSES);
      expect(values.sort()).toEqual(
        ['pending', 'accepted', 'revoked', 'expired'].sort()
      );
    });
  });

  describe('HouseholdSchema', () => {
    const validHousehold = {
      id: VALID_UUID,
      name: 'The Reyes Family',
      timezone: 'Europe/London',
      address_line: null,
      latitude: null,
      longitude: null,
      approval_mode: 'either',
      approval_scope: 'short_notice_and_cancellations',
      short_notice_hours: 24,
      cancellation_paid_within_hours: 24,
      currency: 'GBP',
      jurisdiction: null,
      week_starts_on: 1,
      created_by: VALID_UUID,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid household', () => {
      expect(HouseholdSchema.safeParse(validHousehold).success).toBe(true);
    });

    it('rejects a bad uuid', () => {
      const result = HouseholdSchema.safeParse({
        ...validHousehold,
        id: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a missing required field', () => {
      const { name: _name, ...rest } = validHousehold;
      expect(HouseholdSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects an invalid approval_mode enum value', () => {
      const result = HouseholdSchema.safeParse({
        ...validHousehold,
        approval_mode: 'sometimes',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a two-letter US-state jurisdiction', () => {
      expect(
        HouseholdSchema.safeParse({ ...validHousehold, jurisdiction: 'CA' })
          .success
      ).toBe(true);
    });

    it.each([
      'gbp',
      'ab1',
      'usa',
    ])('rejects a malformed currency code %p', code => {
      expect(
        HouseholdSchema.safeParse({ ...validHousehold, currency: code }).success
      ).toBe(false);
    });

    it.each([
      'ca',
      'C1',
      'CAL',
    ])('rejects a malformed jurisdiction code %p', code => {
      expect(
        HouseholdSchema.safeParse({ ...validHousehold, jurisdiction: code })
          .success
      ).toBe(false);
    });

    it.each([
      0, 1, 2, 3, 4, 5, 6,
    ])('accepts week_starts_on %p (0=Sunday..6=Saturday)', day => {
      expect(
        HouseholdSchema.safeParse({ ...validHousehold, week_starts_on: day })
          .success
      ).toBe(true);
    });

    it.each([7, -1, 1.5])('rejects an out-of-range week_starts_on %p', day => {
      expect(
        HouseholdSchema.safeParse({ ...validHousehold, week_starts_on: day })
          .success
      ).toBe(false);
    });

    it('rejects a missing week_starts_on — the column is not-null', () => {
      const { week_starts_on: _week_starts_on, ...rest } = validHousehold;
      expect(HouseholdSchema.safeParse(rest).success).toBe(false);
    });
  });

  describe('CreateHouseholdSchema', () => {
    it('accepts just a name', () => {
      expect(
        CreateHouseholdSchema.safeParse({ name: 'The Reyes Family' }).success
      ).toBe(true);
    });

    it('rejects an empty name', () => {
      expect(CreateHouseholdSchema.safeParse({ name: '' }).success).toBe(false);
    });

    it('accepts an explicit currency and jurisdiction', () => {
      expect(
        CreateHouseholdSchema.safeParse({
          name: 'The Reyes Family',
          currency: 'USD',
          jurisdiction: 'NY',
        }).success
      ).toBe(true);
    });

    it('accepts a null jurisdiction (device cannot derive a US state)', () => {
      expect(
        CreateHouseholdSchema.safeParse({
          name: 'The Reyes Family',
          jurisdiction: null,
        }).success
      ).toBe(true);
    });

    it('accepts an explicit week_starts_on', () => {
      expect(
        CreateHouseholdSchema.safeParse({
          name: 'The Reyes Family',
          week_starts_on: 0,
        }).success
      ).toBe(true);
    });

    it('rejects an out-of-range week_starts_on', () => {
      expect(
        CreateHouseholdSchema.safeParse({
          name: 'The Reyes Family',
          week_starts_on: 7,
        }).success
      ).toBe(false);
    });

    it('rejects a lowercase currency code', () => {
      expect(
        CreateHouseholdSchema.safeParse({
          name: 'The Reyes Family',
          currency: 'usd',
        }).success
      ).toBe(false);
    });
  });

  describe('UpdateHouseholdSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateHouseholdSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a single field', () => {
      expect(
        UpdateHouseholdSchema.safeParse({ name: 'New Name' }).success
      ).toBe(true);
    });
  });

  describe('HouseholdIdParamSchema', () => {
    it('accepts a valid uuid', () => {
      expect(
        HouseholdIdParamSchema.safeParse({ householdId: VALID_UUID }).success
      ).toBe(true);
    });

    it('rejects a non-uuid', () => {
      expect(
        HouseholdIdParamSchema.safeParse({ householdId: '123' }).success
      ).toBe(false);
    });
  });

  describe('HouseholdMemberSchema', () => {
    const validMember = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      user_id: OTHER_UUID,
      role: 'nanny',
      can_edit: false,
      status: 'active',
      display_name_override: null,
      colour: null,
      joined_at: NOW,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid member', () => {
      expect(HouseholdMemberSchema.safeParse(validMember).success).toBe(true);
    });

    // Joined from `user_profiles` by the members-list read, so it is absent
    // on every other producer of a member row (redeem, patch) and null for a
    // member whose profile row is gone.
    it('KEEPS a joined profile_name through parse — an unknown key would be stripped', () => {
      const parsed = HouseholdMemberSchema.parse({
        ...validMember,
        profile_name: 'Bea',
      });
      expect(parsed.profile_name).toBe('Bea');
    });

    it('accepts a null profile_name (departed member) and its absence', () => {
      expect(
        HouseholdMemberSchema.safeParse({ ...validMember, profile_name: null })
          .success
      ).toBe(true);
      expect(HouseholdMemberSchema.safeParse(validMember).success).toBe(true);
    });

    it('rejects an invalid role', () => {
      expect(
        HouseholdMemberSchema.safeParse({ ...validMember, role: 'grandparent' })
          .success
      ).toBe(false);
    });
  });

  describe('UpdateHouseholdMemberSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateHouseholdMemberSchema.safeParse({}).success).toBe(false);
    });

    it('accepts a role change', () => {
      expect(
        UpdateHouseholdMemberSchema.safeParse({ role: 'parent' }).success
      ).toBe(true);
    });
  });

  describe('HouseholdInviteSchema', () => {
    const validInvite = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      code: 'R4K-92T',
      email: 'nia@example.com',
      role: 'nanny',
      invited_by: VALID_UUID,
      expires_at: NOW,
      status: 'pending',
      accepted_by: null,
      accepted_at: null,
      created_at: NOW,
      updated_at: NOW,
    };

    it('parses a valid invite', () => {
      expect(HouseholdInviteSchema.safeParse(validInvite).success).toBe(true);
    });

    it('rejects an invite role of owner', () => {
      expect(
        HouseholdInviteSchema.safeParse({ ...validInvite, role: 'owner' })
          .success
      ).toBe(false);
    });
  });

  describe('CreateHouseholdInviteSchema', () => {
    it('accepts a role with no email', () => {
      expect(
        CreateHouseholdInviteSchema.safeParse({ role: 'nanny' }).success
      ).toBe(true);
    });

    it('rejects a missing role', () => {
      expect(
        CreateHouseholdInviteSchema.safeParse({ email: 'a@b.com' }).success
      ).toBe(false);
    });
  });

  describe('UpdateHouseholdInviteSchema', () => {
    it('rejects an empty object', () => {
      expect(UpdateHouseholdInviteSchema.safeParse({}).success).toBe(false);
    });

    it('accepts revoking', () => {
      expect(
        UpdateHouseholdInviteSchema.safeParse({ status: 'revoked' }).success
      ).toBe(true);
    });

    it('rejects setting status to accepted directly', () => {
      expect(
        UpdateHouseholdInviteSchema.safeParse({ status: 'accepted' }).success
      ).toBe(false);
    });
  });

  describe('RedeemHouseholdInviteSchema', () => {
    it('accepts a code', () => {
      expect(
        RedeemHouseholdInviteSchema.safeParse({ code: 'R4K-92T' }).success
      ).toBe(true);
    });

    it('rejects an empty code', () => {
      expect(RedeemHouseholdInviteSchema.safeParse({ code: '' }).success).toBe(
        false
      );
    });
  });

  // ===========================================================================
  // 3-O — draft households (D-34/D-36) and the terms-link window (D-51/M26)
  // ===========================================================================

  describe('draft households', () => {
    const liveHousehold = {
      id: VALID_UUID,
      name: 'The Reyes Family',
      timezone: 'America/Chicago',
      address_line: null,
      latitude: null,
      longitude: null,
      approval_mode: 'either',
      approval_scope: 'short_notice_and_cancellations',
      short_notice_hours: 24,
      cancellation_paid_within_hours: 24,
      currency: 'USD',
      jurisdiction: null,
      week_starts_on: 1,
      state: 'live',
      created_by: null,
      created_at: NOW,
      updated_at: NOW,
    };
    const draft = {
      ...liveHousehold,
      id: OTHER_UUID,
      name: null,
      state: 'draft',
    };

    // §4.2: a nanny is never asked for a family name she does not have yet.
    // The draft is created with `name = null` and rendered "Untitled draft";
    // the label is asked for at the share moment, where it is finally known.
    it('accepts a draft household with no name', () => {
      const parsed = HouseholdSchema.parse(draft);
      expect(parsed.name).toBeNull();
      expect(parsed.state).toBe('draft');
    });

    it('rejects an unknown state', () => {
      expect(() =>
        HouseholdSchema.parse({ ...draft, state: 'archived' })
      ).toThrow();
    });

    // Every household that exists today is live, and every parent-created
    // household still is. The wire default keeps a client that predates the
    // field reading a server that has it.
    it('defaults an absent state to live', () => {
      const { state: _state, ...withoutState } = liveHousehold as Record<
        string,
        unknown
      >;
      expect(HouseholdSchema.parse(withoutState).state).toBe('live');
    });

    // D-36's "nothing priceable" is enforced by the membership table, not by
    // hiding buttons — so the create body may say "draft" and nothing else.
    it('lets a create body ask for a draft with no name', () => {
      expect(CreateHouseholdSchema.safeParse({ state: 'draft' }).success).toBe(
        true
      );
      expect(CreateHouseholdSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('HouseholdInviteSchema — the terms-link window', () => {
    const invite = {
      id: VALID_UUID,
      household_id: OTHER_UUID,
      code: 'R4K-92T',
      email: null,
      role: 'parent',
      invited_by: null,
      expires_at: NOW,
      status: 'pending',
      accepted_by: null,
      accepted_at: null,
      created_at: NOW,
      updated_at: NOW,
    };

    // M26/§6.1: the link and the code expire on DIFFERENT clocks. The code
    // keeps its 30 days so she can read it over the phone; the public page
    // that carries her rate is short-lived by default.
    it('carries a link_expires_at separate from the code expiry', () => {
      const parsed = HouseholdInviteSchema.parse({
        ...invite,
        link_expires_at: NOW,
      });
      expect(parsed.link_expires_at).toBe(NOW);
      expect(HouseholdInviteSchema.parse(invite).link_expires_at).toBeNull();
    });

    // §5.3: "Opened" is the web page rendering; "Viewed" is the proposal
    // opening in the app. Whether, never how many times or from where.
    it('carries a nullable opened_at and a share label', () => {
      const parsed = HouseholdInviteSchema.parse({
        ...invite,
        opened_at: NOW,
        label: 'The Bakers',
      });
      expect(parsed.opened_at).toBe(NOW);
      expect(parsed.label).toBe('The Bakers');
      expect(HouseholdInviteSchema.parse(invite).opened_at).toBeNull();
      expect(HouseholdInviteSchema.parse(invite).label).toBeNull();
    });

    it('accepts a share label and a link window on create', () => {
      const parsed = CreateHouseholdInviteSchema.parse({
        role: 'parent',
        label: 'The Bakers',
        link_expires_in_days: 7,
      });
      expect(parsed.label).toBe('The Bakers');
      expect(parsed.link_expires_in_days).toBe(7);
    });

    it('offers exactly the 7- and 30-day link windows', () => {
      expect(
        CreateHouseholdInviteSchema.safeParse({
          role: 'parent',
          link_expires_in_days: 30,
        }).success
      ).toBe(true);
      expect(
        CreateHouseholdInviteSchema.safeParse({
          role: 'parent',
          link_expires_in_days: 90,
        }).success
      ).toBe(false);
    });
  });

  /**
   * P8 — the parent's pay OFFER (098). The mirror of the nanny direction: her
   * terms ride her draft and are cloned in on redemption, his ride the invite
   * and are promoted into a `direction: 'parent'` proposal on redemption.
   *
   * The offer is exactly a `CreatePayArrangementRequest` and NOT a second,
   * looser shape, for the reason 092's header gives about `terms_proposals`:
   * one wire contract means "what he offered is what she is asked to accept"
   * is a property of the type system, not a promise in a doc.
   */
  describe('the pay offer on an invite (P8)', () => {
    const offer = { rate_minor: 2800, valid_from: '2026-09-01' };
    const invite = {
      id: VALID_UUID,
      household_id: OTHER_UUID,
      code: 'R4K-92T',
      email: null,
      role: 'nanny',
      invited_by: VALID_UUID,
      expires_at: NOW,
      status: 'pending',
      accepted_by: null,
      accepted_at: null,
      created_at: NOW,
      updated_at: NOW,
    };

    it('carries the offer on the row', () => {
      const parsed = HouseholdInviteSchema.parse({
        ...invite,
        pay_offer: offer,
      });
      expect(parsed.pay_offer?.rate_minor).toBe(2800);
      expect(parsed.pay_offer?.valid_from).toBe('2026-09-01');
    });

    // An invite with no offer is the ordinary case and must stay the cheapest
    // one to write: absent reads as null, exactly like `label` and `opened_at`
    // do since 093. This is also what stops a client shipped before 098 from
    // failing to parse a row the API has not started returning the column for.
    it('reads an absent offer as an explicit null, never undefined', () => {
      expect(HouseholdInviteSchema.parse(invite).pay_offer).toBeNull();
      expect(
        HouseholdInviteSchema.parse({ ...invite, pay_offer: null }).pay_offer
      ).toBeNull();
    });

    it('refuses an offer that is not a valid arrangement request', () => {
      expect(
        HouseholdInviteSchema.safeParse({
          ...invite,
          // Negative money. 041's non-negative floor, reached through the same
          // schema that guards the real `pay_arrangements` insert.
          pay_offer: { rate_minor: -1, valid_from: '2026-09-01' },
        }).success
      ).toBe(false);
      expect(
        HouseholdInviteSchema.safeParse({
          ...invite,
          pay_offer: { rate_minor: 2800 },
        }).success
      ).toBe(false);
    });

    it('accepts an offer on create, and stays optional there', () => {
      const parsed = CreateHouseholdInviteSchema.parse({
        role: 'nanny',
        pay_offer: offer,
      });
      expect(parsed.pay_offer?.rate_minor).toBe(2800);
      // The default that `CreatePayArrangementRequestSchema` applies survives
      // the nesting — an offer written today prices overtime the same way the
      // arrangement it becomes will.
      expect(parsed.pay_offer?.overtime_multiplier).toBe(1.5);
      expect(
        CreateHouseholdInviteSchema.parse({ role: 'nanny' }).pay_offer
      ).toBeUndefined();
    });

    it('refuses a malformed offer on create rather than dropping the field', () => {
      expect(
        CreateHouseholdInviteSchema.safeParse({
          role: 'nanny',
          pay_offer: { rate_minor: 2800, valid_from: 'next tuesday' },
        }).success
      ).toBe(false);
    });
  });
});
