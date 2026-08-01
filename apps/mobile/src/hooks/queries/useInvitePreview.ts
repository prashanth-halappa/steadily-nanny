import { useQuery } from '@tanstack/react-query';
import { householdApi } from '@/src/api/endpoints/household';
import { queryKeys } from '@/src/api/queryKeys';
import { useAuthStore } from '@/src/store/auth';

/**
 * Previews a household invite by its human-transcribable code (e.g.
 * `R4K-92T`) before the nanny redeems it — shows household name + children
 * first names only.
 */
export function useInvitePreview(code: string) {
  const session = useAuthStore(s => s.session);
  const isInitialized = useAuthStore(s => s.isInitialized);
  const trimmed = code.trim();

  return useQuery({
    queryKey: queryKeys.household.invitePreview(trimmed),
    queryFn: () => householdApi.previewInvite(trimmed),
    enabled: !!session && isInitialized && trimmed.length > 0,
    retry: false,
  });
}
