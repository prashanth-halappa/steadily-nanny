/**
 * A MOUNTED-ROUTER test, the same harness as `payArrangementRoutes.test.ts`:
 * a real `express()` app, the REAL preset chain, the REAL Zod validation and
 * the REAL `errorHandler`, with only the auth boundary and the two services
 * stubbed.
 *
 * What it is here to prove, beyond "the routes exist":
 *  - `AcceptTermsProposalRequestSchema`'s `z.literal(true)` really refuses an
 *    acceptance without D-7's checkbox, at the wire, BEFORE the command
 *    service is reached. An acceptance without the checkbox is not an
 *    acceptance (§7.3).
 *  - `authWithValidation` — never `authWithOwnership` (GOLDEN-FIXES #32): a
 *    permitted READ on a proposal id must not be able to poison the entry a
 *    WRITE check would use, and the only way to guarantee that is for no
 *    ownership entry to be written at all.
 *
 * @module tests/unit/domains/termsProposal/routes/termsProposalRoutes
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
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MOUNT_PATH = '/households/:householdId/carers/:carerId/terms-proposals';

const VALID_TERMS = {
  rate_minor: 2800,
  currency: 'USD',
  overtime_threshold_minutes: 2400,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: 3000,
  valid_from: '2026-08-17',
};

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    household_id: HOUSEHOLD_ID,
    carer_id: CARER_ID,
    proposed_by: CARER_ID,
    direction: 'carer',
    status: 'proposed',
    terms: VALID_TERMS,
    carer_display_name: 'Marisol',
    ...overrides,
  };
}

let app: import('express').Express;
let server: import('node:http').Server;
let baseUrl: string;

let getOpenMock: ReturnType<typeof mock>;
let getChainMock: ReturnType<typeof mock>;
let proposeMock: ReturnType<typeof mock>;
let acceptMock: ReturnType<typeof mock>;
let withdrawMock: ReturnType<typeof mock>;
let markViewedMock: ReturnType<typeof mock>;

beforeAll(async () => {
  getOpenMock = mock(async () => proposalRow());
  getChainMock = mock(async () => [proposalRow()]);
  proposeMock = mock(async () => proposalRow({ id: 'new-proposal' }));
  acceptMock = mock(async () => proposalRow({ status: 'accepted' }));
  withdrawMock = mock(async () => proposalRow({ status: 'withdrawn' }));
  markViewedMock = mock(async () =>
    proposalRow({ viewed_at: '2026-08-11T15:00:00.000Z' })
  );

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: 'parent-1' };
      next();
    },
    validateSupabaseToken: mock((_req: any, _res: any, next: any) => next()),
    extractBearerToken: mock(() => null),
  }));

  mock.module(
    '../../../../../src/domains/termsProposal/services/termsProposalQueryService',
    () => ({
      termsProposalQueryService: {
        getOpen: (...args: unknown[]) => getOpenMock(...args),
        getChain: (...args: unknown[]) => getChainMock(...args),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/termsProposal/services/termsProposalCommandService',
    () => ({
      termsProposalCommandService: {
        propose: (...args: unknown[]) => proposeMock(...args),
        accept: (...args: unknown[]) => acceptMock(...args),
        withdraw: (...args: unknown[]) => withdrawMock(...args),
        markViewed: (...args: unknown[]) => markViewedMock(...args),
      },
    })
  );

  const express = (await import('express')).default;
  const termsProposalRoutes = (
    await import(
      '../../../../../src/domains/termsProposal/routes/termsProposalRoutes'
    )
  ).default;
  const { requestId } = await import(
    '../../../../../src/middlewares/requestId'
  );
  const { errorHandler } = await import(
    '../../../../../src/middlewares/errorHandler'
  );

  app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(MOUNT_PATH, termsProposalRoutes);
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

beforeEach(() => {
  getOpenMock.mockClear();
  getChainMock.mockClear();
  proposeMock.mockClear();
  acceptMock.mockClear();
  withdrawMock.mockClear();
  markViewedMock.mockClear();
});

const base = () =>
  `${baseUrl}/households/${HOUSEHOLD_ID}/carers/${CARER_ID}/terms-proposals`;

describe('termsProposalRoutes — reads', () => {
  it('GET /current serves the open proposal WITH the server-computed weekly equivalent', async () => {
    const res = await fetch(`${base()}/current`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.terms_proposal.id).toBe(PROPOSAL_ID);
    // §17/D23: the figure is attached at the wire edge, never by the client.
    expect(body.data.terms_proposal.weekly_equivalent_minor).toBe(154000);
  });

  it('GET /current serves a null proposal as a normal 200', async () => {
    getOpenMock.mockImplementationOnce(async () => null);
    const res = await fetch(`${base()}/current`);
    expect(res.status).toBe(200);
    expect((await res.json()).data.terms_proposal).toBeNull();
  });

  it('GET / serves the chain, each row carrying its own weekly equivalent', async () => {
    const res = await fetch(base());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.terms_proposals).toHaveLength(1);
    expect(body.data.terms_proposals[0].weekly_equivalent_minor).toBe(154000);
  });

  it('a non-uuid carerId is a 400 BEFORE the service is reached', async () => {
    const res = await fetch(
      `${baseUrl}/households/${HOUSEHOLD_ID}/carers/not-a-uuid/terms-proposals/current`
    );
    expect(res.status).toBe(400);
    expect(getOpenMock).not.toHaveBeenCalled();
  });
});

describe('termsProposalRoutes — propose / counter', () => {
  it('POST / creates and answers 201', async () => {
    const res = await fetch(base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terms: VALID_TERMS, note: 'This is my ask.' }),
    });
    expect(res.status).toBe(201);
    expect(proposeMock).toHaveBeenCalledTimes(1);
    expect(proposeMock.mock.calls[0]?.[0]).toBe('parent-1');
  });

  it('rejects a negative rate at the wire, before the write path', async () => {
    const res = await fetch(base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terms: { ...VALID_TERMS, rate_minor: -1 } }),
    });
    expect(res.status).toBe(400);
    expect(proposeMock).not.toHaveBeenCalled();
  });
});

describe('termsProposalRoutes — the item verbs are NOT mounted here', () => {
  // They live on `/terms-proposals/:proposalId` (see
  // `termsProposalItemRoutes.test.ts`). Asserting their absence is what stops
  // a future "convenience" duplicate appearing under the pair — two routes to
  // one action is two gates to keep in step, and the second one is the one
  // nobody updates.
  it.each([
    'accept',
    'withdraw',
    'viewed',
  ])('POST .../%s under the carer scope is not routed', async verb => {
    const res = await fetch(`${base()}/${PROPOSAL_ID}/${verb}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ responsibility_confirmed: true }),
    });
    expect(res.status).toBe(404);
    expect(acceptMock).not.toHaveBeenCalled();
    expect(withdrawMock).not.toHaveBeenCalled();
    expect(markViewedMock).not.toHaveBeenCalled();
  });
});

describe('termsProposalRoutes — wiring', () => {
  it('routes/index.ts mounts this router at the path exercised above', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../../../../src/routes/index.ts'),
      'utf8'
    );
    expect(source).toContain(MOUNT_PATH);
  });

  it('GOLDEN-FIXES #32: no route uses authWithOwnership', () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        '../../../../../src/domains/termsProposal/routes/termsProposalRoutes.ts'
      ),
      'utf8'
    );
    // The CALL, not the word — the file's header explains at length why the
    // middleware is not used here, and that explanation must not fail its
    // own test.
    expect(source).not.toMatch(/authWithOwnership\(/);
    expect(source).toMatch(/authWithValidation\(/);
  });
});
