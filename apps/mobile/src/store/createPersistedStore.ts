/**
 * createPersistedStore — one wrapper for the zustand + MMKV persist boilerplate.
 *
 * Every persisted client store in the app is created through this helper so the
 * MMKV storage adapter, JSON serialization, versioning, and the safe
 * `createV1Migrate` default are wired identically in one place.
 *
 * @example
 * interface CounterState { count: number; inc: () => void; }
 * export const useCounter = createPersistedStore<CounterState>(
 *   set => ({ count: 0, inc: () => set(s => ({ count: s.count + 1 })) }),
 *   { name: 'counter-storage', partialize: s => ({ count: s.count }) },
 * );
 */
import { create, type StateCreator } from 'zustand';
import {
  createJSONStorage,
  type PersistOptions,
  persist,
} from 'zustand/middleware';
import { zustandSecureStorage, zustandStorage } from '@/src/lib/mmkvStorage';
import { createV1Migrate } from './persistMigrations';

export interface CreatePersistedStoreOptions<T> {
  /** Persist key (unique per store). */
  name: string;
  /** Schema version — bump when the persisted shape changes. Defaults to 1. */
  version?: number;
  /** Use the ENCRYPTED MMKV instance (for auth/session data). Defaults to false. */
  secure?: boolean;
  /** Persist only durable fields; exclude transient flags (isLoading, etc.). */
  partialize?: PersistOptions<T, Partial<T>>['partialize'];
  /** Override the default identity-map migrate (see createV1Migrate). */
  migrate?: PersistOptions<T, Partial<T>>['migrate'];
  /** Run logic after rehydration (e.g. daily-TTL cleanup). */
  onRehydrateStorage?: PersistOptions<T, Partial<T>>['onRehydrateStorage'];
}

export function createPersistedStore<T>(
  initializer: StateCreator<T, [['zustand/persist', unknown]], []>,
  options: CreatePersistedStoreOptions<T>
) {
  const {
    name,
    version = 1,
    secure = false,
    partialize,
    migrate,
    onRehydrateStorage,
  } = options;

  const persistOptions: PersistOptions<T, Partial<T>> = {
    name,
    version,
    storage: createJSONStorage(() =>
      secure ? zustandSecureStorage : zustandStorage
    ),
    migrate: migrate ?? createV1Migrate<T>(),
    ...(partialize ? { partialize } : {}),
    ...(onRehydrateStorage ? { onRehydrateStorage } : {}),
  };

  return create<T>()(persist(initializer, persistOptions));
}
