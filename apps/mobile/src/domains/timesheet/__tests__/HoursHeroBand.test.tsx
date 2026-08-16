/**
 * @module domains/timesheet/__tests__/HoursHeroBand.test
 *
 * The Hours statement's first block (Daylight v2, screens-hours.md §2): the
 * H1, the week nav, and THE FIGURE, all on the screen wash rather than in a
 * card. The band owns two states the old `WeekTotal` header could not
 * express, and both are guarded here:
 *
 *  - `totalLabel === null` = "hours still loading" → a skeleton bar in the
 *    figure's slot. Never a fabricated `0m`, and never a full-screen spinner
 *    that blanks the title and week label too (that was the bug).
 *  - `totalLabel === '0m'` = a genuinely empty week → muted figure plus the
 *    `emptyWeek` note, so a real zero cannot be mistaken for a stuck load.
 *
 * i18n is the global key-echo mock (bun.setup.ts), so assertions are on
 * stable keys (`title`, `pastMemberNote`), never on copy.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, within } from '@testing-library/react-native';
import type { HoursHeroBandProps } from '../components/HoursHeroBand';

let HoursHeroBand: typeof import('../components/HoursHeroBand').HoursHeroBand;

beforeAll(async () => {
  HoursHeroBand = (await import('../components/HoursHeroBand')).HoursHeroBand;
});

const WEEK_LABEL = '3 – 9 Aug';

function renderBand(overrides: Partial<HoursHeroBandProps> = {}) {
  const props: HoursHeroBandProps = {
    weekRangeLabel: WEEK_LABEL,
    onPreviousWeek: () => {},
    onNextWeek: () => {},
    totalLabel: '12h 30m',
    ...overrides,
  };
  return render(<HoursHeroBand {...props} />);
}

describe('HoursHeroBand — title and week nav', () => {
  it('renders the H1 title and the week label inside the band', () => {
    const { getByTestId } = renderBand();

    const band = getByTestId('hours-hero-band');
    const title = within(band).getByTestId('hours-title');
    expect(title.props['aria-level']).toBe('1');
    expect(title.props.children).toBe('title');
    expect(within(band).getByTestId('hours-week-label').props.children).toBe(
      WEEK_LABEL
    );
  });

  it('fires onPreviousWeek / onNextWeek when the chevrons are pressed', () => {
    const onPreviousWeek = mock(() => {});
    const onNextWeek = mock(() => {});
    const { getByTestId } = renderBand({ onPreviousWeek, onNextWeek });

    fireEvent.press(getByTestId('hours-week-prev'));
    fireEvent.press(getByTestId('hours-week-next'));

    expect(onPreviousWeek).toHaveBeenCalledTimes(1);
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  // Asserted at the prop level, not by pressing: `AnimatedPressable` is a bare
  // host string under the global mock (bun.setup.ts), so `fireEvent.press`
  // fires its `onPress` regardless of `disabled` — a press here would prove
  // nothing either way. On device both the touch and the a11y state are gated
  // by these two props.
  it('respects the disabled flags — dimmed AND marked disabled to a11y', () => {
    const { getByTestId } = renderBand({
      isPreviousDisabled: true,
      isNextDisabled: true,
    });

    const prev = getByTestId('hours-week-prev');
    const next = getByTestId('hours-week-next');
    expect(prev.props.disabled).toBe(true);
    expect(prev.props.accessibilityState?.disabled).toBe(true);
    expect(next.props.disabled).toBe(true);
    expect(next.props.accessibilityState?.disabled).toBe(true);
  });

  it('leaves both chevrons enabled by default', () => {
    const { getByTestId } = renderBand();

    expect(getByTestId('hours-week-prev').props.disabled).toBe(false);
    expect(getByTestId('hours-week-next').props.disabled).toBe(false);
  });
});

describe('HoursHeroBand — the figure', () => {
  it('renders the pre-formatted total, tabular, in the figure slot', () => {
    const { getByTestId, queryByTestId } = renderBand({ totalLabel: '9h 05m' });

    const total = getByTestId('hours-total');
    expect(total.props.children).toBe('9h 05m');
    expect(queryByTestId('hours-total-skeleton')).toBeNull();
  });

  // The whole point of the band: loading must not blank the figure's
  // NEIGHBOURS. Title and week label are derived locally and paint anyway.
  it('renders a skeleton and NO figure while totalLabel is null', () => {
    const { getByTestId, queryByTestId } = renderBand({ totalLabel: null });

    expect(getByTestId('hours-total-skeleton')).toBeTruthy();
    expect(queryByTestId('hours-total')).toBeNull();
    expect(getByTestId('hours-title')).toBeTruthy();
    expect(getByTestId('hours-week-label').props.children).toBe(WEEK_LABEL);
  });

  it('does not claim an empty week while the hours are still loading', () => {
    const { queryByTestId } = renderBand({ totalLabel: null });

    expect(queryByTestId('hours-empty-week')).toBeNull();
  });

  it('mutes the figure and adds the empty-week note on a genuine 0m week', () => {
    const { getByTestId } = renderBand({ totalLabel: '0m' });

    expect(getByTestId('hours-total').props.className).toContain(
      'text-muted-foreground'
    );
    expect(getByTestId('hours-empty-week').props.children).toBe('emptyWeek');
  });

  it('leaves a non-zero week unmuted and un-noted', () => {
    const { getByTestId, queryByTestId } = renderBand({
      totalLabel: '12h 30m',
    });

    expect(getByTestId('hours-total').props.className ?? '').not.toContain(
      'text-muted-foreground'
    );
    expect(queryByTestId('hours-empty-week')).toBeNull();
  });
});

describe('HoursHeroBand — optional lines', () => {
  it('renders the overtime caption when there is one', () => {
    const { getByTestId } = renderBand({
      overtimeLabel: '14m over scheduled',
    });

    expect(getByTestId('hours-overtime').props.children).toBe(
      '14m over scheduled'
    );
  });

  it('omits the overtime caption when it is null or absent', () => {
    expect(
      renderBand({ overtimeLabel: null }).queryByTestId('hours-overtime')
    ).toBeNull();
    expect(renderBand().queryByTestId('hours-overtime')).toBeNull();
  });

  it("renders the carer's name for the parent view", () => {
    const { getByTestId } = renderBand({ carerName: 'Amara' });

    expect(getByTestId('hours-carer-name').props.children).toBe('Amara');
  });

  it('omits the carer name when none is passed (the nanny sees her own week)', () => {
    expect(renderBand().queryByTestId('hours-carer-name')).toBeNull();
    expect(
      renderBand({ carerName: null }).queryByTestId('hours-carer-name')
    ).toBeNull();
  });

  // A removed member keeps read access; the screen SAYS so rather than just
  // showing her no buttons (screens-hours.md §6).
  it('renders the past-member note when isPastMember', () => {
    const { getByTestId } = renderBand({ isPastMember: true });

    expect(getByTestId('hours-past-member-note').props.children).toBe(
      'pastMemberNote'
    );
  });

  it('omits the past-member note for an active member', () => {
    expect(renderBand().queryByTestId('hours-past-member-note')).toBeNull();
  });
});

describe('HoursHeroBand — week shape', () => {
  const mondayHeavy: number[] = [0, 480, 0, 240, 0, 0, 0];

  it('renders the week bars when per-day minutes are supplied', () => {
    const { getByTestId, queryByTestId } = renderBand({
      dayMinutes: mondayHeavy,
    });

    expect(getByTestId('hours-week-bars')).toBeTruthy();
    expect(queryByTestId('hours-total-skeleton')).toBeNull();
  });

  it('renders the split track when scheduled minutes are supplied', () => {
    const { getByTestId } = renderBand({
      dayMinutes: mondayHeavy,
      scheduledMinutes: 480,
    });

    expect(getByTestId('hours-split-track')).toBeTruthy();
  });

  it('renders the lead line for the nanny and for the parent', () => {
    const nanny = renderBand({ lead: 'lead.nanny' });
    expect(nanny.getByTestId('hours-lead').props.children).toBe('lead.nanny');
    nanny.unmount();

    const parent = renderBand({ lead: 'lead.parent' });
    expect(parent.getByTestId('hours-lead').props.children).toBe('lead.parent');
  });

  it('renders neither the bars nor the track while the week is still loading', () => {
    const { queryByTestId, getByTestId } = renderBand({
      totalLabel: null,
      dayMinutes: mondayHeavy,
      scheduledMinutes: 480,
      lead: 'lead.nanny',
    });

    expect(getByTestId('hours-total-skeleton')).toBeTruthy();
    expect(queryByTestId('hours-week-bars')).toBeNull();
    expect(queryByTestId('hours-split-track')).toBeNull();
    expect(queryByTestId('hours-lead')).toBeNull();
  });
});
