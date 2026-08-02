/**
 * @module AnnouncementModalTests
 *
 * Render tests (Pattern B) against the REAL `BottomSheetBase`.
 *
 * These deliberately do NOT `mock.module` `BottomSheetBase` away. An earlier
 * version of this file replaced it with a bare `<RNModal>`, which meant the
 * sheet's mount effect — the half of the mechanism this component's gate has
 * to cooperate with — never ran. That made a P0 render loop invisible under a
 * green suite:
 *
 *   render (activeSheetId null) -> BottomSheetBase mounts -> its effect calls
 *   openSheet('announcement') -> store change -> AnnouncementModal re-renders
 *   -> its gate saw `activeSheetId !== null` and returned null (it was reading
 *   its OWN registration as "another sheet is open") -> BottomSheetBase
 *   unmounts -> cleanup calls closeSheet() -> store change -> re-render ->
 *   mounts again -> ... until React aborts with "Maximum update depth
 *   exceeded".
 *
 * `<AnnouncementModal />` is mounted unconditionally in
 * `app/(private)/_layout.tsx`, so this hit any user on any private screen with
 * a live announcement. The loop is only reachable when the real registration
 * effect runs, hence: no BottomSheetBase mock in this file, ever.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { AppStatusResponse } from '@steadily-nanny/shared-types/appConfig';
import { act } from '@testing-library/react-native';
import { useAppConfigStore } from '@/src/store/appConfigStore';
import { useBottomSheetStore } from '@/src/store/bottomSheetStore';
import { renderWithProviders } from '@/src/test-utils';
import { AnnouncementModal } from '../AnnouncementModal';

/**
 * Stated as a literal rather than imported from the component: this is the
 * wire-level sheet id the store and every other sheet coordinate on, so the
 * test should pin it independently of whatever the source calls its constant.
 */
const ANNOUNCEMENT_SHEET_ID = 'announcement';

let announcementSource: string;

const baseStatus: AppStatusResponse = {
  status: 'ok',
  update: {
    required: false,
    available: false,
    currentVersion: '1.0.0',
    latestVersion: '1.0.0',
    minimumVersion: '1.0.0',
    storeUrl: '',
  },
  announcements: [],
};

const LIVE_ANNOUNCEMENT = {
  id: 'ann-1',
  title: 'Scheduled maintenance',
  body: 'We will be down tonight.',
  type: 'info' as const,
  dismissible: true,
};

function setAnnouncements(announcements: AppStatusResponse['announcements']) {
  useAppConfigStore.getState().setStatus({ ...baseStatus, announcements });
}

/**
 * Records every `activeSheetId` transition for the duration of `run`. The loop
 * shows up here as an unbounded openSheet/closeSheet oscillation; a healthy
 * mount registers exactly once.
 */
function recordSheetTransitions(run: () => void): (string | null)[] {
  const transitions: (string | null)[] = [];
  const unsubscribe = useBottomSheetStore.subscribe(state => {
    transitions.push(state.activeSheetId);
  });
  try {
    run();
  } finally {
    unsubscribe();
  }
  return transitions;
}

beforeAll(async () => {
  announcementSource = await Bun.file(
    new URL('../AnnouncementModal.tsx', import.meta.url).pathname
  ).text();
});

beforeEach(() => {
  useAppConfigStore.setState({ status: null, dismissedAnnouncementIds: [] });
  useBottomSheetStore.setState({ activeSheetId: null });
});

describe('AnnouncementModal — registration loop (P0)', () => {
  it('registers itself as the active sheet exactly once and stays mounted', () => {
    setAnnouncements([LIVE_ANNOUNCEMENT]);

    let rendered: ReturnType<typeof renderWithProviders> | undefined;
    const transitions = recordSheetTransitions(() => {
      rendered = renderWithProviders(<AnnouncementModal />);
    });

    // Exactly one transition: the sheet's own registration. Any further entry
    // is the unmount/remount loop.
    expect(transitions).toEqual([ANNOUNCEMENT_SHEET_ID]);
    expect(useBottomSheetStore.getState().activeSheetId).toBe(
      ANNOUNCEMENT_SHEET_ID
    );
    expect(rendered?.getByTestId('announcement-modal')).toBeTruthy();
    expect(rendered?.getByText('Scheduled maintenance')).toBeTruthy();
  });

  it('does not re-register or tear itself down when the store settles', () => {
    setAnnouncements([LIVE_ANNOUNCEMENT]);
    const { getByTestId, rerender } = renderWithProviders(
      <AnnouncementModal />
    );

    const transitions = recordSheetTransitions(() => {
      rerender(<AnnouncementModal />);
    });

    // A re-render with the sheet already registered must not touch the store.
    expect(transitions).toEqual([]);
    expect(useBottomSheetStore.getState().activeSheetId).toBe(
      ANNOUNCEMENT_SHEET_ID
    );
    expect(getByTestId('announcement-modal')).toBeTruthy();
  });

  it('yields to a sheet that opens while it is showing, without clobbering it', () => {
    setAnnouncements([LIVE_ANNOUNCEMENT]);
    const { queryByTestId } = renderWithProviders(<AnnouncementModal />);
    expect(useBottomSheetStore.getState().activeSheetId).toBe(
      ANNOUNCEMENT_SHEET_ID
    );

    const transitions = recordSheetTransitions(() => {
      act(() => {
        useBottomSheetStore.getState().openSheet('some-other-sheet');
      });
    });

    // The announcement steps aside, and its unmount cleanup must NOT close the
    // sheet that displaced it — that would be the loop in another costume.
    expect(queryByTestId('announcement-modal')).toBeNull();
    expect(transitions).toEqual(['some-other-sheet']);
    expect(useBottomSheetStore.getState().activeSheetId).toBe(
      'some-other-sheet'
    );
  });

  it('releases the active sheet on unmount', () => {
    setAnnouncements([LIVE_ANNOUNCEMENT]);
    const { unmount } = renderWithProviders(<AnnouncementModal />);
    expect(useBottomSheetStore.getState().activeSheetId).toBe(
      ANNOUNCEMENT_SHEET_ID
    );

    unmount();

    expect(useBottomSheetStore.getState().activeSheetId).toBeNull();
  });
});

