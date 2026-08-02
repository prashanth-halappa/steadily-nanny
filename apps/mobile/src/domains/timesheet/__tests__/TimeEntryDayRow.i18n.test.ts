/**
 * @module domains/timesheet/__tests__/TimeEntryDayRow.i18n.test
 * Pattern A — TimeEntryDayRow weekday and status copy (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const rowPath = join(__dirname, '../components/TimeEntryDayRow.tsx');
let rowSource: string;

beforeAll(async () => {
  rowSource = await Bun.file(rowPath).text();
});

describe('TimeEntryDayRow i18n', () => {
  it('labels weekdays via schedule:weekday.* and localizes row copy', () => {
    expect(rowSource).toContain("useTranslation('hours')");
    expect(rowSource).toContain('schedule:weekday.');
    expect(rowSource).toContain("t('noHoursLogged')");
    expect(rowSource).toContain("t('inProgress')");
    expect(rowSource).not.toContain('WEEKDAY_LABELS');
    expect(rowSource).not.toContain('No hours logged');
    expect(rowSource).not.toMatch(/:\s*'in progress'/);
  });
});
