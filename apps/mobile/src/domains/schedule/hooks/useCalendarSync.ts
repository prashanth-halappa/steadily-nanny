/**
 * @module domains/schedule/hooks/useCalendarSync
 *
 * Debounced calendar sync trigger: cold start, AppState foreground, and
 * explicit `requestCalendarSync()` after schedule mutations settle.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { runDefaultCalendarSync } from '@/src/domains/schedule/utils/calendarSyncNative';

const DEBOUNCE_MS = 1000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight: Promise<void> | null = null;
let pendingRerun = false;

function startSync(): void {
  if (syncInFlight) {
    pendingRerun = true;
    return;
  }
  syncInFlight = runDefaultCalendarSync().finally(() => {
    syncInFlight = null;
    if (pendingRerun) {
      pendingRerun = false;
      startSync();
    }
  });
}

/** Schedule a debounced sync. Safe to call from mutation onSettled. */
export function requestCalendarSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    startSync();
  }, DEBOUNCE_MS);
}

/** Test helper — flush pending debounce immediately (does not await in-flight). */
export function flushCalendarSyncForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Test helper — reset in-flight / pending state between cases. */
export async function resetCalendarSyncStateForTests(): Promise<void> {
  flushCalendarSyncForTests();
  pendingRerun = false;
  if (syncInFlight) {
    await syncInFlight.catch(() => {});
  }
  syncInFlight = null;
  pendingRerun = false;
}

/**
 * Mount once in the private shell. Cold start + foreground → debounced sync.
 */
export function useCalendarSync(): void {
  useEffect(() => {
    // RN does not emit AppState 'change' on subscribe — cold launch must sync.
    requestCalendarSync();
    const onChange = (status: AppStateStatus) => {
      if (status === 'active') requestCalendarSync();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
      sub.remove();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };
  }, []);
}
