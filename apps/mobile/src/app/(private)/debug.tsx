/**
 * Debug / verification cockpit (DEV-ONLY).
 *
 * The template's manual verification harness: each control drives a REAL kit seam
 * so VERIFICATION.md can assert an observable outcome. Reachable from Settings
 * behind `__DEV__`; a direct deep-link in a release build renders nothing useful.
 *
 * This screen is part of the widget example — remove it (and the Settings link)
 * when you strip the example out.
 */

import { onlineManager } from '@tanstack/react-query';
import type { AppStatusResponse } from '@yourapp/shared-types/appConfig';
import { type ReactNode, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { type UsageStatus, widgetApi } from '@/src/api/endpoints/widgets';
import { Button } from '@/src/components/ui/button';
import { Card, CardContent } from '@/src/components/ui/card';
import { Text } from '@/src/components/ui/text';
import { Body, H1, H4, Small } from '@/src/components/ui/typography';
import { appIdentity } from '@/src/config/appIdentity';
import { showInfoToast } from '@/src/lib/toast';
import { useAppConfigStore } from '@/src/store/appConfigStore';
import { useRatingStore } from '@/src/store/ratingStore';
import { maybeRequestReview } from '@/src/utils/maybeRequestReview';

// Simulated kill/force screens auto-restore after this delay so the tester is
// never stranded on a no-dismiss blocking screen.
const SIMULATED_RESTORE_MS = 4000;

/** A minimal, valid "everything ok" remote-config payload. */
function baseStatus(): AppStatusResponse {
  return {
    status: 'ok',
    update: {
      required: false,
      available: false,
      currentVersion: appIdentity.version,
      latestVersion: appIdentity.version,
      minimumVersion: appIdentity.version,
      storeUrl: '',
    },
    announcements: [],
    betaAllPro: false,
  };
}

function DebugRow({
  title,
  assertion,
  children,
}: {
  title: string;
  assertion: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="gap-2 py-4">
        <H4>{title}</H4>
        <Small className="text-muted-foreground">VERIFY: {assertion}</Small>
        {children}
      </CardContent>
    </Card>
  );
}

export default function DebugScreen() {
  const status = useAppConfigStore(s => s.status);
  const [forcedOffline, setForcedOffline] = useState(false);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [usageError, setUsageError] = useState(false);

  if (!__DEV__) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Body className="text-muted-foreground">
          Debug tools are only available in development.
        </Body>
      </View>
    );
  }

  // 1. Kill switch — drive appConfigStore so AppGate swaps to KillSwitchScreen.
  const simulateKill = () => {
    useAppConfigStore.getState().setStatus({
      ...baseStatus(),
      status: 'killed',
      message: {
        title: 'App unavailable',
        body: 'Simulated kill switch (debug).',
      },
    });
    setTimeout(
      () => useAppConfigStore.getState().setStatus(baseStatus()),
      SIMULATED_RESTORE_MS
    );
  };

  // 2. Force update — set update.required so AppGate swaps to ForceUpdateScreen.
  const simulateForceUpdate = () => {
    const b = baseStatus();
    useAppConfigStore.getState().setStatus({
      ...b,
      update: { ...b.update, required: true, storeUrl: 'https://example.com' },
    });
    setTimeout(
      () => useAppConfigStore.getState().setStatus(baseStatus()),
      SIMULATED_RESTORE_MS
    );
  };

  // 4. Offline — drive TanStack's onlineManager so OfflineBanner shows.
  const toggleOffline = () => {
    const next = !forcedOffline;
    setForcedOffline(next);
    onlineManager.setOnline(!next);
  };

  // 3. Rating — no debug bypass is exposed, so force the positive-signal path.
  const triggerRating = async () => {
    useRatingStore.getState().recordPositiveSignal();
    const requested = await maybeRequestReview('debug');
    showInfoToast(
      requested
        ? 'Review prompt requested'
        : 'Review prompt suppressed (cadence/availability)'
    );
  };

  // 5. Widget quota — the widget_creation counter from subscription/usage.
  const fetchUsage = async () => {
    setUsageError(false);
    try {
      setUsage(await widgetApi.getWidgetUsage());
    } catch {
      setUsageError(true);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 24, paddingBottom: 100, gap: 12 }}
      testID="debug-screen"
    >
      <H1>Debug cockpit</H1>
      <Small className="text-muted-foreground">
        Dev-only verification harness. Each control drives a real kit seam so
        VERIFICATION.md can assert the observable outcome.
      </Small>

      <DebugRow
        title="1. Kill switch"
        assertion="KillSwitchScreen replaces the app for ~4s, then restores."
      >
        <Button testID="debug-kill-switch" onPress={simulateKill}>
          <Text>Simulate kill switch</Text>
        </Button>
      </DebugRow>

      <DebugRow
        title="2. Force update"
        assertion="ForceUpdateScreen replaces the app for ~4s, then restores."
      >
        <Button testID="debug-force-update" onPress={simulateForceUpdate}>
          <Text>Simulate force update</Text>
        </Button>
      </DebugRow>

      <DebugRow
        title="3. Rating prompt"
        assertion="Native review prompt is requested, or a toast reports it was suppressed by cadence."
      >
        <Button testID="debug-rating" onPress={() => void triggerRating()}>
          <Text>Trigger rating prompt</Text>
        </Button>
      </DebugRow>

      <DebugRow
        title="4. Offline banner"
        assertion="The global OfflineBanner appears while forced offline."
      >
        <Button
          testID="debug-offline-toggle"
          variant={forcedOffline ? 'destructive' : 'secondary'}
          onPress={toggleOffline}
        >
          <Text>{forcedOffline ? 'Go back online' : 'Simulate offline'}</Text>
        </Button>
      </DebugRow>

      <DebugRow
        title="5. Widget quota"
        assertion="Shows used/limit for widget_creation from GET /v1/subscription/usage."
      >
        <Button
          testID="debug-fetch-usage"
          variant="outline"
          onPress={() => void fetchUsage()}
        >
          <Text>Fetch widget quota</Text>
        </Button>
        {usageError ? (
          <Small className="text-destructive">Failed to load usage.</Small>
        ) : usage ? (
          <Small testID="debug-usage-value" className="text-foreground">
            {usage.feature}: {usage.used}/{usage.limit ?? '∞'} used,{' '}
            {usage.remaining ?? '∞'} left
          </Small>
        ) : (
          <Small className="text-muted-foreground">Not fetched yet.</Small>
        )}
      </DebugRow>

      <DebugRow
        title="6. Raw /app/status"
        assertion="Shows the current remote-config payload held in appConfigStore."
      >
        <View className="rounded-xl bg-muted p-3">
          <Text testID="debug-app-status" className="text-xs">
            {status
              ? JSON.stringify(status, null, 2)
              : 'No status fetched yet.'}
          </Text>
        </View>
      </DebugRow>
    </ScrollView>
  );
}
