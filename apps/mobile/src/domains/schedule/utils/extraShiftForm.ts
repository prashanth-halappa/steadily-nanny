/**
 * @module domains/schedule/utils/extraShiftForm
 * Pure validation for the one-off extra-shift form — testable without native pickers.
 */
import { isEndAfterStart } from '@/src/components/ui/time-range-picker.utils';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

export function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date)
  );
}

export function isValidHhmm(time: string): boolean {
  if (!HHMM.test(time)) return false;
  const [h, m] = time.split(':').map(Number);
  return (h ?? 99) <= 23 && (m ?? 99) <= 59;
}

export interface ExtraShiftFormValues {
  date: string;
  start: string;
  end: string;
  carerId: string | null;
}

export function isExtraShiftFormValid(values: ExtraShiftFormValues): boolean {
  if (!values.carerId) return false;
  if (!isValidIsoDate(values.date)) return false;
  if (!isValidHhmm(values.start) || !isValidHhmm(values.end)) return false;
  return isEndAfterStart(values.start, values.end);
}
