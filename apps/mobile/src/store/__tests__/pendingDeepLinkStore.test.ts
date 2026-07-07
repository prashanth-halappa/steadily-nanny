import { beforeEach, describe, expect, it } from 'bun:test';
import {
  PENDING_DEEP_LINK_TTL_MS,
  usePendingDeepLinkStore,
} from '../pendingDeepLinkStore';

const HREF = '/home/details';

beforeEach(() => {
  usePendingDeepLinkStore.setState({ pendingHref: null, setAt: null });
});

describe('usePendingDeepLinkStore', () => {
  it('stores a pending link with a timestamp', () => {
    usePendingDeepLinkStore.getState().setPendingLink(HREF, 1000);
    expect(usePendingDeepLinkStore.getState().pendingHref).toBe(HREF);
    expect(usePendingDeepLinkStore.getState().setAt).toBe(1000);
  });

  it('consume returns the link and clears it', () => {
    usePendingDeepLinkStore.getState().setPendingLink(HREF, 1000);
    const consumed = usePendingDeepLinkStore
      .getState()
      .consumePendingLink(1000);
    expect(consumed).toBe(HREF);
    expect(usePendingDeepLinkStore.getState().pendingHref).toBeNull();
  });

  it('consume returns null when there is no pending link', () => {
    expect(usePendingDeepLinkStore.getState().consumePendingLink(0)).toBeNull();
  });

  it('drops a link older than the TTL on consume', () => {
    usePendingDeepLinkStore.getState().setPendingLink(HREF, 1000);
    const consumed = usePendingDeepLinkStore
      .getState()
      .consumePendingLink(1000 + PENDING_DEEP_LINK_TTL_MS + 1);
    expect(consumed).toBeNull();
    expect(usePendingDeepLinkStore.getState().pendingHref).toBeNull();
  });

  it('returns a link consumed exactly at the TTL boundary', () => {
    usePendingDeepLinkStore.getState().setPendingLink(HREF, 1000);
    const consumed = usePendingDeepLinkStore
      .getState()
      .consumePendingLink(1000 + PENDING_DEEP_LINK_TTL_MS);
    expect(consumed).toBe(HREF);
  });
});
