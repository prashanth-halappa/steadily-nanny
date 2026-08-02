/**
 * @module components/ui/__tests__/time-range-picker.i18n.test
 * Pattern A — TimeRangePicker labels and error (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const pickerPath = join(__dirname, '../time-range-picker.tsx');
let pickerSource: string;

beforeAll(async () => {
  pickerSource = await Bun.file(pickerPath).text();
});

describe('TimeRangePicker i18n', () => {
  it('localizes labels and error through common namespace keys', () => {
    expect(pickerSource).toContain("useTranslation('common')");
    expect(pickerSource).toContain("t('timeRange.start')");
    expect(pickerSource).toContain("t('timeRange.end')");
    expect(pickerSource).toContain("t('timeRange.endAfterStart')");
    expect(pickerSource).not.toContain('>Start<');
    expect(pickerSource).not.toContain('>End<');
    expect(pickerSource).not.toContain('End time must be after start time.');
  });
});
