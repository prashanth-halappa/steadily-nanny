/**
 * @module lib/__tests__/widgetSnapshotArt.test
 *
 * Which illustration each NextShift state gets. Separate from
 * `widgetSnapshot.test.ts` because it has to `mock.module` the art layer
 * before importing the builders — on a real device `widgetArtUri` answers
 * null until the App Group copy lands, which would make every branch here
 * indistinguishable.
 *
 * What this actually protects: the payload's state -> art mapping and
 * `NextShiftWidget`'s own `showArt` condition are two halves of one decision
 * that live in different files. If they drift, a state either renders no art
 * or renders the wrong motif, and nothing else in the suite would notice.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

import type { NannyShiftInput } from '../widgetSnapshot';
import type { NextShiftWidgetProps } from '../widgetSnapshot.types';

const ZONE = 'Europe/London';
const NOW = new Date('2026-08-06T09:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;

type BuildNextShift = (input: {
  nowMs: number;
  timeZone: string;
  synced: boolean;
  running: null;
  shifts: NannyShiftInput[];
}) => { props: NextShiftWidgetProps };

let buildNextShiftPayload: BuildNextShift;

beforeAll(async () => {
  // Echo the requested name back so each branch is identifiable.
  mock.module('@/src/lib/widgetArt', () => ({
    widgetArtUri: (name: string) => `file:///art/${name}.png`,
    ensureWidgetArt: async () => {},
  }));
  ({ buildNextShiftPayload } = await import('../widgetSnapshot'));
});

function shift(overrides: Partial<NannyShiftInput> = {}): NannyShiftInput {
  return {
    id: 'shift-1',
    startsAt: '2026-08-07T07:00:00.000Z',
    endsAt: '2026-08-07T16:00:00.000Z',
    householdName: 'Patel household',
    timeZone: ZONE,
    childNames: ['Mia'],
    needsResponse: false,
    ...overrides,
  };
}

function artFor(input: {
  synced?: boolean;
  shifts?: NannyShiftInput[];
}): Pick<NextShiftWidgetProps, 'artLightUri' | 'artDarkUri' | 'state'> {
  const { props } = buildNextShiftPayload({
    nowMs: NOW,
    timeZone: ZONE,
    synced: input.synced ?? true,
    running: null,
    shifts: input.shifts ?? [],
  });
  return {
    artLightUri: props.artLightUri,
    artDarkUri: props.artDarkUri,
    state: props.state,
  };
}

describe('NextShift illustration selection', () => {
  it('gives the dusk house to the empty schedule', () => {
    const art = artFor({ shifts: [] });
    expect(art.state.kind).toBe('empty');
    expect(art.artLightUri).toBe('file:///art/empty-light.png');
    expect(art.artDarkUri).toBe('file:///art/empty-dark.png');
  });

  it('gives the dusk house to never-synced', () => {
    const art = artFor({ synced: false, shifts: [shift()] });
    expect(art.state.kind).toBe('neverSynced');
    expect(art.artLightUri).toBe('file:///art/empty-light.png');
  });

  it('gives the rising-glow house to startingSoon', () => {
    const art = artFor({
      shifts: [
        shift({
          startsAt: new Date(NOW + 30 * 60 * 1000).toISOString(),
          endsAt: new Date(NOW + 8 * HOUR).toISOString(),
        }),
      ],
    });
    expect(art.state.kind).toBe('startingSoon');
    expect(art.artLightUri).toBe('file:///art/startingsoon-light.png');
    expect(art.artDarkUri).toBe('file:///art/startingsoon-dark.png');
  });

  it('leaves the data-dense states typographic', () => {
    const art = artFor({
      shifts: [
        shift({
          startsAt: new Date(NOW + 5 * HOUR).toISOString(),
          endsAt: new Date(NOW + 9 * HOUR).toISOString(),
        }),
      ],
    });
    expect(art.state.kind).toBe('nextShift');
    expect(art.artLightUri).toBeNull();
    expect(art.artDarkUri).toBeNull();
  });
});
