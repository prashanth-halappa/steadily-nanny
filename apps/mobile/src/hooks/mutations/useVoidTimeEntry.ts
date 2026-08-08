/**
 * @module hooks/mutations/useVoidTimeEntry
 *
 * The carer's soft-delete of a time entry (069). Deliberately NOT optimistic
 * for the same reason as `useUpdateTimeEntry` — the server may refuse.
 */
import type { UseMutationResult } from '@tanstack/react-query';
import type { TimeEntry } from '@/src/api/endpoints/timeEntries';

export interface VoidTimeEntryVariables {
  entryId: string;
}

export function useVoidTimeEntry(): UseMutationResult<
  TimeEntry,
  Error,
  VoidTimeEntryVariables
> {
  throw new Error('not implemented');
}
