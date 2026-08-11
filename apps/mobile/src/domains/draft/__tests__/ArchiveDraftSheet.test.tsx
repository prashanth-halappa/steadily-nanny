/**
 * @module domains/draft/__tests__/ArchiveDraftSheet
 *
 * §5.4. The second consequence line is the one that matters: after D-38's
 * copy-on-redeem, archiving genuinely cannot reach a family she already
 * connected with, and saying so is what makes archive a safe button rather
 * than a scary one.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';
import { ArchiveDraftSheet } from '../components/ArchiveDraftSheet';

describe('ArchiveDraftSheet', () => {
  it('states both consequences before asking her to confirm', () => {
    const { getByTestId } = renderWithProviders(
      <ArchiveDraftSheet
        visible
        onDismiss={mock()}
        onConfirm={mock()}
        isArchiving={false}
        isError={false}
      />
    );

    expect(getByTestId('draft-archive-consequence-codes').props.children).toBe(
      'archive.consequenceCodes'
    );
    expect(getByTestId('draft-archive-consequence-joined').props.children).toBe(
      'archive.consequenceJoined'
    );
  });

  it('archives only on the explicit confirm', () => {
    const onConfirm = mock();
    const { getByTestId } = renderWithProviders(
      <ArchiveDraftSheet
        visible
        onDismiss={mock()}
        onConfirm={onConfirm}
        isArchiving={false}
        isError={false}
      />
    );

    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('draft-archive-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders a failure inline in the sheet, never as a toast', () => {
    const { getByTestId } = renderWithProviders(
      <ArchiveDraftSheet
        visible
        onDismiss={mock()}
        onConfirm={mock()}
        isArchiving={false}
        isError
      />
    );

    expect(getByTestId('draft-archive-error')).toBeTruthy();
  });
});
