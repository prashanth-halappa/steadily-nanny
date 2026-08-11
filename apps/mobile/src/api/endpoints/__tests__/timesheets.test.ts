/**
 * @module api/endpoints/__tests__/timesheets.test
 * Covers: URL construction, request validation, response-envelope unwrap +
 * Zod validation for timesheetApi.list / getWeek / approve / query.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

let timesheetApi: any;
let apiClient: any;

const now = '2026-08-01T00:00:00.000Z';

const validTimesheet = {
  id: '44444444-4444-4444-8444-444444444444',
  household_id: '22222222-2222-4222-8222-222222222222',
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  week_start: '2026-07-27',
  total_minutes: 554,
  status: 'open',
  approved_by: null,
  approved_at: null,
  query_note: null,
  reopen_reason: null,
  created_at: now,
  updated_at: now,
};

beforeAll(async () => {
  mock.module('@/src/api/client', () => ({
    apiClient: {
      get: mock(() => Promise.resolve({})),
      post: mock(() => Promise.resolve({})),
      put: mock(() => Promise.resolve({})),
      patch: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve({})),
    },
  }));

  const mod = await import('../timesheets');
  timesheetApi = mod.timesheetApi;
  apiClient = (await import('@/src/api/client')).apiClient;
});

beforeEach(() => {
  apiClient.get.mockReset?.();
  apiClient.post.mockReset?.();
});

describe('timesheetApi.list', () => {
  it('GETs the household timesheets and returns validated rows', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { timesheets: [validTimesheet] } },
    });

    const result = await timesheetApi.list(validTimesheet.household_id);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${validTimesheet.household_id}/timesheets`
    );
    expect(result).toHaveLength(1);
  });
});

describe('timesheetApi.getWeek', () => {
  it('finds the matching week by filtering the full list client-side, THEN fetches its earnings by id', async () => {
    // Only one carer here — the list still comes back as a list.
    const otherWeek = {
      ...validTimesheet,
      id: '55555555-5555-4555-8555-555555555555',
      week_start: '2026-08-03',
    };
    const weekWithEarnings = {
      ...validTimesheet,
      earnings: {
        status: 'hours_only',
        week_start: '2026-07-27',
        reason: 'legacy_approval',
      },
    };
    // Both calls go through the SAME `apiClient.get` mock (`list` and
    // `getById` are both GETs) — branch on the URL, matching what the two
    // real endpoints actually receive.
    apiClient.get.mockImplementation((url: string) => {
      if (url === `/v1/households/${validTimesheet.household_id}/timesheets`) {
        return Promise.resolve({
          data: { data: { timesheets: [otherWeek, validTimesheet] } },
        });
      }
      if (url === `/v1/timesheets/${validTimesheet.id}`) {
        return Promise.resolve({
          data: { data: { timesheet: weekWithEarnings } },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await timesheetApi.getWeek(
      validTimesheet.household_id,
      '2026-07-27'
    );

    // No week_start param on the list call — GET /households/:id/timesheets
    // has no server-side week filter (see
    // apps/api/.../householdTimesheetRoutes.ts).
    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/households/${validTimesheet.household_id}/timesheets`
    );
    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}`
    );
    expect(result).toHaveLength(1);
    expect(result[0].week_start).toBe('2026-07-27');
    expect(result[0].earnings.status).toBe('hours_only');
  });

  // F-B1-3: a timesheet is identified by (household_id, carer_id,
  // week_start). Picking the FIRST row whose week matches binds the screen to
  // an arbitrary carer in a two-carer household, because the server orders by
  // week_start alone. The week read must carry every carer's row and let the
  // caller pick its own.
  it('two carers, one week: returns BOTH rows with earnings, never just the first match', async () => {
    const hoursOnly = {
      status: 'hours_only',
      week_start: '2026-07-27',
      reason: 'legacy_approval',
    };
    const carerB = {
      ...validTimesheet,
      id: '66666666-6666-4666-8666-666666666666',
      carer_id: '77777777-7777-4777-8777-777777777777',
      carer_display_name: 'Bea Nowak',
    };
    apiClient.get.mockImplementation((url: string) => {
      if (url === `/v1/households/${validTimesheet.household_id}/timesheets`) {
        return Promise.resolve({
          data: { data: { timesheets: [validTimesheet, carerB] } },
        });
      }
      if (url === `/v1/timesheets/${validTimesheet.id}`) {
        return Promise.resolve({
          data: {
            data: { timesheet: { ...validTimesheet, earnings: hoursOnly } },
          },
        });
      }
      if (url === `/v1/timesheets/${carerB.id}`) {
        return Promise.resolve({
          data: { data: { timesheet: { ...carerB, earnings: hoursOnly } } },
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await timesheetApi.getWeek(
      validTimesheet.household_id,
      '2026-07-27'
    );

    expect(result).toHaveLength(2);
    expect(result.map((t: { carer_id: string }) => t.carer_id)).toEqual([
      validTimesheet.carer_id,
      carerB.carer_id,
    ]);
    expect(apiClient.get).toHaveBeenCalledWith(`/v1/timesheets/${carerB.id}`);
  });

  it('returns an empty list when no timesheet exists for that week yet, WITHOUT calling getById', async () => {
    apiClient.get.mockResolvedValue({ data: { data: { timesheets: [] } } });

    const result = await timesheetApi.getWeek(
      validTimesheet.household_id,
      '2026-08-03'
    );

    expect(result).toEqual([]);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});

describe('timesheetApi.getById', () => {
  it('GETs /timesheets/:id and returns the week WITH its earnings attached', async () => {
    const weekWithEarnings = {
      ...validTimesheet,
      earnings: {
        status: 'no_arrangement',
        week_start: validTimesheet.week_start,
        unpriced_dates: [validTimesheet.week_start],
      },
    };
    apiClient.get.mockResolvedValue({
      data: { data: { timesheet: weekWithEarnings } },
    });

    const result = await timesheetApi.getById(validTimesheet.id);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}`
    );
    expect(result.earnings.status).toBe('no_arrangement');
  });

  it('resolves a week whose snapshot carries a line kind this build predates', async () => {
    // THE fleet-risk case: a shipped client meets a seventh earnings kind. A
    // closed enum here threw the whole parse and blanked the Hours screen —
    // one unrecognised row must cost that row's label, nothing else. No `v`
    // on the snapshot either: absent IS v1.
    const weekWithUnknownKind = {
      ...validTimesheet,
      earnings: {
        status: 'ok',
        week_start: validTimesheet.week_start,
        currency: 'GBP',
        lines: [
          {
            kind: 'night_differential',
            minutes: 120,
            rate_minor: 2000,
            multiplier: null,
            amount_minor: 4000,
            from_date: validTimesheet.week_start,
            to_date: validTimesheet.week_start,
            arrangement_id: null,
          },
        ],
        gross_minor: 4000,
        reimbursements_minor: 0,
        worked_minutes: 120,
        payable_minutes: 120,
        guaranteed_minutes_per_week: null,
      },
    };
    apiClient.get.mockResolvedValue({
      data: { data: { timesheet: weekWithUnknownKind } },
    });

    const result = await timesheetApi.getById(validTimesheet.id);

    expect(result.earnings.status).toBe('ok');
    expect(result.earnings.lines[0].kind).toBe('night_differential');
  });
});

describe('timesheetApi.approve', () => {
  it('POSTs to :id/approve and returns the approved timesheet', async () => {
    const approved = {
      ...validTimesheet,
      status: 'approved',
      approved_at: now,
    };
    apiClient.post.mockResolvedValue({
      data: { data: { timesheet: approved } },
    });

    const result = await timesheetApi.approve(validTimesheet.id);

    // No body — `undefined` is what axios receives when the parent staged no
    // adjustment, which is the same empty request as before this feature.
    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/approve`,
      undefined
    );
    expect(result.status).toBe('approved');
  });

  it('POSTs the parent’s adjustment as the body when one is supplied', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: { timesheet: { ...validTimesheet, status: 'approved' } },
      },
    });

    await timesheetApi.approve(validTimesheet.id, {
      adjustment: { amount_minor: -2000, note: '  Advance on Friday  ' },
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/approve`,
      // The shared schema TRIMS the note — validation happens before the
      // wire, not on the server's word alone.
      { adjustment: { amount_minor: -2000, note: 'Advance on Friday' } }
    );
  });

  it('refuses a zero adjustment before it ever reaches the network', async () => {
    apiClient.post.mockClear();

    await expect(
      timesheetApi.approve(validTimesheet.id, {
        adjustment: { amount_minor: 0, note: 'Nothing really' },
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('refuses an adjustment with an empty reason', async () => {
    apiClient.post.mockClear();

    await expect(
      timesheetApi.approve(validTimesheet.id, {
        adjustment: { amount_minor: -2000, note: '   ' },
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('timesheetApi.query', () => {
  it('POSTs to :id/query with the note', async () => {
    const queried = {
      ...validTimesheet,
      status: 'queried',
      query_note: 'Thursday looks off',
    };
    apiClient.post.mockResolvedValue({
      data: { data: { timesheet: queried } },
    });

    const result = await timesheetApi.query(validTimesheet.id, {
      note: 'Thursday looks off',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/query`,
      { note: 'Thursday looks off' }
    );
    expect(result.query_note).toBe('Thursday looks off');
  });

  it('rejects an empty note without calling the API', async () => {
    await expect(
      timesheetApi.query(validTimesheet.id, { note: '' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

// D-18/D-19 week thread. Timestamps deliberately appear in BOTH wire
// serialisations across these fixtures (`+00:00` and `.000Z`, GOLDEN #25) —
// the server has emitted both shapes and `z.iso.datetime({ offset: true })`
// accepts either, so a fixture that only ever uses one proves nothing.
const threadMessages = [
  {
    id: '88888888-8888-4888-8888-888888888888',
    kind: 'queried',
    author_id: '99999999-9999-4999-8999-999999999999',
    author_name: 'The Ahmeds',
    body: 'Thursday looks about 90 minutes long — can you check?',
    created_at: '2026-08-12T17:04:00+00:00',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    kind: 'note',
    author_id: '33333333-3333-4333-8333-333333333333',
    author_name: 'Ines Ferreira',
    body: "I stayed late — Ayla's pickup ran over.",
    created_at: '2026-08-12T19:20:00.000Z',
  },
];

describe('timesheetApi.getThread', () => {
  it('GETs :id/thread and returns the validated messages, oldest first', async () => {
    apiClient.get.mockResolvedValue({
      data: { data: { thread: { messages: threadMessages } } },
    });

    const result = await timesheetApi.getThread(validTimesheet.id);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/thread`
    );
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].kind).toBe('queried');
  });

  it('accepts a query_withdrawn message with an empty body', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          thread: {
            messages: [
              {
                id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                kind: 'query_withdrawn',
                author_id: null,
                author_name: 'The Ahmeds',
                body: '',
                created_at: '2026-08-13T09:00:00.000Z',
              },
            ],
          },
        },
      },
    });

    const result = await timesheetApi.getThread(validTimesheet.id);

    expect(result.messages[0].body).toBe('');
    expect(result.messages[0].author_id).toBeNull();
  });
});

describe('timesheetApi.addThreadMessage', () => {
  it('POSTs the trimmed message and returns the FULL updated thread', async () => {
    apiClient.post.mockResolvedValue({
      data: { data: { thread: { messages: threadMessages } } },
    });

    const result = await timesheetApi.addThreadMessage(validTimesheet.id, {
      message: '  I stayed late  ',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/thread`,
      { message: 'I stayed late' }
    );
    expect(result.messages).toHaveLength(2);
  });

  it('refuses an empty message before it reaches the network', async () => {
    await expect(
      timesheetApi.addThreadMessage(validTimesheet.id, { message: '   ' })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('refuses a message over the 1000-character ceiling', async () => {
    await expect(
      timesheetApi.addThreadMessage(validTimesheet.id, {
        message: 'x'.repeat(1001),
      })
    ).rejects.toThrow();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('timesheetApi.withdrawQuery', () => {
  it('POSTs to :id/withdraw-query with no body and returns the submitted week', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        data: {
          timesheet: {
            ...validTimesheet,
            status: 'submitted',
            query_note: null,
          },
        },
      },
    });

    const result = await timesheetApi.withdrawQuery(validTimesheet.id);

    expect(apiClient.post).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/withdraw-query`
    );
    expect(result.status).toBe('submitted');
  });
});

describe('timesheetApi.exportCsv', () => {
  it('GETs :id/export.csv as raw text and returns the body verbatim', async () => {
    const csv =
      'date,description,kind,minutes,rate_minor,amount_minor,currency\n' +
      '2026-07-27,Hours worked,regular,2460,1850,23612,GBP\n';
    apiClient.get.mockResolvedValue({ data: csv });

    const result = await timesheetApi.exportCsv(validTimesheet.id);

    expect(apiClient.get).toHaveBeenCalledWith(
      `/v1/timesheets/${validTimesheet.id}/export.csv`,
      { responseType: 'text', headers: { Accept: 'text/csv' } }
    );
    // Verbatim: the server owns the column order and the summary rows, and
    // re-deriving any of it on the client is exactly the duplication
    // docs/11-MONEY.md forbids.
    expect(result).toBe(csv);
  });
});
