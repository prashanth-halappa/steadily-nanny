/**
 * @module lib/__tests__/network
 *
 * D19 — direct coverage for `setupNetworkManagers`, the bridge D17's fix
 * depends on entirely: `queryClient.ts`'s `refetchOnWindowFocus: true` does
 * nothing unless something actually tells TanStack's `focusManager` when
 * the app resumes, and this is that something.
 *
 * Previously untestable: the real `@react-native-community/netinfo`
 * package throws synchronously at import time without its native module,
 * so any test statically importing this file — even transitively —
 * crashed before a `mock.module()` call inside that test file ever got a
 * chance to run (ES import evaluation order resolves the throwing import
 * first). Fixed by mocking NetInfo in the shared preload (`bun.setup.ts`)
 * instead, which is early enough to matter. See that preload's comment for
 * the full explanation.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';
import type { MockFn } from '@/src/test-utils';
import { setupNetworkManagers } from '../network';

function lastCall<T extends (...args: never[]) => unknown>(fn: MockFn<T>) {
  const call = fn.mock.calls.at(-1);
  if (!call) throw new Error('listener was never registered');
  return call;
}

describe('setupNetworkManagers', () => {
  beforeEach(() => {
    (AppState.addEventListener as MockFn).mockClear();
    (NetInfo.addEventListener as MockFn).mockClear();
  });

  it('wires focusManager to AppState — active means focused, anything else does not', () => {
    setupNetworkManagers();

    const [eventName, listener] = lastCall(
      AppState.addEventListener as MockFn<
        (type: string, cb: (state: string) => void) => { remove: () => void }
      >
    );
    expect(eventName).toBe('change');

    listener('active');
    expect(focusManager.isFocused()).toBe(true);

    listener('background');
    expect(focusManager.isFocused()).toBe(false);

    listener('inactive');
    expect(focusManager.isFocused()).toBe(false);
  });

  it('wires onlineManager to NetInfo — online unless explicitly unreachable or disconnected', () => {
    setupNetworkManagers();

    const [listener] = lastCall(
      NetInfo.addEventListener as MockFn<
        (cb: (state: unknown) => void) => () => void
      >
    );

    listener({ isConnected: true, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(true);

    listener({ isConnected: true, isInternetReachable: false });
    expect(onlineManager.isOnline()).toBe(false);

    // isInternetReachable can be null (unknown) early on — only an explicit
    // `false` counts as offline, so a fresh start doesn't flap to offline.
    listener({ isConnected: true, isInternetReachable: null });
    expect(onlineManager.isOnline()).toBe(true);

    listener({ isConnected: false, isInternetReachable: true });
    expect(onlineManager.isOnline()).toBe(false);
  });

  it('is safe to call more than once — replaces the prior listener rather than leaking it', () => {
    setupNetworkManagers();
    setupNetworkManagers();

    // Only one AppState subscription should be live: the second call's.
    const [, listener] = lastCall(
      AppState.addEventListener as MockFn<
        (type: string, cb: (state: string) => void) => { remove: () => void }
      >
    );

    expect(() => listener('active')).not.toThrow();
    expect(focusManager.isFocused()).toBe(true);
  });
});
