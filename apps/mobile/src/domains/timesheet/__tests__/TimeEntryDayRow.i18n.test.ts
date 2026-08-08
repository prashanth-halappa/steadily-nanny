/**
 * @module domains/timesheet/__tests__/TimeEntryDayRow.i18n.test
 * Pattern A — weekday and status copy live in the right components (Wave 2G).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const dayRowPath = join(__dirname, '../components/TimeEntryDayRow.tsx');
const entryRowPath = join(__dirname, '../components/TimeEntryRow.tsx');
let dayRowSource: string;
let entryRowSource: string;

beforeAll(async () => {
  dayRowSource = await Bun.file(dayRowPath).text();
  entryRowSource = await Bun.file(entryRowPath).text();
});

describe('TimeEntryDayRow i18n', () => {
  it('labels weekdays via schedule:weekday.* and localizes row copy', () => {
    expect(dayRowSource).toContain("useTranslation('hours')");
    expect(dayRowSource).toContain('schedule:weekday.');
    expect(dayRowSource).toContain("t('noHoursLogged')");
    expect(dayRowSource).not.toContain('WEEKDAY_LABELS');
    expect(dayRowSource).not.toContain('No hours logged');
    expect(dayRowSource).not.toMatch(/:\s*'in progress'/);
  });

  it('keeps entry-level status strings in TimeEntryRow', () => {
    expect(entryRowSource).toContain("useTranslation('hours')");
    expect(entryRowSource).toContain("t('inProgress')");
    expect(entryRowSource).toContain("t('voided')");
    expect(entryRowSource).toContain("t('entryBreak'");
    expect(entryRowSource).not.toMatch(/:\s*'in progress'/);
  });
});
