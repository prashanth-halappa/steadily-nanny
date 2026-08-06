/**
 * @module domains/setup/__tests__/InviteCodeCard.render.test
 *
 * Pattern B (D6a) — a parent who generates a nanny code and a co-parent code
 * back to back saw two identical cards: the picker was gone and the card said
 * nothing about WHICH role the code grants or when it dies. Both facts are
 * already on the wire (`HouseholdInvite.role` / `.expires_at`); this locks in
 * that they reach the screen.
 *
 * The i18n mock echoes keys and drops interpolation values, so the assertions
 * here are about the meta line EXISTING alongside the code (and vanishing
 * while the code is still minting); `InviteCodeCard.test.tsx` covers which
 * values are interpolated into it.
 */
import { describe, expect, it } from 'bun:test';
import type { HouseholdInvite } from '@steadily-nanny/shared-types/schemas/household.schema';
import { render } from '@testing-library/react-native';
import { InviteCodeCard } from '../components/InviteCodeCard';

const INVITE = {
  id: 'invite-1',
  household_id: 'household-1',
  code: 'R4K-92T',
  email: null,
  role: 'nanny',
  invited_by: null,
  expires_at: '2026-09-05T12:00:00.000Z',
  status: 'pending',
  accepted_by: null,
  accepted_at: null,
  created_at: '2026-08-05T12:00:00.000Z',
  updated_at: '2026-08-05T12:00:00.000Z',
} as HouseholdInvite;

describe('InviteCodeCard — role + expiry (D6a)', () => {
  it('shows the code with a meta line naming the role and expiry', () => {
    const { getByTestId } = render(
      <InviteCodeCard invite={INVITE} isError={false} onRetry={() => {}} />
    );

    expect(getByTestId('invite-code-value').props.children).toBe('R4K-92T');
    expect(getByTestId('invite-code-meta')).toBeTruthy();
  });

  it('renders no meta line while the code is still minting', () => {
    const { queryByTestId } = render(
      <InviteCodeCard invite={null} isError={false} onRetry={() => {}} />
    );

    expect(queryByTestId('invite-code-value')).toBeNull();
    expect(queryByTestId('invite-code-meta')).toBeNull();
  });

  it('still offers retry after a failed mint', () => {
    const { getByTestId } = render(
      <InviteCodeCard invite={null} isError onRetry={() => {}} />
    );

    expect(getByTestId('invite-retry-button')).toBeTruthy();
  });
});
