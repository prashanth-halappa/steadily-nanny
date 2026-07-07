/**
 * notificationStore.ts
 *
 * iOS soft-ask permission primer state. Before triggering the real OS
 * permission dialog, the app shows a soft-ask ("Enable notifications?")
 * primer. This store caps how often that primer resurfaces so a user who
 * declines isn't nagged: at most MAX_ATTEMPTS times total, and no sooner than
 * RESURFACE_DAYS after the last prompt. Persisted to MMKV so the caps survive
 * app restarts.
 *
 * GOLDEN behavior — preserve the 3-attempt / 7-day resurface logic.
 */

import { createPersistedStore } from './createPersistedStore';

/** Maximum number of times the soft-ask primer may be shown. */
const MAX_ATTEMPTS = 3;
/** Days to wait before resurfacing the primer after a prompt. */
const RESURFACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface NotificationState {
  /** How many times the soft-ask primer has been shown. */
  attempts: number;
  /** Epoch ms of the last prompt (null if never prompted). */
  lastPromptAt: number | null;

  /**
   * Whether the soft-ask primer may be shown right now. True when BOTH:
   * 1. attempts < MAX_ATTEMPTS, and
   * 2. it was never shown, or the last prompt was >= RESURFACE_DAYS ago.
   * `now` defaults to Date.now() (injectable for deterministic tests).
   */
  canPrompt: (now?: number) => boolean;
  /** Record that the primer was shown: increments attempts + stamps the time. */
  recordPrompt: (now?: number) => void;
  /** Reset primer state (e.g. on account switch). */
  reset: () => void;
}

export const useNotificationStore = createPersistedStore<NotificationState>(
  (set, get) => ({
    attempts: 0,
    lastPromptAt: null,

    canPrompt: (now = Date.now()) => {
      const { attempts, lastPromptAt } = get();
      // Hit the attempt cap — never prompt again.
      if (attempts >= MAX_ATTEMPTS) return false;
      // Never prompted — safe to show the first time.
      if (lastPromptAt === null) return true;
      // Otherwise wait out the resurface window.
      const daysSince = (now - lastPromptAt) / DAY_MS;
      return daysSince >= RESURFACE_DAYS;
    },

    recordPrompt: (now = Date.now()) =>
      set(state => ({
        attempts: state.attempts + 1,
        lastPromptAt: now,
      })),

    reset: () => set({ attempts: 0, lastPromptAt: null }),
  }),
  {
    name: 'notification-primer-storage',
    version: 1,
    partialize: state => ({
      attempts: state.attempts,
      lastPromptAt: state.lastPromptAt,
    }),
  }
);
