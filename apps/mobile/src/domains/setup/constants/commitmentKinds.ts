/**
 * @module domains/setup/constants/commitmentKinds
 *
 * i18n key (in the `household` namespace) for a stored commitment kind.
 * Callers pass `{ defaultValue: kind }` so an unknown kind still renders
 * as itself rather than as a raw key.
 */
export function commitmentKindLabelKey(kind: string): string {
  return `commitments.kind.${kind}`;
}
