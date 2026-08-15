import { describe, expect, it } from 'bun:test';
import {
  AcceptTermsProposalRequestSchema,
  CreateTermsProposalRequestSchema,
  OPEN_TERMS_PROPOSAL_STATUSES,
  TERMS_PROPOSAL_DIRECTIONS,
  TERMS_PROPOSAL_STATUSES,
  TermsProposalListResponseSchema,
  TermsProposalSchema,
} from '../src/schemas/termsProposal.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
const THIRD_UUID = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-08-10T10:00:00Z';

/** The minimum a proposal's `terms` bag must carry — a CreatePayArrangementRequest. */
const VALID_TERMS = {
  rate_minor: 2800,
  currency: 'USD',
  overtime_multiplier: 1.5,
  valid_from: '2026-08-17',
};

const validProposal = {
  id: VALID_UUID,
  household_id: OTHER_UUID,
  carer_id: THIRD_UUID,
  proposed_by: THIRD_UUID,
  direction: 'carer',
  status: 'proposed',
  terms: VALID_TERMS,
  note: null,
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Marisol M.',
  weekly_equivalent_minor: null,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: NOW,
  updated_at: NOW,
};

describe('termsProposal.schema', () => {
  describe('const-maps match the SQL check constraints', () => {
    it('TERMS_PROPOSAL_STATUSES matches terms_proposals.status (097)', () => {
      const values: string[] = Object.values(TERMS_PROPOSAL_STATUSES);
      expect(values.sort()).toEqual(
        ['proposed', 'countered', 'accepted', 'withdrawn', 'declined'].sort()
      );
    });

    it('TERMS_PROPOSAL_DIRECTIONS matches terms_proposals.direction', () => {
      const values: string[] = Object.values(TERMS_PROPOSAL_DIRECTIONS);
      expect(values.sort()).toEqual(['carer', 'parent'].sort());
    });
  });

  // B4: declined is TERMINAL, exactly like withdrawn/accepted/countered — a
  // round the counterparty refused is not still awaiting an answer. This is
  // load-bearing for mobile's `findOpenTermsProposal`
  // (useTermsProposals.ts), which drives whether the pay screen shows a live
  // negotiation and whether PaySetupPromptCard hides.
  describe('OPEN_TERMS_PROPOSAL_STATUSES', () => {
    it('stays exactly [proposed] — declined never counts as open', () => {
      expect(OPEN_TERMS_PROPOSAL_STATUSES).toEqual(['proposed']);
      expect(OPEN_TERMS_PROPOSAL_STATUSES).not.toContain('declined');
    });
  });

  describe('TermsProposalSchema', () => {
    it('accepts a well-formed carer-authored proposal', () => {
      expect(TermsProposalSchema.parse(validProposal).status).toBe('proposed');
    });

    it('accepts a declined proposal — the counterparty`s refusal (B4)', () => {
      const parsed = TermsProposalSchema.parse({
        ...validProposal,
        status: 'declined',
        responded_at: NOW,
      });
      expect(parsed.status).toBe('declined');
    });

    it('rejects an unknown status', () => {
      expect(() =>
        TermsProposalSchema.parse({ ...validProposal, status: 'rejected' })
      ).toThrow();
    });

    it('rejects an unknown direction', () => {
      expect(() =>
        TermsProposalSchema.parse({ ...validProposal, direction: 'helper' })
      ).toThrow();
    });

    // §7.2 / D-23: the weekly figure is ALWAYS the server-computed value, so
    // it must exist on the wire. Nullable, never absent-and-guessed: a client
    // that cannot read it must render nothing, not `rate x hours`.
    it('carries a nullable server-computed weekly_equivalent_minor', () => {
      const parsed = TermsProposalSchema.parse({
        ...validProposal,
        weekly_equivalent_minor: 154000,
      });
      expect(parsed.weekly_equivalent_minor).toBe(154000);
      expect(
        TermsProposalSchema.parse(validProposal).weekly_equivalent_minor
      ).toBeNull();
    });

    // Append-only in spirit: a counter is a NEW row pointing at the one it
    // answered, never an edit of it.
    it('links a counter to the row it superseded', () => {
      const parsed = TermsProposalSchema.parse({
        ...validProposal,
        direction: 'parent',
        supersedes_id: VALID_UUID,
      });
      expect(parsed.supersedes_id).toBe(VALID_UUID);
    });

    it('rejects a terms bag with no rate', () => {
      expect(() =>
        TermsProposalSchema.parse({
          ...validProposal,
          terms: { currency: 'USD', valid_from: '2026-08-17' },
        })
      ).toThrow();
    });
  });

  describe('CreateTermsProposalRequestSchema', () => {
    it('accepts terms plus an optional note', () => {
      const parsed = CreateTermsProposalRequestSchema.parse({
        terms: VALID_TERMS,
        note: 'Starting Monday',
      });
      expect(parsed.terms.rate_minor).toBe(2800);
      expect(parsed.note).toBe('Starting Monday');
    });

    it('accepts a counter naming the proposal it answers', () => {
      const parsed = CreateTermsProposalRequestSchema.parse({
        terms: VALID_TERMS,
        supersedes_id: VALID_UUID,
      });
      expect(parsed.supersedes_id).toBe(VALID_UUID);
    });

    // The client never picks its own direction, status, or carer — the
    // service resolves all three from the caller's membership. A body that
    // could set them is a body that could propose as somebody else.
    it('strips direction, status and carer_id from the request body', () => {
      const parsed = CreateTermsProposalRequestSchema.parse({
        terms: VALID_TERMS,
        direction: 'parent',
        status: 'accepted',
        carer_id: OTHER_UUID,
      }) as Record<string, unknown>;
      expect(parsed.direction).toBeUndefined();
      expect(parsed.status).toBeUndefined();
      expect(parsed.carer_id).toBeUndefined();
    });

    it('refuses a future valid_from beyond the D-16 horizon shape', () => {
      // The horizon itself is enforced server-side against household-local
      // today; the wire only guarantees the field is a real ISO date.
      expect(() =>
        CreateTermsProposalRequestSchema.parse({
          terms: { ...VALID_TERMS, valid_from: 'next monday' },
        })
      ).toThrow();
    });
  });

  describe('AcceptTermsProposalRequestSchema', () => {
    // D-7 at the binding act: the checkbox is recorded ON the acceptance, and
    // an acceptance without it is not an acceptance.
    it('requires the responsibility confirmation to be true', () => {
      expect(
        AcceptTermsProposalRequestSchema.parse({
          responsibility_confirmed: true,
        }).responsibility_confirmed
      ).toBe(true);
      expect(() =>
        AcceptTermsProposalRequestSchema.parse({
          responsibility_confirmed: false,
        })
      ).toThrow();
      expect(() => AcceptTermsProposalRequestSchema.parse({})).toThrow();
    });
  });

  describe('TermsProposalListResponseSchema', () => {
    it('wraps a list under terms_proposals', () => {
      const parsed = TermsProposalListResponseSchema.parse({
        terms_proposals: [validProposal],
      });
      expect(parsed.terms_proposals).toHaveLength(1);
    });
  });
});
