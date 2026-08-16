/**
 * @module domains/setup/__tests__/HouseholdDecisionSheet.test
 *
 * §8c (direction workstream 8) — the escape hatch offered BEFORE either
 * outcome, every time, when a parent who already owns a live household
 * redeems a SECOND parent-role invite. The destructive option (join & close)
 * is hidden entirely when a carer is attached to the existing household —
 * that's the one behavior fork this sheet owns; everything else is copy.
 *
 * `BottomSheetBase` (GOLDEN-FIXES #1 — never a bare `<Modal>`), same pattern
 * as the sibling `AbsorptionConfirmSheet`. Errors render inline (GOLDEN-
 * FIXES #40 — a toast is invisible over a sheet).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';
import { HouseholdDecisionSheet } from '../components/HouseholdDecisionSheet';

let sheetSource: string;
beforeAll(async () => {
  sheetSource = await Bun.file(
    join(__dirname, '../components/HouseholdDecisionSheet.tsx')
  ).text();
});

describe('HouseholdDecisionSheet', () => {
  it('uses BottomSheetBase, not a bare Modal (GOLDEN-FIXES #1)', () => {
    expect(sheetSource).toContain('BottomSheetBase');
    expect(sheetSource).not.toMatch(/<Modal[\s>]/);
  });

  it('names both households in the title and body', () => {
    const { getByTestId } = renderWithProviders(
      <HouseholdDecisionSheet
        visible
        existingName="The Okafor family"
        otherName="The Wilson family"
        nannyName={null}
        onInviteInstead={mock()}
        onJoinAndClose={mock()}
        onCancel={mock()}
      />
    );

    expect(getByTestId('household-decision-title').props.children).toBe(
      'decision.title'
    );
    expect(getByTestId('household-decision-body').props.children).toBe(
      'decision.bodyNoCarer'
    );
  });

  it('hides Join-and-close and shows the wall line when a nanny is attached', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <HouseholdDecisionSheet
        visible
        existingName="The Okafor family"
        otherName="The Wilson family"
        nannyName="Amara"
        onInviteInstead={mock()}
        onJoinAndClose={mock()}
        onCancel={mock()}
      />
    );

    expect(queryByTestId('household-decision-join-close')).toBeNull();
    expect(getByTestId('household-decision-wall')).toBeTruthy();
    expect(getByTestId('household-decision-body').props.children).toBe(
      'decision.bodyCarer'
    );
  });

  it('shows Join-and-close and no wall line when no carer is attached', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <HouseholdDecisionSheet
        visible
        existingName="The Okafor family"
        otherName="The Wilson family"
        nannyName={null}
        onInviteInstead={mock()}
        onJoinAndClose={mock()}
        onCancel={mock()}
      />
    );

    expect(getByTestId('household-decision-join-close')).toBeTruthy();
    expect(queryByTestId('household-decision-wall')).toBeNull();
  });

  it('the escape hatch is the filled primary — the recommended path is the loud button', () => {
    const { getByTestId } = renderWithProviders(
      <HouseholdDecisionSheet
        visible
        existingName="The Okafor family"
        otherName="The Wilson family"
        nannyName={null}
        onInviteInstead={mock()}
        onJoinAndClose={mock()}
        onCancel={mock()}
      />
    );

    const inviteButton = getByTestId('household-decision-invite-instead');
    const joinCloseButton = getByTestId('household-decision-join-close');
    // LoadingButton defaults to the filled 'default' variant; the
    // destructive fallback is explicitly 'ghost'.
    expect(inviteButton.props.variant ?? 'default').toBe('default');
    expect(joinCloseButton.props.variant).toBe('ghost');
  });

  it('invokes the right callback for each action', () => {
    const onInviteInstead = mock();
    const onJoinAndClose = mock();
    const onCancel = mock();
    const { getByTestId } = renderWithProviders(
      <HouseholdDecisionSheet
        visible
        existingName="The Okafor family"
        otherName="The Wilson family"
        nannyName={null}
        onInviteInstead={onInviteInstead}
        onJoinAndClose={onJoinAndClose}
        onCancel={onCancel}
      />
    );

    fireEvent.press(getByTestId('household-decision-invite-instead'));
    expect(onInviteInstead).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId('household-decision-join-close'));
    expect(onJoinAndClose).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId('household-decision-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders a failure inline in the sheet, never as a toast', () => {
    const { getByTestId } = renderWithProviders(
      <HouseholdDecisionSheet
        visible
        existingName="The Okafor family"
        otherName="The Wilson family"
        nannyName={null}
        errorMessage="errors:parentAlreadyHasHousehold"
        onInviteInstead={mock()}
        onJoinAndClose={mock()}
        onCancel={mock()}
      />
    );

    expect(getByTestId('household-decision-error')).toBeTruthy();
  });
});
