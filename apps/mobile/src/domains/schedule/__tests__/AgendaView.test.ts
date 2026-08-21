/**
 * @module domains/schedule/__tests__/AgendaView.test
 * Source-inspection test (Pattern A, docs/09-TESTING.md §5) — AgendaView
 * pulls in FlashList's native-heavy internals, so we assert architectural
 * markers instead of rendering.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const viewPath = join(__dirname, '../components/AgendaView.tsx');
const shiftRowPath = join(__dirname, '../components/ShiftRow.tsx');
const enSchedulePath = join(
  __dirname,
  '../../../i18n/locales/en/schedule.json'
);
let viewSource: string;
let agendaSource: string;
let enSchedule: Record<string, Record<string, unknown>>;

beforeAll(async () => {
  agendaSource = await Bun.file(viewPath).text();
  // ShiftRow used to live in AgendaView. Existing source-inspection
  // assertions still look at the row's markers (parent-cover mute, etc.)
  // — concatenate so those keep passing after the extraction.
  viewSource = `${agendaSource}\n${await Bun.file(shiftRowPath).text()}`;
  enSchedule = JSON.parse(await Bun.file(enSchedulePath).text());
});

describe('AgendaView source', () => {
  it('renders the shift row from its own module', () => {
    expect(agendaSource).toContain("from './ShiftRow'");
  });

  it('resolves children and carer colour onto ShiftRow from maps it already holds', () => {
    expect(agendaSource).toContain('assignedChildren=');
    expect(agendaSource).toContain('carerColour=');
    expect(agendaSource).toContain('childrenById.get');
  });

  it('wires the shift list testID', () => {
    expect(viewSource).toContain('testID="schedule-shifts-list"');
  });

  it('renders parent_cover rows muted and without navigation', () => {
    expect(viewSource).toContain('shift.kind === SHIFT_KINDS.PARENT_COVER');
    expect(viewSource).toContain('accessibilityRole="text"');
    expect(viewSource).toContain('rounded-row bg-muted p-3');
    expect(viewSource).toMatch(
      /if \(isParentCover\) \{[\s\S]*return \([\s\S]*<View[\s\S]*accessibilityRole="text"/
    );
  });

  it('slots uncovered rows chronologically, on the opaque warning ground, lifted as the screen L1 (01-LAWS Rule E)', () => {
    expect(viewSource).toContain("type: 'uncovered'");
    expect(viewSource).toContain('colors.surfaceAttention');
    expect(viewSource).toContain('elevation.cardProminent');
    expect(viewSource).toContain('useCreateParentCover');
    expect(viewSource).toContain('cover.askToCover');
    expect(viewSource).toContain('cover.hoursWrong');
  });

  // B1 — the earliest window in the visible week (`isPrimary`) only keeps
  // the loud/alarm treatment when it also falls inside the SAME 72-hour
  // horizon the `uncovered_care_detected` push already uses
  // (docs/12-NEED-COVERAGE.md §5): a gap five days out earns no alarm just
  // for being first in list order.
  it('B1: loudness is isPrimary AND inside the 72-hour act-now horizon, never list order alone', () => {
    expect(agendaSource).toContain('isPrimary');
    expect(agendaSource).toContain(
      'isPrimary && Date.parse(window.startsAt) - nowMs < 72 * 3600_000'
    );
    expect(agendaSource).toContain(
      'isLoud ? elevation.cardProminent : elevation.row'
    );
    expect(agendaSource).toContain(
      'backgroundColor: isLoud ? colors.surfaceAttention : colors.card'
    );
    expect(agendaSource).not.toContain(
      'isPrimary ? elevation.cardProminent : elevation.row'
    );
    expect(agendaSource).not.toContain(
      'backgroundColor: isPrimary ? colors.surfaceAttention : colors.card'
    );
  });

  // B1 — the alarm iconography (brand/AlertCircle) is reserved for the loud
  // row; every quiet row gets the neutral schedule/HelpCircle chip instead,
  // so five gaps in a week stop reading as five alarms.
  it('B1: quiet rows swap the alarm chip for a neutral question chip', () => {
    expect(agendaSource).toContain(
      "import { AlertCircle, HelpCircle, Plane } from 'lucide-react-native';"
    );
    expect(agendaSource).toContain("tone={isLoud ? 'brand' : 'schedule'}");
    expect(agendaSource).toContain('icon={isLoud ? AlertCircle : HelpCircle}');
  });

  // B2 — the quiet-row layout: ask + cover as two equal secondary choices
  // side by side, settings demoted to a self-start ghost link rather than a
  // third full-width action.
  it('B2: quiet rows put ask + cover side by side and demote the settings link', () => {
    expect(agendaSource).toContain('flex-row gap-2');
    expect(agendaSource).toMatch(
      /isLoud \? \([\s\S]*\) : \([\s\S]*flex-row gap-2/
    );
    expect(agendaSource).toContain('className="self-start"');
  });

  // B3 — the reframe from alarm to question. Values only; the keys are
  // unchanged (`cover.rowPill` etc. above stay in the source).
  it('B3: the row pill, cause line and action labels read as a question, not an accusation', () => {
    expect(enSchedule.cover?.rowPill).toBe('Not booked yet');
    expect(
      (enSchedule.cover?.cause as Record<string, string> | undefined)
        ?.nothingScheduled
    ).toBe("You set these as care hours. Nobody's booked yet.");
    expect(enSchedule.cover?.iveGotIt).toBe("I'm covering this");
    expect(enSchedule.cover?.hoursWrong).toBe('Change our care hours');
    expect(enSchedule.cover?.weekSummaryTitle_one).toBe(
      "Who's covering 1 window this week?"
    );
    expect(enSchedule.cover?.weekSummaryTitle_other).toBe(
      "Who's covering {{count}} windows this week?"
    );
  });

  // C — every uncovered-row action states who hears it, directly beneath
  // the button, via the shared `Caption` (14/21/400) typography component.
  it('C: every uncovered action grows a recipient caption naming who hears it', () => {
    expect(agendaSource).toContain(
      "import { Body, Caption, H4, Small } from '@/src/components/ui/typography';"
    );
    expect(agendaSource).toContain("t('recipient.askCover')");
    expect(agendaSource).toContain("t('recipient.careHours')");
    expect(agendaSource).toContain(`schedule-uncovered-ask-\${key}-recipient`);
    expect(agendaSource).toContain(
      `schedule-uncovered-cover-\${key}-recipient`
    );
    expect(agendaSource).toContain(
      `schedule-uncovered-hours-\${key}-recipient`
    );
  });

  // C — "I'm covering this" cannot flatly say nobody is told: a carer whose
  // next shift starts exactly when the cover window ends DOES get a push
  // (shiftCommandService.notifyCarersParentCover). The client reproduces
  // that exact condition rather than guessing, with a comment pointing at
  // the server function so the two cannot drift apart unnoticed.
  it("C: the cover recipient line reproduces notifyCarersParentCover's own condition, not a guess", () => {
    expect(agendaSource).toContain('notifyCarersParentCover');
    expect(agendaSource).toMatch(
      /shifts\.find\(\s*s =>\s*s\.carer_id[\s\S]{0,120}s\.status === 'pending'[\s\S]{0,40}s\.status === 'confirmed'[\s\S]{0,40}s\.starts_at === window\.endsAt/
    );
    expect(agendaSource).toContain("t('recipient.parentCoverAdjacent'");
    expect(agendaSource).toContain("t('recipient.parentCover')");
  });

  it('REGRESSION: the uncovered pill is `uncovered`, never `pending` — that pill means "waiting on a reply", not "unattended" (StatusPill doc comment)', () => {
    expect(agendaSource).toContain(
      '<StatusPill variant="uncovered" label={t(\'cover.rowPill\')} />'
    );
    expect(agendaSource).not.toContain(
      'variant="pending" label={t(\'cover.rowPill\')}'
    );
  });

  it('the "hours wrong" action is a ghost Button, not a bare Pressable (SchedulePatternBanner.tsx:222-234)', () => {
    expect(agendaSource).toContain('variant="ghost"');
    expect(agendaSource).not.toContain('<Pressable');
    expect(agendaSource).not.toContain("Pressable, View } from 'react-native'");
  });

  it('REGRESSION: the 3px accent bar and its ROW_RADIUS constant are retired (docs/design/01-LAWS.md) — the pending pill alone carries the message', () => {
    expect(viewSource).not.toContain('ROW_RADIUS');
    expect(viewSource).not.toContain('schedule-shift-accent-');
  });

  it('REGRESSION: sizes scroll bottom padding off the tab bar height, not a static magic number (BUG1)', () => {
    expect(viewSource).toContain('useTabBarScrollPadding');
    expect(viewSource).toContain('paddingBottom: tabBarScrollPadding');
  });

  it('renders day headers through the shared DayHeader', () => {
    expect(viewSource).toContain("from '@/src/components/ui/day-header'");
    expect(viewSource).toContain('<DayHeader');
  });

  it('REGRESSION: extraHref uses utcIsoToWallClockHHMM for 24h start/end query params (A9)', () => {
    expect(viewSource).toMatch(
      /const extraHref = \(\(\) => \{[\s\S]*?utcIsoToWallClockHHMM\(window\.startsAt[\s\S]*?utcIsoToWallClockHHMM\(window\.endsAt/
    );
    // The two formatters must not be crossed: the URL params are machine
    // values and stay 24h, while everything the user READS goes through the
    // display formatter. These are now hoisted (`formattedStart`/`formattedEnd`)
    // so the row label, both ask buttons and the cause line cannot disagree
    // with each other — assert that fact rather than the old inline shape.
    expect(viewSource).toMatch(
      /const formattedStart = formatShiftTime\(window\.startsAt/
    );
    expect(viewSource).toMatch(
      /const formattedEnd = formatShiftTime\(window\.endsAt/
    );
    expect(viewSource).toContain('`${formattedStart}–${formattedEnd}`');
    expect(viewSource).not.toMatch(
      /start:\s*utcIsoToWallClockHHMM[\s\S]{0,80}askToCover/
    );
  });
});
