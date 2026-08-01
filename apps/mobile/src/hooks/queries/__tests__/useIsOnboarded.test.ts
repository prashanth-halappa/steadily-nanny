/**
 * @module hooks/queries/__tests__/useIsOnboarded.test
 * Covers: isOnboarded mirrors setupProgress.isComplete exactly.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderHookWithProviders } from '@/src/test-utils';
import { useIsOnboarded } from '../useIsOnboarded';

beforeEach(() => {
  useSetupProgressStore.getState().reset();
});

describe('useIsOnboarded', () => {
  it('is false before the setup flow completes', () => {
    const { result } = renderHookWithProviders(() => useIsOnboarded());
    expect(result.current).toBe(false);
  });

  it('is true once setupProgress.isComplete is set', () => {
    useSetupProgressStore.getState().complete();
    const { result } = renderHookWithProviders(() => useIsOnboarded());
    expect(result.current).toBe(true);
  });
});
