import { WidgetDetailScreen } from '@/src/domains/widget';

/**
 * Thin route file — the domain screen lives in domains/widget/components. The
 * "widget ready" push deep-links here as `/widget/<id>` (see the push routeMap in
 * AppBootstrap).
 */
export default function WidgetDetailRoute() {
  return <WidgetDetailScreen />;
}
