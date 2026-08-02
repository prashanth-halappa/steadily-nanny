/**
 * @module app/(private)/schedule/shifts/[shiftId]
 * Route: `/schedule/shifts/:shiftId` — shift detail + day thread (D23/D24).
 */
import { ShiftDetailScreen } from '@/src/domains/schedule/components/ShiftDetailScreen';

export default function ShiftDetailRoute() {
  return <ShiftDetailScreen />;
}
