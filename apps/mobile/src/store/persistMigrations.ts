/**
 * persistMigrations
 *
 * Shared migrate helper for zustand persist. Used by stores that declare an
 * explicit `version: 1` where previously they had none.
 *
 * CRITICAL: zustand's default version is 0, so every existing install on disk
 * has a {version: 0} envelope. The migrate MUST identity-map version <= 1
 * payloads — otherwise bumping to version 1 would discard everyone's persisted
 * state on upgrade (e.g. logging every user out of the auth store). Only an
 * unknown/newer version (corruption, or a downgrade from a future build) falls
 * back to initial state.
 */

export function createV1Migrate<T>(
  // Defaults to {} on the fallback path: zustand persist shallow-merges the
  // migrate result over the store's initialState, so an empty object cleanly
  // resets to defaults without each store having to restate its shape.
  getInitial: () => Partial<T> = () => ({})
): (persisted: unknown, version: number) => T {
  return (persisted: unknown, version: number): T => {
    if (version <= 1 && persisted) {
      // Same shape — keep the user's existing state.
      return persisted as T;
    }
    return getInitial() as T;
  };
}
