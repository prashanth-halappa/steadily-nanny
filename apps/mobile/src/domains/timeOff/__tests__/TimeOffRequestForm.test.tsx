/**
 * @module domains/timeOff/__tests__/TimeOffRequestForm.test
 *
 * Source-inspection guard for submit gating and busy-block query skipping
 * when the date range is inverted.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const componentPath = join(__dirname, '../components/TimeOffRequestForm.tsx');
let source: string;

beforeAll(async () => {
  source = await Bun.file(componentPath).text();
});

describe('TimeOffRequestForm', () => {
  it('gates submit on a valid start/end date range', () => {
    expect(source).toContain('dateRangeValid');
    expect(source).toContain('isEndOnOrAfterStart');
    expect(source).toContain('time-off-request-submit');
    expect(source).toContain('time-off-edit-submit');
    expect(source).toContain(
      '!dateRangeValid || (activeMutation?.isPending ?? false)'
    );
  });

  it('skips the busy-blocks query while the range is invalid', () => {
    expect(source).toMatch(
      /dateRangeValid \? rangeStart : null[\s\S]{0,40}dateRangeValid \? rangeEnd : null/
    );
  });
});
