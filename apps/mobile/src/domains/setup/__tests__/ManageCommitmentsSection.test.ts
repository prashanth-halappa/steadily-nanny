/**
 * @module domains/setup/__tests__/ManageCommitmentsSection.test
 * Pattern B — child commitments UI (Wave D).
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const sectionPath = join(
  __dirname,
  '../components/ManageCommitmentsSection.tsx'
);
const formPath = join(__dirname, '../components/CommitmentFormSheet.tsx');
const managerPath = join(__dirname, '../components/ChildrenManager.tsx');
let sectionSource: string;
let formSource: string;
let managerSource: string;

beforeAll(async () => {
  sectionSource = await Bun.file(sectionPath).text();
  formSource = await Bun.file(formPath).text();
  managerSource = await Bun.file(managerPath).text();
});

describe('ManageCommitmentsSection source', () => {
  it('lists/adds/deletes commitments with key testIDs', () => {
    expect(sectionSource).toContain('useCommitments');
    expect(sectionSource).toContain('useCreateCommitment');
    expect(sectionSource).toContain('useDeleteCommitment');
    expect(sectionSource).toContain('testID={`manage-commitments-${childId}`}');
    expect(sectionSource).toContain('testID={`commitment-add-${childId}`}');
    expect(sectionSource).toContain(
      'testID={`commitment-row-${commitment.id}`}'
    );
    expect(sectionSource).toContain(
      'testID={`commitment-delete-${commitment.id}`}'
    );
    expect(sectionSource).toContain('excluded_from_cover');
    expect(sectionSource).toContain('CommitmentFormSheet');
    expect(formSource).toContain('WeekStrip');
    expect(formSource).toContain('TimeRangePicker');
    expect(formSource).toContain('commitmentKindLabelKey');
    expect(sectionSource).toContain('commitmentKindLabelKey');
  });

  it('is wired into ChildrenManager', () => {
    expect(managerSource).toContain('ManageCommitmentsSection');
  });
});
