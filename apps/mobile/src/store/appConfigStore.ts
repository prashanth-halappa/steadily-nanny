/**
 * appConfigStore.ts
 *
 * Remote-config state from the /app/status endpoint. The full status response
 * is kept in memory (re-fetched each launch); only the set of dismissed
 * announcement IDs is persisted so a dismissed banner stays dismissed across
 * restarts.
 */

import type { AppStatusResponse } from '@yourapp/shared-types/appConfig';
import { createPersistedStore } from './createPersistedStore';

export interface AppConfigState {
  /** Latest remote-config status (in-memory; null until first fetch). */
  status: AppStatusResponse | null;
  /** IDs of announcements the user has dismissed (persisted). */
  dismissedAnnouncementIds: string[];

  /** Store the latest status response. */
  setStatus: (status: AppStatusResponse) => void;
  /** Mark an announcement dismissed (deduplicated). */
  dismissAnnouncement: (id: string) => void;

  /**
   * Whether the beta "all users get Pro" override is active. Fails CLOSED: a
   * missing/unfetched status never grants paid access.
   */
  getBetaAllPro: () => boolean;
}

export const useAppConfigStore = createPersistedStore<AppConfigState>(
  (set, get) => ({
    status: null,
    dismissedAnnouncementIds: [],

    setStatus: status => set({ status }),

    dismissAnnouncement: id =>
      set(state =>
        state.dismissedAnnouncementIds.includes(id)
          ? state
          : {
              dismissedAnnouncementIds: [...state.dismissedAnnouncementIds, id],
            }
      ),

    getBetaAllPro: () => get().status?.betaAllPro ?? false,
  }),
  {
    name: 'app-config-storage',
    version: 1,
    // Persist only the dismissed IDs; status is re-fetched each launch.
    partialize: state => ({
      dismissedAnnouncementIds: state.dismissedAnnouncementIds,
    }),
  }
);
