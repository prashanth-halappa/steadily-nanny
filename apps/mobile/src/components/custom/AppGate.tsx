/**
 * AppGate
 *
 * Wraps the app navigation stack and renders a blocking screen based on the
 * remote-config status (from /app/status via useAppStatus → appConfigStore).
 *
 * Priority (highest → lowest):
 *   1. killed          -> KillSwitchScreen   (no dismiss)
 *   2. maintenance     -> MaintenanceScreen  (no dismiss)
 *   3. update.required -> ForceUpdateScreen  (no dismiss)
 *   4. otherwise       -> normal app navigation
 */

import type { ReactNode } from 'react';
import { useAppConfigStore } from '@/src/store/appConfigStore';
import { ForceUpdateScreen } from './ForceUpdateScreen';
import { KillSwitchScreen } from './KillSwitchScreen';
import { MaintenanceScreen } from './MaintenanceScreen';

export function AppGate({ children }: { children: ReactNode }) {
  const status = useAppConfigStore(s => s.status);

  if (status?.status === 'killed') {
    return <KillSwitchScreen message={status.message} />;
  }
  if (status?.status === 'maintenance') {
    return <MaintenanceScreen message={status.message} />;
  }
  if (status?.update?.required) {
    return <ForceUpdateScreen update={status.update} />;
  }

  return <>{children}</>;
}
