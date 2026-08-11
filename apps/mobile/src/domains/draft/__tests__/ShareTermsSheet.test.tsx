/**
 * @module domains/draft/__tests__/ShareTermsSheet
 *
 * §6.1. Three things are load-bearing and each has a test:
 *
 *  - The 7-day link window is the DEFAULT. It is the second of Marisol's
 *    three standing conditions for her rate being on a public page at all
 *    (D-51); flipping the default to 30 re-opens that decision silently.
 *  - What gets shared is the LINK, not the bare code. A code in a text
 *    message is a support ticket; a link is a real number and a real name in
 *    four seconds.
 *  - The code stays on screen after sharing, so she can read it over the
 *    phone.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { renderWithProviders } from '@/src/test-utils';
import { ShareTermsSheet } from '../components/ShareTermsSheet';
import { makeInvite } from './fixtures';

// `Share.share` is already a `mock()` in `bun.setup.ts`'s react-native stub —
// re-mocking the whole module here would clobber every other primitive.
const shareSpy = Share.share as unknown as ReturnType<typeof mock>;

describe('ShareTermsSheet', () => {
  beforeEach(() => {
    shareSpy.mockClear();
  });

  it('selects the 7-day link window by default', () => {
    const { getByTestId } = renderWithProviders(
      <ShareTermsSheet
        visible
        onDismiss={mock()}
        invite={null}
        isMinting={false}
        isError={false}
        onCreate={mock(() => Promise.resolve(makeInvite()))}
        nannyName="Marisol"
      />
    );

    expect(
      getByTestId('draft-share-window-7').props.accessibilityState
    ).toEqual({ selected: true });
    expect(
      getByTestId('draft-share-window-30').props.accessibilityState
    ).toEqual({ selected: false });
  });

  it('mints with the 7-day window and her private label', async () => {
    const onCreate = mock(() => Promise.resolve(makeInvite()));
    const { getByTestId } = renderWithProviders(
      <ShareTermsSheet
        visible
        onDismiss={mock()}
        invite={null}
        isMinting={false}
        isError={false}
        onCreate={onCreate}
        nannyName="Marisol"
      />
    );

    fireEvent.changeText(getByTestId('draft-share-label'), 'The Bakers');
    fireEvent.press(getByTestId('draft-share-submit'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
      label: 'The Bakers',
      linkExpiresInDays: 7,
    });
  });

  it('sends the 30-day window only when she picks it', async () => {
    const onCreate = mock(() => Promise.resolve(makeInvite()));
    const { getByTestId } = renderWithProviders(
      <ShareTermsSheet
        visible
        onDismiss={mock()}
        invite={null}
        isMinting={false}
        isError={false}
        onCreate={onCreate}
        nannyName="Marisol"
      />
    );

    fireEvent.press(getByTestId('draft-share-window-30'));
    fireEvent.press(getByTestId('draft-share-submit'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({ linkExpiresInDays: 30 });
  });

  it('hands the OS a message only once the server has issued the code', async () => {
    const { getByTestId } = renderWithProviders(
      <ShareTermsSheet
        visible
        onDismiss={mock()}
        invite={null}
        isMinting={false}
        isError={false}
        onCreate={mock(() => Promise.resolve(makeInvite()))}
        nannyName="Marisol"
      />
    );

    fireEvent.press(getByTestId('draft-share-submit'));

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    // The sentence itself is pinned in `shareMessage.test.ts` — the harness's
    // `t()` echoes keys without interpolating, so it is not observable here.
    expect(shareSpy.mock.calls[0]?.[0]).toHaveProperty('message');
  });

  it('keeps the code visible once minted, for reading over the phone', () => {
    const { getByTestId } = renderWithProviders(
      <ShareTermsSheet
        visible
        onDismiss={mock()}
        invite={makeInvite()}
        isMinting={false}
        isError={false}
        onCreate={mock(() => Promise.resolve(makeInvite()))}
        nannyName="Marisol"
      />
    );

    expect(getByTestId('invite-code-value').props.children).toBe('R4K-92T');
  });

  it('renders a failure inline in the sheet, never as a toast', () => {
    const { getByTestId } = renderWithProviders(
      <ShareTermsSheet
        visible
        onDismiss={mock()}
        invite={null}
        isMinting={false}
        isError
        onCreate={mock(() => Promise.resolve(makeInvite()))}
        nannyName="Marisol"
      />
    );

    expect(getByTestId('draft-share-error')).toBeTruthy();
  });

  it('never shares when minting failed — no link to a code that does not exist', async () => {
    const onCreate = mock(() => Promise.reject(new Error('offline')));
    const { getByTestId } = renderWithProviders(
      <ShareTermsSheet
        visible
        onDismiss={mock()}
        invite={null}
        isMinting={false}
        isError={false}
        onCreate={onCreate}
        nannyName="Marisol"
      />
    );

    fireEvent.press(getByTestId('draft-share-submit'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(shareSpy).not.toHaveBeenCalled();
  });
});
