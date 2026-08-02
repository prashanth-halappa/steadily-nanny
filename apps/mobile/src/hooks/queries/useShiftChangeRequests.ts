/** @module hooks/queries/useShiftChangeRequests */
import { useQuery } from '@tanstack/react-query';
import { changeRequestApi } from '@/src/api/endpoints/changeRequests';
import { queryKeys } from '@/src/api/queryKeys';

export function useShiftChangeRequests(shiftId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.shift.changeRequests(shiftId ?? undefined),
    queryFn: () => changeRequestApi.listForShift(shiftId as string),
    enabled: Boolean(shiftId),
  });
}
