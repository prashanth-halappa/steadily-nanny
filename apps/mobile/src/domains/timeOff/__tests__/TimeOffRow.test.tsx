/**
 * @module domains/timeOff/__tests__/TimeOffRow.test
 *
 * Component-level test with props fed directly (docs/09-TESTING.md §5
 * Pattern B) — proves TimeOffRow itself renders and wires correctly in
 * isolation. This does NOT prove anything in the app actually calls it with
 * real data; that's TimeOffScreen.test.tsx's job (see its header comment).
 */
import { describe, expect, it, mock } from 'bun:test';
import { render } from '@testing-library/react-native';
import { TimeOffRow } from '../components/TimeOffRow';

/** Days from now, as an instant — keeps fixtures off the wall calendar. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * UPCOMING time off by default, because Edit and Cancel only render while
 * `ends_at` is still ahead of now. These were fixed 2026-08-10/13 literals
 * and silently became past on 2026-08-14, turning four passing tests red with
 * no code change. The "past time off" case below pins its own era with
 * explicit 2020 dates, so only this default needs to move with the clock.
 */
function makeTimeOff(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    user_id: '11111111-1111-4111-8111-111111111111',
    starts_at: daysFromNow(3),
    ends_at: daysFromNow(6),
    all_day: true,
    message: null,
    kind: 'personal' as const,
    status: 'confirmed' as const,
    ical_uid: 'time-off-1@steadily',
    sequence: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TimeOffRow', () => {
  it('renders the date-range label and status for a confirmed row', () => {
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    expect(
      getByTestId('time-off-row-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();
    expect(
      getByTestId('time-off-status-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();
  });

  it('renders the optional message when present', () => {
    const { getByText } = render(
      <TimeOffRow
        timeOff={makeTimeOff({ message: 'Visiting family' })}
        onCancel={() => {}}
        isCancelling={false}
      />
    );
    expect(getByText('Visiting family')).toBeTruthy();
  });

  it('tapping Cancel fires onCancel with the row id', () => {
    const onCancel = mock(() => {});
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={onCancel}
        isCancelling={false}
      />
    );

    getByTestId(
      'time-off-cancel-22222222-2222-4222-8222-222222222222'
    ).props.onPress?.();

    expect(onCancel).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('hides the Cancel control once the row is already cancelled', () => {
    const { queryByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff({ status: 'cancelled' })}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    expect(
      queryByTestId('time-off-cancel-22222222-2222-4222-8222-222222222222')
    ).toBeNull();
  });

  it('stays in the list, dimmed, once cancelled — soft-cancel is a status change, not a deletion', () => {
    const { getByTestId, queryByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff({ status: 'cancelled' })}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    const row = getByTestId(
      'time-off-row-22222222-2222-4222-8222-222222222222'
    );
    expect(row).toBeTruthy();
    expect(row.props.className).toContain('opacity-50');
    expect(
      queryByTestId('time-off-status-22222222-2222-4222-8222-222222222222')
    ).toBeTruthy();
  });

  it('renders a confirmed row at full opacity (no dimming)', () => {
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={() => {}}
        isCancelling={false}
      />
    );

    const row = getByTestId(
      'time-off-row-22222222-2222-4222-8222-222222222222'
    );
    expect(row.props.className).not.toContain('opacity-50');
  });

  it('disables Cancel while a cancellation is already in flight', () => {
    const { getByTestId } = render(
      <TimeOffRow timeOff={makeTimeOff()} onCancel={() => {}} isCancelling />
    );

    expect(
      getByTestId('time-off-cancel-22222222-2222-4222-8222-222222222222').props
        .disabled
    ).toBe(true);
  });

  it('tapping Edit fires onEdit with the row id', () => {
    const onEdit = mock(() => {});
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={() => {}}
        onEdit={onEdit}
        isCancelling={false}
        isEditing={false}
      />
    );

    getByTestId(
      'time-off-edit-22222222-2222-4222-8222-222222222222'
    ).props.onPress?.();

    expect(onEdit).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });

  it('hides the Edit control once the row is already cancelled', () => {
    const { queryByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff({ status: 'cancelled' })}
        onCancel={() => {}}
        onEdit={() => {}}
        isCancelling={false}
        isEditing={false}
      />
    );

    expect(
      queryByTestId('time-off-edit-22222222-2222-4222-8222-222222222222')
    ).toBeNull();
  });

  it('disables Edit while an edit is already in flight', () => {
    const { getByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff()}
        onCancel={() => {}}
        onEdit={() => {}}
        isCancelling={false}
        isEditing
      />
    );

    expect(
      getByTestId('time-off-edit-22222222-2222-4222-8222-222222222222').props
        .disabled
    ).toBe(true);
  });

  describe('TIER0-CX-SPEC.md §5.2: anonymised cross-family paid marker', () => {
    it('no family has paid: shows "Not marked paid"', () => {
      const { getByTestId } = render(
        <TimeOffRow
          timeOff={makeTimeOff()}
          onCancel={() => {}}
          isCancelling={false}
          paidFamilyCount={0}
        />
      );

      expect(
        getByTestId('time-off-paid-marker-22222222-2222-4222-8222-222222222222')
          .props.children
      ).toBe('crossFamily.notMarkedPaid');
    });

    it('exactly one family paid: shows the singular form, never a name or amount', () => {
      const { getByTestId } = render(
        <TimeOffRow
          timeOff={makeTimeOff()}
          onCancel={() => {}}
          isCancelling={false}
          paidFamilyCount={1}
        />
      );

      expect(
        getByTestId('time-off-paid-marker-22222222-2222-4222-8222-222222222222')
          .props.children
      ).toBe('crossFamily.paidByFamilies');
    });

    it('two or more families paid: still the same key (i18next plural suffixing happens for real, not in this key-echo test)', () => {
      const { getByTestId } = render(
        <TimeOffRow
          timeOff={makeTimeOff()}
          onCancel={() => {}}
          isCancelling={false}
          paidFamilyCount={2}
        />
      );

      expect(
        getByTestId('time-off-paid-marker-22222222-2222-4222-8222-222222222222')
          .props.children
      ).toBe('crossFamily.paidByFamilies');
    });

    it('omitted paidFamilyCount (prop not wired) renders nothing, never crashes', () => {
      const { queryByTestId } = render(
        <TimeOffRow
          timeOff={makeTimeOff()}
          onCancel={() => {}}
          isCancelling={false}
        />
      );

      expect(
        queryByTestId(
          'time-off-paid-marker-22222222-2222-4222-8222-222222222222'
        )
      ).toBeNull();
    });
  });

  it('hides Edit and Cancel for past time off — the exclusive ends_at is already before now', () => {
    const { queryByTestId } = render(
      <TimeOffRow
        timeOff={makeTimeOff({
          starts_at: '2020-01-01T00:00:00.000Z',
          ends_at: '2020-01-05T00:00:00.000Z',
        })}
        onCancel={() => {}}
        onEdit={() => {}}
        isCancelling={false}
        isEditing={false}
      />
    );

    expect(
      queryByTestId('time-off-edit-22222222-2222-4222-8222-222222222222')
    ).toBeNull();
    expect(
      queryByTestId('time-off-cancel-22222222-2222-4222-8222-222222222222')
    ).toBeNull();
  });

  describe('kind: "sick" (068)', () => {
    const ROW_ID = '22222222-2222-4222-8222-222222222222';

    it('renders a distinct sick-kind marker for a sick row', () => {
      const { getByTestId } = render(
        <TimeOffRow
          timeOff={makeTimeOff({ kind: 'sick' })}
          onCancel={() => {}}
          isCancelling={false}
        />
      );

      expect(getByTestId(`time-off-kind-sick-${ROW_ID}`)).toBeTruthy();
    });

    it('renders no sick-kind marker for a personal row', () => {
      const { queryByTestId } = render(
        <TimeOffRow
          timeOff={makeTimeOff({ kind: 'personal' })}
          onCancel={() => {}}
          isCancelling={false}
        />
      );

      expect(queryByTestId(`time-off-kind-sick-${ROW_ID}`)).toBeNull();
    });
  });
});

describe('TimeOffRow — register-2 colour budget (00-FOUNDATIONS §3.3)', () => {
  it('keeps Cancel on a register-1 ink so StatusPill remains the sole register-2', async () => {
    // An ACTIVE row already shows StatusPill variant="confirmed" (success
    // fill). A second register-2 colour on the Cancel label is forbidden.
    const source = await Bun.file(
      new URL('../components/TimeOffRow.tsx', import.meta.url).pathname
    ).text();

    const cancelIdx = source.indexOf(
      'testID={`time-off-cancel-${timeOff.id}`}'
    );
    expect(cancelIdx).toBeGreaterThan(-1);
    const cancelWindow = source.slice(cancelIdx, cancelIdx + 320);
    expect(cancelWindow).toContain("{t('cancelButton')}");
    expect(cancelWindow).not.toContain('text-error-inline-text');
    expect(cancelWindow).toMatch(/text-(muted-foreground|foreground)/);
    // StatusPill stays — do not "fix" the budget by removing it.
    expect(source).toContain('variant={pillVariant}');
    expect(source).toContain('time-off-status-');
  });
});
