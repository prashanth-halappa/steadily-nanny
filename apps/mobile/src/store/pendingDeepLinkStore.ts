/**
 * pendingDeepLinkStore.ts
 *
 * Holds a deep link tapped while the app can't yet navigate to it (logged out,
 * or a cold start before auth settles) so it can be replayed once routing is
 * ready. Intentionally NOT persisted: the tap and the replay happen within the
 * same process. A link older than PENDING_DEEP_LINK_TTL_MS is dropped on
 * consume so the user isn't yanked somewhere unexpected long after the fact.
 */

import { create } from 'zustand';

/** Drop a pending link that wasn't consumed within this window (10 minutes). */
export const PENDING_DEEP_LINK_TTL_MS = 10 * 60_000;

export interface PendingDeepLinkState {
  /** The pending deep-link href, or null when none is queued. */
  pendingHref: string | null;
  /** Epoch ms the link was captured (null when none is queued). */
  setAt: number | null;
  /** Capture a deep link to replay later. nowMs defaults to Date.now(). */
  setPendingLink: (href: string, nowMs?: number) => void;
  /** Return + clear the pending link, or null if absent/stale. */
  consumePendingLink: (nowMs?: number) => string | null;
}

export const usePendingDeepLinkStore = create<PendingDeepLinkState>(
  (set, get) => ({
    pendingHref: null,
    setAt: null,
    setPendingLink: (href, nowMs = Date.now()) => {
      set({ pendingHref: href, setAt: nowMs });
    },
    consumePendingLink: (nowMs = Date.now()) => {
      const { pendingHref, setAt } = get();
      set({ pendingHref: null, setAt: null });
      if (!pendingHref || setAt === null) {
        return null;
      }
      if (nowMs - setAt > PENDING_DEEP_LINK_TTL_MS) {
        return null;
      }
      return pendingHref;
    },
  })
);