describe('AnnouncementModal', () => {
  it('renders through the sanctioned BottomSheetBase, not a bare RN Modal', () => {
    setAnnouncements([LIVE_ANNOUNCEMENT]);
    const { getByTestId } = renderWithProviders(<AnnouncementModal />);

    // Structural proof the real wrapper is in the tree: a bare RN <Modal>
    // could not produce the sheet's backdrop and drag handle (GOLDEN-FIXES #1).
    expect(getByTestId('bottom-sheet-backdrop')).toBeTruthy();
    expect(getByTestId('bottom-sheet-handle')).toBeTruthy();
    expect(getByTestId('bottom-sheet-close-button')).toBeTruthy();

    // Supplementary source guard — the structural check above cannot see a
    // stray `import { Modal } from 'react-native'` that is merely unused yet.
    expect(announcementSource).toContain('BottomSheetBase');
    expect(announcementSource).not.toMatch(
      /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*['"]react-native['"]/
    );
  });

  it('renders nothing when there are no announcements', () => {
    setAnnouncements([]);
    const { queryByTestId } = renderWithProviders(<AnnouncementModal />);
    expect(queryByTestId('announcement-modal')).toBeNull();
    expect(useBottomSheetStore.getState().activeSheetId).toBeNull();
  });

  it('renders the first eligible announcement', () => {
    setAnnouncements([LIVE_ANNOUNCEMENT]);
    const { getByTestId, getByText } = renderWithProviders(
      <AnnouncementModal />
    );
    expect(getByTestId('announcement-modal')).toBeTruthy();
    expect(getByText('Scheduled maintenance')).toBeTruthy();
    expect(getByText('We will be down tonight.')).toBeTruthy();
  });

  it('does not show when another bottom sheet is already active', () => {
    useBottomSheetStore.setState({ activeSheetId: 'some-other-sheet' });
    setAnnouncements([LIVE_ANNOUNCEMENT]);

    const { queryByTestId } = renderWithProviders(<AnnouncementModal />);

    expect(queryByTestId('announcement-modal')).toBeNull();
    // Mutual exclusion: the other sheet keeps the store.
    expect(useBottomSheetStore.getState().activeSheetId).toBe(
      'some-other-sheet'
    );
  });

  it('shows when activeSheetId is null and an announcement is present', () => {
    useBottomSheetStore.setState({ activeSheetId: null });
    setAnnouncements([LIVE_ANNOUNCEMENT]);
    const { getByTestId } = renderWithProviders(<AnnouncementModal />);
    expect(getByTestId('announcement-modal')).toBeTruthy();
  });

  it('renders nothing when the announcement was dismissed', () => {
    setAnnouncements([
      {
        id: 'ann-dismissed',
        title: 'Old news',
        body: 'Already seen.',
        type: 'info',
        dismissible: true,
      },
    ]);
    useAppConfigStore.getState().dismissAnnouncement('ann-dismissed');
    const { queryByTestId } = renderWithProviders(<AnnouncementModal />);
    expect(queryByTestId('announcement-modal')).toBeNull();
  });

  it('renders nothing when the announcement is expired', () => {
    setAnnouncements([
      {
        id: 'ann-expired',
        title: 'Expired notice',
        body: 'No longer relevant.',
        type: 'info',
        dismissible: true,
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    const { queryByTestId } = renderWithProviders(<AnnouncementModal />);
    expect(queryByTestId('announcement-modal')).toBeNull();
  });
});
