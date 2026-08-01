import { beforeEach, describe, expect, it } from 'bun:test';
import type { AppStatusResponse } from '@steadily-nanny/shared-types/appConfig';
import { useAppConfigStore } from '../appConfigStore';

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

beforeEach(() => {
  useAppConfigStore.setState({ status: null, dismissedAnnouncementIds: [] });
});

describe('useAppConfigStore', () => {
  it('starts with no status and no dismissed announcements', () => {
    const state = useAppConfigStore.getState();
    expect(state.status).toBeNull();
    expect(state.dismissedAnnouncementIds).toEqual([]);
  });

  it('setStatus stores the response', () => {
    useAppConfigStore.getState().setStatus(baseStatus);
    expect(useAppConfigStore.getState().status).toEqual(baseStatus);
  });

  it('dismissAnnouncement adds an id', () => {
    useAppConfigStore.getState().dismissAnnouncement('ann-1');
    expect(useAppConfigStore.getState().dismissedAnnouncementIds).toContain(
      'ann-1'
    );
  });

  it('dismissAnnouncement does not add duplicates', () => {
    useAppConfigStore.getState().dismissAnnouncement('ann-1');
    useAppConfigStore.getState().dismissAnnouncement('ann-1');
    const ids = useAppConfigStore.getState().dismissedAnnouncementIds;
    expect(ids.filter(id => id === 'ann-1').length).toBe(1);
  });

  it('getBetaAllPro fails closed when no status is set', () => {
    expect(useAppConfigStore.getState().getBetaAllPro()).toBe(false);
  });

  it('getBetaAllPro reflects the status flag when true', () => {
    useAppConfigStore.getState().setStatus({ ...baseStatus, betaAllPro: true });
    expect(useAppConfigStore.getState().getBetaAllPro()).toBe(true);
  });

  it('getBetaAllPro fails closed when the flag is omitted', () => {
    useAppConfigStore.getState().setStatus(baseStatus);
    expect(useAppConfigStore.getState().getBetaAllPro()).toBe(false);
  });
});
