import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { appConfigApi } from '@/src/api/endpoints/appConfig';
import { queryKeys } from '@/src/api/queryKeys';
import { appIdentity } from '@/src/config/appIdentity';
import { QUERY_TIMING } from '@/src/hooks/queries/utils';
import { useAppConfigStore } from '@/src/store/appConfigStore';
import { useSubscriptionStore } from '@/src/store/subscriptionStore';

/**
 * Fetches the pre-auth remote-config status (kill switch, maintenance, force
 * update, announcements, betaAllPro) and mirrors it into the app-config store,
 * applying the beta Pro override. Drives `AppGate`.
 */
export function useAppStatus() {
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const query = useQuery({
    queryKey: queryKeys.appConfig.status(),
    queryFn: () => appConfigApi.getStatus(appIdentity.version, platform),
    staleTime: QUERY_TIMING.STALE_5M,
  });

  const setStatus = useAppConfigStore(s => s.setStatus);
  const applyBetaOverride = useSubscriptionStore(s => s.applyBetaOverride);

  useEffect(() => {
    if (query.data) {
      setStatus(query.data);
      applyBetaOverride(query.data.betaAllPro ?? false);
    }
  }, [query.data, setStatus, applyBetaOverride]);

  return query;
}
