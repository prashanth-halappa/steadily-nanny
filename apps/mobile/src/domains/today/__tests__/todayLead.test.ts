/**
 * @module domains/today/__tests__/todayLead.test
 *
 * The Today hero lead is one true sentence about this day, keyed off the
 * same `HeroMood` the illustration already uses. Seven locale keys, no
 * second state machine.
 */
import { describe, expect, it } from 'bun:test';
import type { CoverKind } from '../hooks/useTodayCoverRows';
import type { TodayLeadInput } from '../utils/todayLead';
import { resolveTodayLead } from '../utils/todayLead';

function row(kind: CoverKind, name = 'Priya') {
  return { name, kind, detail: '' };
}

function input(
  overrides: Partial<TodayLeadInput> &
    Pick<TodayLeadInput, 'isParentView' | 'activeNanny' | 'mood'>
): TodayLeadInput {
  return {
    hasHousehold: true,
    rows: [],
    ...overrides,
  };
}

describe('resolveTodayLead', () => {
  it.each([
    [
      'parent',
      'here',
      'lead.parent.here',
      {
        isParentView: true,
        activeNanny: false,
        mood: 'here' as const,
        rows: [row('live')],
        name: 'Priya',
      },
    ],
    [
      'parent',
      'done',
      'lead.parent.done',
      {
        isParentView: true,
        activeNanny: false,
        mood: 'done' as const,
        rows: [row('finished')],
      },
    ],
    [
      'parent',
      'quiet',
      'lead.parent.quiet',
      { isParentView: true, activeNanny: false, mood: 'quiet' as const },
    ],
    [
      'nanny',
      'here',
      'lead.nanny.here',
      {
        isParentView: false,
        activeNanny: true,
        mood: 'here' as const,
        rows: [row('live')],
        time: '9:00 AM',
      },
    ],
    [
      'nanny',
      'scheduled',
      'lead.nanny.scheduled',
      {
        isParentView: false,
        activeNanny: true,
        mood: 'quiet' as const,
        rows: [row('scheduled')],
        family: 'The Ahmeds',
        start: '9:00 AM',
        end: '5:00 PM',
      },
    ],
    [
      'nanny',
      'done',
      'lead.nanny.done',
      {
        isParentView: false,
        activeNanny: true,
        mood: 'done' as const,
        rows: [row('finished')],
        time: '5:00 PM',
        duration: '8h',
      },
    ],
    [
      'nanny',
      'quiet',
      'lead.nanny.quiet',
      { isParentView: false, activeNanny: true, mood: 'quiet' as const },
    ],
  ] as const)('maps %s × %s to %s', (_role, _mood, key, patch) => {
    expect(resolveTodayLead(input(patch))?.key).toBe(key);
  });

  it('returns null when there is nothing true to say', () => {
    expect(
      resolveTodayLead(
        input({
          hasHousehold: false,
          isParentView: true,
          activeNanny: false,
          mood: 'quiet',
        })
      )
    ).toBeNull();
    expect(
      resolveTodayLead(
        input({
          isParentView: false,
          activeNanny: false,
          mood: 'quiet',
        })
      )
    ).toBeNull();
  });

  it('carries the interpolation params each key needs', () => {
    expect(
      resolveTodayLead(
        input({
          isParentView: true,
          activeNanny: false,
          mood: 'here',
          rows: [row('live')],
          name: 'Priya',
        })
      )
    ).toEqual({
      key: 'lead.parent.here',
      params: { name: 'Priya' },
    });

    expect(
      resolveTodayLead(
        input({
          isParentView: true,
          activeNanny: false,
          mood: 'done',
          rows: [row('finished')],
        })
      )
    ).toEqual({
      key: 'lead.parent.done',
      params: {},
    });

    expect(
      resolveTodayLead(
        input({
          isParentView: true,
          activeNanny: false,
          mood: 'quiet',
        })
      )
    ).toEqual({
      key: 'lead.parent.quiet',
      params: {},
    });

    expect(
      resolveTodayLead(
        input({
          isParentView: false,
          activeNanny: true,
          mood: 'here',
          rows: [row('live')],
          time: '9:00 AM',
        })
      )
    ).toEqual({
      key: 'lead.nanny.here',
      params: { time: '9:00 AM' },
    });

    expect(
      resolveTodayLead(
        input({
          isParentView: false,
          activeNanny: true,
          mood: 'quiet',
          rows: [row('scheduled')],
          family: 'The Ahmeds',
          start: '9:00 AM',
          end: '5:00 PM',
        })
      )
    ).toEqual({
      key: 'lead.nanny.scheduled',
      params: { family: 'The Ahmeds', start: '9:00 AM', end: '5:00 PM' },
    });

    expect(
      resolveTodayLead(
        input({
          isParentView: false,
          activeNanny: true,
          mood: 'done',
          rows: [row('finished')],
          time: '5:00 PM',
          duration: '8h',
        })
      )
    ).toEqual({
      key: 'lead.nanny.done',
      params: { time: '5:00 PM', duration: '8h' },
    });

    expect(
      resolveTodayLead(
        input({
          isParentView: false,
          activeNanny: true,
          mood: 'quiet',
        })
      )
    ).toEqual({
      key: 'lead.nanny.quiet',
      params: {},
    });
  });
});
