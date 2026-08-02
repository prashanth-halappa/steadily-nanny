/**
 * @module SoftUpdateBannerTests
 *
 * Render tests (Pattern B) — banner visibility is driven by appConfigStore
 * update flags; only non-required updates should surface.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { AppStatusResponse } from '@steadily-nanny/shared-types/appConfig';
import { render } from '@testing-library/react-native';
import { useAppConfigStore } from '@/src/store/appConfigStore';

let SoftUpdateBanner: typeof import('../SoftUpdateBanner').SoftUpdateBanner;

const baseStatus: AppStatusResponse = {
  status: 'ok',
  update: {
    required: false,
    available: false,
    currentVersion: '1.0.0',
    latestVersion: '1.0.0',
    minimumVersion: '1.0.0',
    storeUrl: 'https://apps.apple.com/app/example',
  },
  announcements: [],
};

beforeAll(async () => {
  SoftUpdateBanner = (await import('../SoftUpdateBanner')).SoftUpdateBanner;
});

beforeEach(() => {
  useAppConfigStore.setState({ status: null, dismissedAnnouncementIds: [] });
});

describe('SoftUpdateBanner', () => {
  it('renders nothing when no update is available', () => {
    useAppConfigStore.getState().setStatus(baseStatus);
    const { queryByTestId } = render(<SoftUpdateBanner />);
    expect(queryByTestId('soft-update-banner')).toBeNull();
  });

  it('renders when a soft update is available (required is false)', () => {
    useAppConfigStore.getState().setStatus({
      ...baseStatus,
      update: { ...baseStatus.update, available: true, latestVersion: '1.1.0' },
    });
    const { getByTestId, getByText } = render(<SoftUpdateBanner />);
    expect(getByTestId('soft-update-banner')).toBeTruthy();
    expect(getByText('softUpdateBanner.message')).toBeTruthy();
    expect(getByText('softUpdateBanner.update')).toBeTruthy();
    expect(getByText('softUpdateBanner.dismiss')).toBeTruthy();
  });

  it('does not render when update.required is true', () => {
    useAppConfigStore.getState().setStatus({
      ...baseStatus,
      update: {
        ...baseStatus.update,
        available: true,
        required: true,
        latestVersion: '2.0.0',
      },
    });
    const { queryByTestId } = render(<SoftUpdateBanner />);
    expect(queryByTestId('soft-update-banner')).toBeNull();
  });
});
