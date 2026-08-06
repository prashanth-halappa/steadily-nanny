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
      expect(values.sort()).toEqual(
        ['either', 'ask_other', 'owner_only'].sort()
      );
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
      expect(values.sort()).toEqual(['active', 'removed'].sort());
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
      approval_timeout_minutes: 120,
      short_notice_hours: 24,
      cancellation_paid_within_hours: 24,
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
});
