/**
 * @module domains/setup/__tests__/ManageCommitmentsSection.test
 * Pattern B — recurring care-hours UI (inverted semantics).
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
  it('lists/adds/deletes care hours with key testIDs', () => {
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
    expect(sectionSource).not.toContain('excluded_from_cover');
    expect(sectionSource).toContain('CommitmentFormSheet');
    expect(formSource).toContain('WeekStrip');
    expect(formSource).toContain('TimeRangePicker');
  });

  it('uses careHours copy, Card elevation, and childName in section body', () => {
    expect(sectionSource).toContain('careHours.');
    expect(sectionSource).not.toContain("'commitments.");
    expect(sectionSource).not.toContain('commitmentKindLabelKey');
    expect(sectionSource).not.toContain('border border-border');
    expect(sectionSource).toContain('Card');
    expect(sectionSource).toContain('childName');
    expect(sectionSource).toContain('careHours.sectionBody');
  });

  it('leads rows with time range and days; label is optional second line', () => {
    expect(sectionSource).toContain('formatCareHoursPrimary');
    expect(sectionSource).toContain('commitment.label');
  });

  it('shows an empty state when no hours are configured', () => {
    expect(sectionSource).toContain('careHours.emptyTitle');
    expect(sectionSource).toContain('careHours.emptyBody');
    expect(sectionSource).toContain('commitment-empty');
  });

  it('gives delete a full 44pt touch target', () => {
    expect(sectionSource).toContain('h-touch w-touch');
  });

  it('always submits kind other to the API', () => {
    expect(sectionSource).toContain('CHILD_COMMITMENT_KINDS.OTHER');
  });

  it('is wired into ChildrenManager with childName', () => {
    expect(managerSource).toContain('ManageCommitmentsSection');
    expect(managerSource).toContain('childName={child.name}');
  });
});
