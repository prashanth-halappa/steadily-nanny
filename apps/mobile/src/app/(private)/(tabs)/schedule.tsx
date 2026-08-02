/**
 * @module app/(private)/(tabs)/schedule
 *
 * The parent-only "Schedule" tab (role-gated in `(tabs)/_layout.tsx`). Shows
 * the household's current schedule-pattern state (none yet / draft / sent
 * pending / accepted / declined) — see
 * `src/domains/schedule/components/SchedulePendingScreen` for the real
 * implementation. This route file previously mounted a placeholder; it is
 * now the ONE canonical `/schedule` route — a sibling
 * `(private)/schedule/index.tsx` would collide with this same path and has
 * been removed. Sub-routes (`/schedule/build`, `/schedule/shifts`,
 * `/schedule/respond/[patternId]`) still live under `(private)/schedule/`
 * and do not collide, since they resolve one segment deeper.
 */
import { SchedulePendingScreen } from '@/src/domains/schedule';

export default function ScheduleRoute() {
  return <SchedulePendingScreen />;
}
