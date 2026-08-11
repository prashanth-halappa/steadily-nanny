/**
 * @module domains/timesheet/__tests__/WeekQueryThread.test
 *
 * The week thread (`docs/design/attention-and-notifications.md` §3 / D-18).
 * Presentational, like `WeekTotal` — the week views own the query, the
 * mutation and the sheets — so it renders cleanly under
 * `@testing-library/react-native`.
 *
 * Timestamps appear in BOTH wire serialisations across these fixtures
 * (`+00:00` and `.000Z`, GOLDEN #25): the server emits both and a component
 * that only ever meets one proves nothing about the other.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { TimesheetThreadMessage } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import { fireEvent, render } from '@testing-library/react-native';
import { WeekQueryThread } from '../components/WeekQueryThread';

const PARENT_ID = '99999999-9999-4999-8999-999999999999';
const CARER_ID = '33333333-3333-4333-8333-333333333333';
const ZONE = 'Europe/London';

const queriedMessage: TimesheetThreadMessage = {
  id: '88888888-8888-4888-8888-888888888888',
  kind: 'queried',
  author_id: PARENT_ID,
  author_name: 'The Ahmeds',
  body: 'Thursday looks about 90 minutes long — can you check?',
  created_at: '2026-08-12T17:04:00+00:00',
};

const carerReply: TimesheetThreadMessage = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'note',
  author_id: CARER_ID,
  author_name: 'Ines Ferreira',
  body: "I stayed late — Ayla's pickup ran over. I've fixed Thursday.",
  created_at: '2026-08-12T19:20:00.000Z',
};

const withdrawn: TimesheetThreadMessage = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'query_withdrawn',
  author_id: PARENT_ID,
  author_name: 'The Ahmeds',
  body: '',
  created_at: '2026-08-13T09:00:00.000Z',
};

function renderThread(
  props: Partial<React.ComponentProps<typeof WeekQueryThread>> = {}
) {
  return render(
    <WeekQueryThread
      testID="hours-week-thread"
      messages={[queriedMessage, carerReply]}
      currentUserId={CARER_ID}
      timeZone={ZONE}
      timesheetStatus="queried"
      viewerRole="nanny"
      onSend={() => {}}
      {...props}
    />
  );
}

describe('WeekQueryThread', () => {
  // D16: on the ~50 clean weeks a year the Hours screen must look exactly as
  // it does today. No header, no empty state, no "no messages yet".
  it('renders NOTHING when the thread is empty', () => {
    const { queryByTestId } = renderThread({ messages: [] });

    expect(queryByTestId('hours-week-thread')).toBeNull();
    expect(queryByTestId('hours-week-thread-composer')).toBeNull();
  });

  it('renders the card and its header once there is a message', () => {
    const { getByTestId, getByText } = renderThread();

    expect(getByTestId('hours-week-thread')).toBeTruthy();
    expect(getByText('thread.title')).toBeTruthy();
  });

  // P1: the parent-only `query_note` band is gone; both sides read the same
  // messages in the same order.
  it('renders every message for BOTH viewers, in the order given', () => {
    for (const viewerRole of ['nanny', 'parent'] as const) {
      const { getByTestId } = renderThread({ viewerRole });

      expect(
        getByTestId(`hours-week-thread-message-${queriedMessage.id}-body`).props
          .children
      ).toBe(queriedMessage.body);
      expect(
        getByTestId(`hours-week-thread-message-${carerReply.id}-body`).props
          .children
      ).toBe(carerReply.body);
    }
  });

  // Names, never roles (§3): "The Ahmeds", "You", "Priya" — never "Parent".
  it('names the author, and says "You" for the reader’s own messages', () => {
    const { getByTestId } = renderThread({ currentUserId: CARER_ID });

    const parentMeta = getByTestId(
      `hours-week-thread-message-${queriedMessage.id}-meta`
    ).props.children;
    const mineMeta = getByTestId(
      `hours-week-thread-message-${carerReply.id}-meta`
    ).props.children;

    expect(parentMeta).toContain('The Ahmeds');
    expect(parentMeta).not.toContain('Parent');
    expect(mineMeta).toContain('thread.you');
    expect(mineMeta).not.toContain('Ines Ferreira');
  });

  it('flips which message reads "You" when the parent is the reader', () => {
    const { getByTestId } = renderThread({
      currentUserId: PARENT_ID,
      viewerRole: 'parent',
    });

    expect(
      getByTestId(`hours-week-thread-message-${queriedMessage.id}-meta`).props
        .children
    ).toContain('thread.you');
    expect(
      getByTestId(`hours-week-thread-message-${carerReply.id}-meta`).props
        .children
    ).toContain('Ines Ferreira');
  });

  // Timestamps are the record (§3) — date + time, in the HOUSEHOLD zone.
  it('stamps every message with a date and a time in the household zone', () => {
    const { getByTestId } = renderThread();

    const meta = getByTestId(
      `hours-week-thread-message-${queriedMessage.id}-meta`
    ).props.children as string;
    // 17:04Z is 18:04 in Europe/London — the household zone, not UTC.
    expect(meta).toContain('Wed 12 Aug');
    expect(meta).toMatch(/18:04|6:04/);
  });

  it('reads a .000Z timestamp the same way as a +00:00 one', () => {
    const { getByTestId } = renderThread();

    const meta = getByTestId(`hours-week-thread-message-${carerReply.id}-meta`)
      .props.children as string;
    expect(meta).toContain('Wed 12 Aug');
    expect(meta).toMatch(/20:20|8:20/);
  });

  // `query_withdrawn` carries no text — the client renders the sentence in
  // the reader's own language, with the same timestamp treatment.
  it('renders a localized sentence in place of a query_withdrawn message’s empty body', () => {
    const { getByTestId } = renderThread({
      messages: [queriedMessage, withdrawn],
      timesheetStatus: 'submitted',
    });

    const body = getByTestId(`hours-week-thread-message-${withdrawn.id}-body`);
    expect(body.props.children).toBe('thread.queryWithdrawn');
    expect(
      getByTestId(`hours-week-thread-message-${withdrawn.id}-meta`).props
        .children
    ).toContain('Thu 13 Aug');
  });

  describe('composer visibility', () => {
    it.each([
      'nanny',
      'parent',
    ] as const)('shows the composer on a queried week for the %s', viewerRole => {
      const { getByTestId } = renderThread({
        viewerRole,
        timesheetStatus: 'queried',
      });

      expect(getByTestId('hours-week-thread-composer')).toBeTruthy();
      expect(getByTestId('hours-week-thread-send')).toBeTruthy();
    });

    it('shows the composer on a submitted week for the carer (§3.1)', () => {
      const { getByTestId } = renderThread({
        viewerRole: 'nanny',
        timesheetStatus: 'submitted',
      });

      expect(getByTestId('hours-week-thread-composer')).toBeTruthy();
    });

    it('hides the composer on a submitted week for the parent — only a query opens their side', () => {
      const { queryByTestId } = renderThread({
        viewerRole: 'parent',
        timesheetStatus: 'submitted',
      });

      expect(queryByTestId('hours-week-thread-composer')).toBeNull();
    });

    it('renders an approved week read-only — history, not a chat', () => {
      const { getByTestId, queryByTestId } = renderThread({
        timesheetStatus: 'approved',
      });

      expect(getByTestId('hours-week-thread')).toBeTruthy();
      expect(queryByTestId('hours-week-thread-composer')).toBeNull();
    });

    // §3.1's last paragraph: "This doesn't look right" on an approved week
    // reopens the composer for the resulting thread.
    it('brings the composer back on an approved week once she has opened one herself', () => {
      const { getByTestId } = renderThread({
        timesheetStatus: 'approved',
        composerReopened: true,
      });

      expect(getByTestId('hours-week-thread-composer')).toBeTruthy();
    });
  });

  // "A thread that lets her argue but not correct the record is P1 with
  // extra steps" — the card says so out loud while the week is queried.
  it('says the day is still editable under the composer on a queried week', () => {
    const { getByTestId } = renderThread({ timesheetStatus: 'queried' });

    expect(getByTestId('hours-week-thread-still-editable')).toBeTruthy();
  });

  it('does not say a day is still editable when there is no composer', () => {
    const { queryByTestId } = renderThread({ timesheetStatus: 'approved' });

    expect(queryByTestId('hours-week-thread-still-editable')).toBeNull();
  });

  it('sends the trimmed message and refuses an empty one', () => {
    const onSend = mock((_: string) => {});
    const { getByTestId } = renderThread({ onSend });

    fireEvent.press(getByTestId('hours-week-thread-send'));
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.changeText(
      getByTestId('hours-week-thread-composer'),
      '  fixed it '
    );
    fireEvent.press(getByTestId('hours-week-thread-send'));
    expect(onSend).toHaveBeenCalledWith('fixed it');
  });

  // GOLDEN-FIXES #40: a refusal is inline, never a toast — this card can sit
  // under an open sheet, and a toast there is simply not visible on iOS.
  it('renders a send failure inline under the composer, never as a toast', () => {
    const { getByTestId } = renderThread({ sendError: 'Could not send' });

    expect(getByTestId('hours-week-thread-error').props.children).toBe(
      'Could not send'
    );
  });

  // daylight-v2 §6.6 refuses a second unread affordance and this is not the
  // place to introduce one.
  it('never renders a badge or an unread dot', () => {
    const { queryByTestId } = renderThread();

    expect(queryByTestId('hours-week-thread-badge')).toBeNull();
    expect(queryByTestId('hours-week-thread-unread')).toBeNull();
  });
});
