import { beforeEach, describe, expect, it } from 'bun:test';
import { useNotificationStore } from '../notificationStore';

const DAY_MS = 24 * 60 * 60 * 1000;
// A fixed reference "now" keeps every timestamp calculation deterministic.
const NOW = 1_700_000_000_000;

beforeEach(() => {
  useNotificationStore.getState().reset();
});

describe('useNotificationStore — canPrompt (golden 3-attempt / 7-day)', () => {
  it('allows the first prompt on fresh state', () => {
    expect(useNotificationStore.getState().canPrompt(NOW)).toBe(true);
  });

  it('blocks a prompt within 7 days of the last one', () => {
    useNotificationStore.getState().recordPrompt(NOW);
    expect(useNotificationStore.getState().canPrompt(NOW + 3 * DAY_MS)).toBe(
      false
    );
  });

  it('re-surfaces the prompt after 7+ days', () => {
    useNotificationStore.getState().recordPrompt(NOW);
    expect(useNotificationStore.getState().canPrompt(NOW + 8 * DAY_MS)).toBe(
      true
    );
  });

  it('never prompts more than 3 times total, even after the resurface delay', () => {
    useNotificationStore.getState().recordPrompt(NOW);
    useNotificationStore.getState().recordPrompt(NOW + 8 * DAY_MS);
    useNotificationStore.getState().recordPrompt(NOW + 16 * DAY_MS);

    expect(useNotificationStore.getState().attempts).toBe(3);
    expect(useNotificationStore.getState().canPrompt(NOW + 30 * DAY_MS)).toBe(
      false
    );
  });
});

describe('useNotificationStore — actions', () => {
  it('recordPrompt increments attempts and stamps the time', () => {
    useNotificationStore.getState().recordPrompt(NOW);
    const state = useNotificationStore.getState();
    expect(state.attempts).toBe(1);
    expect(state.lastPromptAt).toBe(NOW);
  });

  it('reset restores initial state', () => {
    useNotificationStore.getState().recordPrompt(NOW);
    useNotificationStore.getState().reset();
    const state = useNotificationStore.getState();
    expect(state.attempts).toBe(0);
    expect(state.lastPromptAt).toBeNull();
  });
});
