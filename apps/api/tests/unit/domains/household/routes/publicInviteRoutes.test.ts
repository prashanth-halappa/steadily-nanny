/**
 * @module tests/unit/domains/household/routes/publicInviteRoutes
 *
 * The public terms page's two routes (§6.2). A controller test cannot see what
 * actually matters about them, which is entirely a property of the wiring:
 *
 *  - They answer with NO Authorization header. If they ever end up behind
 *    `validateSupabaseToken`, the page 401s for every parent who was sent a
 *    link, and nothing in a service test would notice.
 *  - The 404 body is opaque — no reason, no code echo (§12 "Error — web page,
 *    dead code").
 *  - The 200 body is thin: rendered rows, her first name and last initial, and
 *    nothing else. Her surname, the household id and the proposal id all exist
 *    on the row the service hands the controller, so "the controller shapes it
 *    field by field" is a claim worth pinning to the actual response.
 *  - `POST /:code/opened` answers 204 for a made-up code too, so it cannot be
 *    used to enumerate live invites.
 *
 * Same approach as `householdRoutes.test.ts`: a real `express()` app, the REAL
 * router and `validate()` and `errorHandler`, driven over a socket. Only the
 * query service and the invite repository are stubbed.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test';
import type { AddressInfo } from 'node:net';

const CODE = 'R4K-92T';

let server: import('node:http').Server;
let baseUrl: string;
let termsPreview: ReturnType<typeof mock>;
let stampOpened: ReturnType<typeof mock>;

/** A full open proposal row, as the repository returns it. */
function proposalRow() {
  return {
    id: 'p1',
    household_id: 'h-draft',
    carer_id: 'u-nanny',
    proposed_by: 'u-nanny',
    direction: 'carer',
    status: 'proposed',
    terms: {
      rate_minor: 2800,
      currency: 'USD',
      guaranteed_minutes_per_week: 3000,
      valid_from: '2026-08-17',
    },
    note: null,
    supersedes_id: null,
    from_invite_id: null,
    carer_display_name: 'Marisol Mendez',
    viewed_at: null,
    responded_at: null,
    accepted_by: null,
    accepted_arrangement_id: null,
    responsibility_confirmed: false,
    created_at: '2026-08-10T00:00:00.000Z',
    updated_at: '2026-08-10T00:00:00.000Z',
  };
}

beforeAll(async () => {
  termsPreview = mock(async () => ({
    code: CODE,
    carer_name: 'Marisol M.',
    proposed_at: '2026-08-10T00:00:00.000Z',
    link_expires_at: '2026-08-17T00:00:00.000Z',
    currency: 'USD',
    proposal: proposalRow(),
  }));
  stampOpened = mock(async () => {});

  mock.module(
    '../../../../../src/domains/household/services/householdQueryService',
    () => ({ householdQueryService: { termsPreview } })
  );
  mock.module(
    '../../../../../src/domains/household/repositories/householdInviteRepository',
    () => ({
      HouseholdInviteRepository: class {
        stampOpened = stampOpened;
      },
    })
  );

  const express = (await import('express')).default;
  const { default: publicInviteRoutes } = await import(
    '../../../../../src/domains/household/routes/publicInviteRoutes'
  );
  const { errorHandler } = await import(
    '../../../../../src/middlewares/errorHandler'
  );

  const app = express();
  app.use(express.json());
  // Mounted exactly where `app.ts` mounts it, and with NOTHING in front of it —
  // that absence is what the first test below is about.
  app.use('/api/v1/household-invites', publicInviteRoutes);
  app.use(errorHandler);

  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  termsPreview.mockClear();
  stampOpened.mockClear();
});

describe('GET /v1/household-invites/:code/terms-preview', () => {
  it('answers with no Authorization header at all', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/household-invites/${CODE}/terms-preview`
    );

    expect(res.status).toBe(200);
    expect(termsPreview).toHaveBeenCalledWith(CODE);
  });

  it('returns RENDERED rows and the server-computed weekly figure', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/household-invites/${CODE}/terms-preview`
    );
    const body = (await res.json()) as any;

    // 50 guaranteed hours at $28.00 with no overtime tier set: the engine's
    // answer, never `rate × hours` in a client (§17, D23).
    expect(body.data.weekly_equivalent_minor).toBe(140000);
    // The hero pair is separate from the rows, the way the app draws it.
    expect(body.data.rate).toBe('$28.00');
    expect(body.data.weekly_line).toBe(
      '$1,400.00 a week at 50 guaranteed hours'
    );
    expect(
      body.data.rows.every((row: any) => typeof row.value === 'string')
    ).toBe(true);
  });

  it('prints her first name and last initial, and never her surname', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/household-invites/${CODE}/terms-preview`
    );
    const text = await res.text();

    expect(text).toContain('Marisol M.');
    expect(text).not.toContain('Mendez');
  });

  it('leaks no id from the row the controller was handed', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/household-invites/${CODE}/terms-preview`
    );
    const text = await res.text();

    expect(text).not.toContain('h-draft');
    expect(text).not.toContain('u-nanny');
  });

  it('renders one opaque 404 — no reason, no code echo (§12)', async () => {
    const { InviteNotFoundError } = await import(
      '../../../../../src/domains/household/errors/householdErrors'
    );
    termsPreview.mockImplementationOnce(async () => {
      throw new InviteNotFoundError(CODE);
    });

    const res = await fetch(
      `${baseUrl}/api/v1/household-invites/NOPE-01/terms-preview`
    );
    const body = (await res.json()) as any;

    expect(res.status).toBe(404);
    // `BaseError` ships `metadata` to the client on a 4xx (BaseError.ts:64),
    // so a reason attached to the throw would BE the disclosure. The only
    // `reason` here is the generic error code every InviteNotFoundError
    // carries; which row of §6.2's table fired goes to the log instead.
    expect(body.error.metadata.reason).toBe('INVITE_NOT_FOUND');
    expect(body.error.message).toBe('Invite not found');
  });
});

describe('POST /v1/household-invites/:code/opened', () => {
  it('stamps the receipt and answers 204, unauthenticated', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/household-invites/${CODE}/opened`,
      { method: 'POST' }
    );

    expect(res.status).toBe(204);
    expect(stampOpened).toHaveBeenCalledWith(CODE);
  });

  it('answers 204 for a code that does not exist — never an enumeration oracle', async () => {
    // The repository update matches zero rows; the caller learns nothing, which
    // is the whole design of an unauthenticated write keyed on a short string.
    const res = await fetch(
      `${baseUrl}/api/v1/household-invites/ZZZ-999/opened`,
      { method: 'POST' }
    );

    expect(res.status).toBe(204);
  });
});
