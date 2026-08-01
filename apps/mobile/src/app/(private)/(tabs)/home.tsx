/**
 * @module app/(private)/(tabs)/home
 *
 * "Today" — the first tab after setup, for both roles. See
 * `src/domains/today/components/TodayScreen` for the real implementation.
 */
import { TodayScreen } from '@/src/domains/today';

export default function HomeScreen() {
  return <TodayScreen />;
}
