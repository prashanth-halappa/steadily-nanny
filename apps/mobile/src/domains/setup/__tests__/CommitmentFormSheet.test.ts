/**
 * @module domains/setup/__tests__/CommitmentFormSheet.test
 * Pattern A — care-hours form sheet (inverted semantics).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const formPath = join(__dirname, '../components/CommitmentFormSheet.tsx');
let formSource: string;

beforeAll(async () => {
  formSource = await Bun.file(formPath).text();
});

describe('CommitmentFormSheet source', () => {
  it('omits the kind picker and excluded_from_cover UI', () => {
    expect(formSource).not.toContain('commitment-kind-row');
    expect(formSource).not.toContain('commitmentKindLabelKey');
    expect(formSource).not.toContain('excluded_from_cover');
    expect(formSource).not.toContain('CHILD_COMMITMENT_KINDS.PRESCHOOL');
  });

  it('defaults to a full care day and Mon–Fri', () => {
    expect(formSource).toContain("'09:00'");
    expect(formSource).toContain("'17:00'");
    expect(formSource).not.toContain("'12:00'");
    expect(formSource).toContain('[1, 2, 3, 4, 5]');
  });

  it('orders fields as days, time, optional label with helper', () => {
    expect(formSource).toContain('careHours.form.daysLabel');
    expect(formSource).toContain('careHours.form.timeLabel');
    expect(formSource).toContain('careHours.form.labelLabel');
    expect(formSource).toContain('careHours.form.labelHelper');
    const daysIdx = formSource.indexOf('careHours.form.daysLabel');
    const timeIdx = formSource.indexOf('careHours.form.timeLabel');
    const labelIdx = formSource.indexOf('careHours.form.labelLabel');
    expect(daysIdx).toBeLessThan(timeIdx);
    expect(timeIdx).toBeLessThan(labelIdx);
  });

  it('shows a live readback above submit and does not require a label', () => {
    expect(formSource).toContain('commitment-form-readback');
    expect(formSource).toContain('formatCareHoursReadback');
    expect(formSource).toContain('days.length > 0 && endTime > startTime');
  });
});
