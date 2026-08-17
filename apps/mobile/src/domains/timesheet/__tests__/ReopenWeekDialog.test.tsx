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

  it('shows the paid warning when paidToDateLabel is set', () => {
    const { getByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        paidToDateLabel="£120.00"
      />
    );

    expect(getByTestId('hours-reopen-dialog-paid-warning').props.children).toBe(
      'reopenDialogBodyPaidWarning'
    );
  });

  it('omits the paid warning when paidToDateLabel is null', () => {
    const { queryByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        paidToDateLabel={null}
      />
    );

    expect(queryByTestId('hours-reopen-dialog-paid-warning')).toBeNull();
  });

  // WP-P1(B): the server's refusal is rendered HERE, in the dialog, because
  // a toast over a BottomSheetBase is invisible (GOLDEN-FIXES #40).
  it('renders the refusal inline and keeps the typed reason', () => {
    const { getByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
        refusal="reopen.refusedPaid"
      />
    );

    fireEvent.changeText(
      getByTestId('hours-reopen-dialog-reason'),
      'Thursday hours were wrong'
    );
    fireEvent.press(getByTestId('hours-reopen-dialog-confirm'));

    expect(getByTestId('hours-reopen-dialog-refusal')).toBeTruthy();
    // Confirming must not wipe the field — the dialog now stays open through
    // a refusal, and retyping a reason you already gave is the whole bug.
    expect(getByTestId('hours-reopen-dialog-reason').props.value).toBe(
      'Thursday hours were wrong'
    );
  });

  it('renders no refusal band when there is nothing to refuse', () => {
    const { queryByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    expect(queryByTestId('hours-reopen-dialog-refusal')).toBeNull();
  });

  it('forgets the typed reason once the dialog closes, however it closed', () => {
    // The dialog now survives a refusal, so `handleConfirm` can no longer
    // clear the field — it has to survive one. The reset therefore hangs off
    // CLOSING, and it has to cover the success path too: `ParentWeekView`
    // closes the sheet by flipping `open`, not by calling `onOpenChange`, so
    // a reset wired only to the cancel handler would prefill next week's
    // reopen with last week's reason. That reason is written to the
    // append-only `timesheet_reopened` event, so a stale one is a wrong entry
    // on the household's permanent record, not just an untidy field.
    const { getByTestId, rerender, queryByTestId } = render(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );

    fireEvent.changeText(
      getByTestId('hours-reopen-dialog-reason'),
      'Thursday hours were wrong'
    );
    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      false
    );

    // Closed the way the success path closes it: the `open` prop, nothing else.
    rerender(
      <ReopenWeekDialog
        open={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="3 – 9 August"
      />
    );
    expect(queryByTestId('hours-reopen-dialog-reason')).toBeNull();

    rerender(
      <ReopenWeekDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        isSubmitting={false}
        weekRangeLabel="10 – 16 August"
      />
    );

    expect(getByTestId('hours-reopen-dialog-reason').props.value).toBe('');
    expect(getByTestId('hours-reopen-dialog-confirm').props.disabled).toBe(
      true
    );
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
