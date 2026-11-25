/**
 * @module domains/schedule/__tests__/AgendaView.slices.test
 *
 * Partial-coverage addendum A1: the remainder "Not booked yet" card names
 * the REST of its need window — what is asked, booked, or parent-covered —
 * as a section of slice rows. S1 is untouched: the remainder keeps its pill,
 * its actions and its own row; the section only adds context, and only when
 * there is something to say.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildCommitment } from '@steadily-nanny/shared-types/schemas/child.schema';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { uncoveredKey } from '@steadily-nanny/shared-types/uncoveredCare';
import { render } from '@testing-library/react-native';
import type { UncoveredWindowDisplay } from '@/src/domains/schedule/utils/uncoveredDisplay';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMMITMENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CARER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
// Monday 3 Aug 2026, New York (UTC-4): local 07:00 = 11:00Z.
const LOCAL_DATE = '2026-08-03';
const TZ = 'America/New_York';
const z = (h: number) => `2026-08-03T${String(h).padStart(2, '0')}:00:00.000Z`;

const scheduleEn = JSON.parse(
  readFileSync(
    join(import.meta.dir, '../../../i18n/locales/en/schedule.json'),
    'utf8'
  )
) as Record<string, unknown>;

function getNested(obj: Record<string, unknown>, path: string): string {
  const value = path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
  return typeof value === 'string' ? value : path;
}

const carer = {
  id: 'member-carer',
  household_id: HOUSEHOLD_ID,
  user_id: CARER,
  role: 'nanny' as const,
  can_edit: false,
  status: 'active' as const,
  display_name_override: 'Andrea Sanchez',
  colour: null,
  joined_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeAll(() => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        const template = getNested(scheduleEn, key);
        return vars
          ? template.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
              String(vars[k] ?? `{{${k}}}`)
            )
          : template;
      },
      i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
    }),
    Trans: ({ children }: { children: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: mock() },
  }));
  mock.module('expo-router', () => ({
    useRouter: () => ({ push: () => {} }),
    router: { push: () => {}, replace: () => {}, back: () => {} },
  }));
  mock.module('@/src/hooks/queries/useHouseholdMembers', () => ({
    useHouseholdMembers: () => ({ data: [carer] }),
  }));
  mock.module('@/src/hooks/queries/useChildren', () => ({
    useChildren: () => ({
      data: [{ id: CHILD, name: 'Nia' }],
      isLoading: false,
    }),
  }));
  mock.module('@/src/domains/schedule/hooks/useHouseholdCarers', () => ({
    useHouseholdCarers: () => ({ data: [carer] }),
  }));
  mock.module('@/src/hooks/mutations/useCreateParentCover', () => ({
    useCreateParentCover: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useRemoveParentCover', () => ({
    useRemoveParentCover: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/mutations/useWithdrawCoverAsk', () => ({
    useWithdrawCoverAsk: () => ({
      mutateAsync: async () => {},
      isPending: false,
    }),
  }));
  mock.module('@/src/hooks/queries/useCanWriteHousehold', () => ({
    useCanWriteHousehold: () => ({
      canWrite: true,
      isPastMember: false,
      isLoading: false,
    }),
  }));
});

let AgendaView: typeof import('../components/AgendaView').AgendaView;

beforeAll(async () => {
  AgendaView = (await import('../components/AgendaView')).AgendaView;
});

const commitment = {
  id: COMMITMENT,
  child_id: CHILD,
  household_id: HOUSEHOLD_ID,
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  start_time: '07:00:00',
  end_time: '09:00:00',
  starts_on: null,
  ends_on: null,
  exdates: [],
} as unknown as ChildCommitment;

// The unbooked remainder: 07:00–08:00 local.
const remainder: UncoveredWindowDisplay = {
  childId: CHILD,
  commitmentId: COMMITMENT,
  startsAt: z(11),
  endsAt: z(12),
  cause: 'nothingScheduled',
};
const key = uncoveredKey(remainder);

function shift(overrides: Partial<Shift>): Shift {
  return {
    id: 'shift-rest',
    household_id: HOUSEHOLD_ID,
    carer_id: CARER,
    kind: 'extra',
    status: 'pending',
    starts_at: z(12),
    ends_at: z(13),
    timezone: TZ,
    local_date: LOCAL_DATE,
    shift_children: [],
    ...overrides,
  } as unknown as Shift;
}

function renderCard(shifts: Shift[]) {
  return render(
    <AgendaView
      shifts={shifts}
      householdId={HOUSEHOLD_ID}
      displayTimeZone={TZ}
      householdTimeZone={TZ}
      weekDates={[LOCAL_DATE]}
      uncoveredByDay={{ [LOCAL_DATE]: [remainder] }}
      commitments={[commitment]}
      showUncoveredActions
    />
  );
}

const textOf = (node: { props: { children?: unknown } }) =>
  String(node.props.children);

describe('AgendaView partial coverage: "The rest of …" on the remainder card', () => {
  it('partial pending: the rest is "asked Andrea", with a Pending pill', () => {
    const utils = renderCard([shift({})]);

    const section = utils.getByTestId(`schedule-uncovered-${key}-slices`);
    expect(section).toBeTruthy();
    expect(utils.getByText('The rest of 7:00 AM – 9:00 AM')).toBeTruthy();
    expect(
      textOf(utils.getByTestId(`schedule-uncovered-${key}-slice-0-text`))
    ).toBe('8:00 AM – 9:00 AM · asked Andrea');
    expect(
      textOf(utils.getByTestId(`schedule-uncovered-${key}-slice-0-pill-label`))
    ).toBe('Pending');
    // S1: still a full "Not booked yet" card with its actions.
    expect(utils.getByTestId(`schedule-uncovered-ask-${key}`)).toBeTruthy();
    expect(utils.getByTestId(`schedule-uncovered-cover-${key}`)).toBeTruthy();
  });

  it('partial coverage: a confirmed rest is "with Andrea", Confirmed pill', () => {
    const utils = renderCard([shift({ status: 'confirmed' })]);
    expect(
      textOf(utils.getByTestId(`schedule-uncovered-${key}-slice-0-text`))
    ).toBe('8:00 AM – 9:00 AM · with Andrea');
    expect(
      textOf(utils.getByTestId(`schedule-uncovered-${key}-slice-0-pill-label`))
    ).toBe('Confirmed');
  });

  it('a parent-cover rest reads "you\'re covering" and carries no pill', () => {
    const utils = renderCard([
      shift({ kind: 'parent_cover', status: 'confirmed', carer_id: null }),
    ]);
    expect(
      textOf(utils.getByTestId(`schedule-uncovered-${key}-slice-0-text`))
    ).toBe("8:00 AM – 9:00 AM · you're covering");
    expect(
      utils.queryByTestId(`schedule-uncovered-${key}-slice-0-pill`)
    ).toBeNull();
  });

  it('a plain whole-window gap has no section', () => {
    const utils = renderCard([]);
    expect(utils.queryByTestId(`schedule-uncovered-${key}-slices`)).toBeNull();
  });
});
