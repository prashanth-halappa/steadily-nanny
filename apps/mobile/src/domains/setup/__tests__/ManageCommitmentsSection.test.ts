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

describe('ManageCommitmentsSection — confirm-as-usual-week offer (P3.3)', () => {
  it('offers the usual-week confirmation at the point of entry, routed to the builder', () => {
    // The gap: care hours were saved and nothing at all routed the parent
    // from "hours saved" to "build your usual week" — a second, hidden flow
    // they had to stumble into.
    expect(sectionSource).toContain('careHours.confirmWeekBody');
    expect(sectionSource).toContain('careHours.confirmWeekCta');
    expect(sectionSource).toContain(
      'testID={`commitment-confirm-week-${childId}`}'
    );
    expect(sectionSource).toContain("'/(private)/schedule/build'");
  });

  it('gates the offer on an ACTIVE NANNY existing — before that the button dead-ends on the carer picker', () => {
    // Load-bearing: during onboarding INVITE is the NEXT step, so with
    // nobody hired the wizard has no carer to build a week for.
    expect(sectionSource).toContain('useHouseholdCarers');
    expect(sectionSource).toContain('hasActiveNanny');
  });

  it('hides the offer once a pattern has been accepted, and until both gating queries have resolved', () => {
    expect(sectionSource).toContain('useSchedulePatterns');
    expect(sectionSource).toContain('SCHEDULE_PATTERN_STATUSES.ACCEPTED');
    expect(sectionSource).toMatch(/canOfferWeek[\s\S]{0,300}isLoading/);
  });

  it('shows nothing before the child has any care hours at all', () => {
    expect(sectionSource).toMatch(/canOfferWeek\s*=\s*\n?\s*!isEmpty/);
  });

  it('writes nothing — the offer is navigation only, never a derived write', () => {
    expect(sectionSource).not.toContain('useCreateSchedulePattern');
    expect(sectionSource).not.toContain('mutateAsync');
  });
});

describe('careHours confirm-week copy', () => {
  const localesRoot = join(__dirname, '../../../i18n/locales');
  const load = async (locale: 'en' | 'es') =>
    JSON.parse(
      await Bun.file(join(localesRoot, locale, 'household.json')).text()
    ) as { careHours: Record<string, string> };

  it('exists in BOTH en and es, with no exclamation mark (voice guard)', async () => {
    for (const locale of ['en', 'es'] as const) {
      const { careHours } = await load(locale);
      expect(typeof careHours.confirmWeekBody).toBe('string');
      expect(typeof careHours.confirmWeekCta).toBe('string');
      expect(careHours.confirmWeekBody).not.toContain('!');
      expect(careHours.confirmWeekCta).not.toContain('!');
    }
  });

  it('acknowledges and points forward, in the words the parent asked for', async () => {
    const { careHours } = await load('en');
    expect(careHours.confirmWeekBody).toBe(
      'Got it — now confirm this as your usual week so it shows up on the calendar.'
    );
    expect(careHours.confirmWeekCta).toBe('Confirm this as the usual week');
  });
});

describe('ManageCommitmentsSection — the pending week (P3.3 follow-up)', () => {
  it('withholds the offer while a sent week is still with the nanny, not only once accepted', () => {
    // Gating on ACCEPTED alone made the offer lie in the window that matters
    // most: the parent has already sent a week, it is unanswered, and
    // tapping "confirm this as your usual week" walks them into building a
    // SECOND one on top of the first.
    expect(sectionSource).toContain('SCHEDULE_PATTERN_STATUSES.PENDING');
    expect(sectionSource).toContain('openPattern');
    expect(sectionSource).toMatch(
      /showConfirmWeek\s*=[\s\S]{0,120}!openPattern/
    );
  });

  it('says the week is already with the nanny rather than nothing at all', () => {
    expect(sectionSource).toContain('careHours.weekPendingBody');
    expect(sectionSource).toContain(
      'testID={`commitment-week-pending-${childId}`}'
    );
    // A status line, never a second CTA — there is nothing to tap yet.
    expect(sectionSource).not.toMatch(
      /commitment-week-pending-\$\{childId\}[\s\S]{0,400}<Button/
    );
  });

  it('shares one gate with the offer, so both obey the nanny and care-hours conditions', () => {
    expect(sectionSource).toMatch(/showConfirmWeek\s*=\s*canOfferWeek/);
    expect(sectionSource).toMatch(/showWeekPending\s*=\s*canOfferWeek/);
  });

  it('has the pending line in BOTH locales, with no exclamation mark', async () => {
    for (const locale of ['en', 'es'] as const) {
      const careHours = (
        JSON.parse(
          await Bun.file(
            join(__dirname, '../../../i18n/locales', locale, 'household.json')
          ).text()
        ) as { careHours: Record<string, string> }
      ).careHours;
      expect(typeof careHours.weekPendingBody).toBe('string');
      expect(careHours.weekPendingBody).not.toContain('!');
    }
  });
});
