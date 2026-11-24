/** @module hooks/mutations/useAcceptLegal — record acceptance of the current legal version. */
import type { LegalStatus } from '@steadily-nanny/shared-types';
import { CURRENT_LEGAL_VERSION } from '@steadily-nanny/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { legalApi } from '@/src/api/endpoints/legal';
import { queryKeys } from '@/src/api/queryKeys';
import { appIdentity } from '@/src/config/appIdentity';

/**
 * Records explicit acceptance of `CURRENT_LEGAL_VERSION`.
 * Writes the returned `LegalStatus` directly into the cache on success so the
 * gate unblocks immediately, and invalidates the status query on error so a
 * 409 (`LEGAL_VERSION_MISMATCH`) refetches the server's current status.
 */
export function useAcceptLegal() {
  const queryClient = useQueryClient();

  return useMutation<LegalStatus, Error, void>({
    mutationFn: () => {
      const platform =
        Platform.OS === 'ios'
          ? 'ios'
          : Platform.OS === 'android'
            ? 'android'
            : 'web';
      const appVersion: string | undefined = appIdentity.version || undefined;

      return legalApi.accept({
        version: CURRENT_LEGAL_VERSION,
        platform,
        ...(appVersion ? { appVersion } : {}),
      });
    },
    onSuccess: data => {
      queryClient.setQueryData(queryKeys.legal.status(), data);
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.legal.status(),
      });
    },
  });
}
