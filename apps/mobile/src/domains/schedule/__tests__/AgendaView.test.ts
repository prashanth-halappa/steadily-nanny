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
let viewSource: string;
let agendaSource: string;

beforeAll(async () => {
  agendaSource = await Bun.file(viewPath).text();
  // ShiftRow used to live in AgendaView. Existing source-inspection
  // assertions still look at the row's markers (parent-cover mute, etc.)
  // — concatenate so those keep passing after the extraction.
  viewSource = `${agendaSource}\n${await Bun.file(shiftRowPath).text()}`;
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

  it('L1 attaches to the group, not to every uncovered row — only the earliest keeps the loud ground (01-LAWS Rule E)', () => {
    expect(agendaSource).toContain('isPrimary');
    expect(agendaSource).toContain(
      'isPrimary ? elevation.cardProminent : elevation.row'
    );
    expect(agendaSource).toContain(
      'backgroundColor: isPrimary ? colors.surfaceAttention : colors.card'
    );
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
