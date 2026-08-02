import { beforeEach, describe, expect, it } from 'bun:test';
import { useActiveHouseholdStore } from '../activeHousehold';

beforeEach(() => {
  useActiveHouseholdStore.getState().reset();
});

describe('useActiveHouseholdStore', () => {
  it('starts with no preference', () => {
    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBeNull();
  });

  it('setPreferredHouseholdId records the chosen household', () => {
    useActiveHouseholdStore.getState().setPreferredHouseholdId('household-1');
    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBe(
      'household-1'
    );
  });

  it('setPreferredHouseholdId overwrites a prior preference', () => {
    useActiveHouseholdStore.getState().setPreferredHouseholdId('household-1');
    useActiveHouseholdStore.getState().setPreferredHouseholdId('household-2');
    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBe(
      'household-2'
    );
  });

  it('reset clears the preference', () => {
    useActiveHouseholdStore.getState().setPreferredHouseholdId('household-1');
    useActiveHouseholdStore.getState().reset();
    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBeNull();
  });
});
