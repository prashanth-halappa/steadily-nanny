/**
 * @module domains/draft/__tests__/fixtures
 *
 * Shared wire-shaped fixtures for the draft-home tests. Not a test file — no
 * `describe`, so the one-file-per-process runner walks past it.
 */
import type {
  Household,
  HouseholdInvite,
} from '@steadily-nanny/shared-types/schemas/household.schema';
import type { TermsProposal } from '@steadily-nanny/shared-types/schemas/termsProposal.schema';

export const NANNY_ID = '11111111-1111-4111-8111-111111111111';
export const DRAFT_ID = '22222222-2222-4222-8222-222222222222';

export const draftHousehold: Household = {
  id: DRAFT_ID,
  // §4.2: she was never asked for a family name, so a draft genuinely has
  // none. Everything that renders it must say "Untitled draft".
  name: null,
  timezone: 'America/Chicago',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  currency: 'USD',
  jurisdiction: null,
  week_starts_on: 1,
  state: 'draft',
  created_by: NANNY_ID,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

export const liveHousehold: Household = {
  ...draftHousehold,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'The Ahmeds',
  state: 'live',
};

/**
 * $28.00/hr, overtime after 40h, 50 guaranteed hours. The server says
 * $1,540.00 a week; `28 × 50` says $1,400.00. Every terms test uses these
 * numbers so a client-side multiply cannot pass unnoticed (§17, D23).
 */
export const draftProposal: TermsProposal = {
  id: '44444444-4444-4444-8444-444444444444',
  household_id: DRAFT_ID,
  carer_id: NANNY_ID,
  proposed_by: NANNY_ID,
  direction: 'carer',
  status: 'proposed',
  terms: {
    rate_minor: 2800,
    currency: 'USD',
    overtime_threshold_minutes: 2400,
    overtime_multiplier: 1.5,
    guaranteed_minutes_per_week: 3000,
    cancellation_paid_within_hours: 24,
    valid_from: '2026-08-17',
  },
  note: null,
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Marisol',
  weekly_equivalent_minor: 154000,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: '2026-08-05T00:00:00.000Z',
  updated_at: '2026-08-05T00:00:00.000Z',
};

export function makeInvite(
  overrides: Partial<HouseholdInvite> = {}
): HouseholdInvite {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    household_id: DRAFT_ID,
    code: 'R4K-92T',
    email: null,
    role: 'nanny',
    invited_by: NANNY_ID,
    expires_at: '2026-09-09T00:00:00.000Z',
    status: 'pending',
    accepted_by: null,
    accepted_at: null,
    link_expires_at: '2026-08-17T00:00:00.000Z',
    opened_at: null,
    label: 'The Bakers',
    created_at: '2026-08-10T09:00:00.000Z',
    updated_at: '2026-08-10T09:00:00.000Z',
    ...overrides,
  };
}
