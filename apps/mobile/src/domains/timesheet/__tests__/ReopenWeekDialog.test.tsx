/**
 * @module domains/timesheet/__tests__/ReopenWeekDialog.test
 *
 * Confirmation for parent reopen — BottomSheetBase (QueryNoteSheet sibling),
 * required reason, destructive confirm. Keyboard occlusion cannot be
 * simulated meaningfully under bun:test / RN Testing Library, so the
 * structural contract is asserted instead: this surface must host inside
 * BottomSheetBase (keyboard-aware + scroll), not AlertDialog.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render } from '@testing-library/react-native';

mock.module('@/src/components/custom/BottomSheetBase', () => {
  const R = require('react');
  return {
    BottomSheetBase: ({
      visible,
      children,
      testID,
    }: {
      visible: boolean;
      children: React.ReactNode;
      testID?: string;
    }) => (visible ? R.createElement('View', { testID }, children) : null),
  };
});

let ReopenWeekDialog: typeof import('../components/ReopenWeekDialog').ReopenWeekDialog;

beforeAll(async () => {
  ReopenWeekDialog = (await import('../components/ReopenWeekDialog'))
    .ReopenWeekDialog;
});

const reopenWeekDialogSource = readFileSync(
  join(__dirname, '../components/ReopenWeekDialog.tsx'),
  'utf8'
);

describe('ReopenWeekDialog', () => {
  it('uses BottomSheetBase (keyboard-aware), never AlertDialog', () => {
    // Render tests cannot reproduce software-keyboard occlusion of the
    // confirm button. Assert the structural fix that QueryNoteSheet already
    // uses: BottomSheetBase owns KeyboardAvoidingView + ScrollView.
    // Doc comments may name AlertDialog as the rejected precedent — ban the
    // import, not the substring (same shape as HoursScreens QueryNoteSheet).
    expect(reopenWeekDialogSource).toContain('BottomSheetBase');
    expect(reopenWeekDialogSource).not.toMatch(
      /from\s+'@\/src\/components\/ui\/alert-dialog'/
    );
    expect(reopenWeekDialogSource).toContain('fitContent');
  });

  it('hosts the confirm control inside the BottomSheetBase tree', () => {
    const { getByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    // testID is on BottomSheetBase itself (same as QueryNoteSheet) — if this
    // still used AlertDialog, the BottomSheetBase mock would not own it.
    const sheet = getByTestId('hours-reopen-dialog');
    expect(sheet).toBeTruthy();
    expect(getByTestId('hours-reopen-dialog-confirm')).toBeTruthy();
  });

  it('shows the reopen body and collects a reason before confirm fires', () => {
    const onConfirm = mock();
    const { getByTestId, getByText } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    expect(getByTestId('hours-reopen-dialog-title').props.children).toBe(
      'reopenDialogTitle'
    );
    expect(getByTestId('hours-reopen-dialog-body').props.children).toBe(
      'reopenDialogBody'
    );
    // Walkthrough fix 3: the dialog compels a reason and must say plainly
    // what happens to it (nothing in mobile reads the reopen audit event —
    // it is kept on the household's record) and make the requirement
    // legible on its own, not just via the confirm button's disabled state.
    expect(getByTestId('hours-reopen-dialog-reason-hint').props.children).toBe(
      'reopenDialogReasonHint'
    );
    expect(getByText('reopenDialogCancel')).toBeTruthy();
    expect(getByText('reopenDialogConfirm')).toBeTruthy();

    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      true
    );

    fireEvent.changeText(
      getByTestId('hours-reopen-dialog-reason'),
      'Thursday hours were wrong'
    );
    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      false
    );

    fireEvent.press(getByTestId('hours-reopen-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('Thursday hours were wrong');
  });

  it('disables confirm while submitting', () => {
    const { getByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting
        weekRangeLabel="3 – 9 August"
      />
    );

    fireEvent.changeText(
      getByTestId('hours-reopen-dialog-reason'),
      'Need a correction'
    );
    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      true
    );
  });

  it('renders nothing when open is false', () => {
    const { queryByTestId } = render(
      <ReopenWeekDialog
        open={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    expect(queryByTestId('hours-reopen-dialog-title')).toBeNull();
  });

  it('cancel dismisses via onOpenChange without confirming', () => {
    const onOpenChange = mock();
    const onConfirm = mock();
    const { getByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    fireEvent.press(getByTestId('hours-reopen-dialog-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
