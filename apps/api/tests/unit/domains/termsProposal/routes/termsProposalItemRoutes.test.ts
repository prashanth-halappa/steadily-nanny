/**
 * The ITEM router — one proposal, by id alone. Same mounted-router harness as
 * `termsProposalRoutes.test.ts`: real express, real preset chain, real Zod,
 * real `errorHandler`, with only the auth boundary and the services stubbed.
 *
 * The two things worth a mounted test rather than a service one:
 *  - `AcceptTermsProposalRequestSchema`'s `z.literal(true)` really refuses an
 *    acceptance without D-7's checkbox, at the wire, before the command
 *    service is reached. An acceptance without the checkbox is not an
 *    acceptance (§7.3).
 *  - No route here carries ownership middleware (GOLDEN-FIXES #32). The read
 *    circle on `GET /:proposalId` is genuinely wider than `accept`'s gate, so
 *    a shared `(user, resource)` cache entry would let one permitted read
 *    remove the accept guard for an hour. The static check at the bottom is
 *    what keeps that true.
 *
 * @module tests/unit/domains/termsProposal/routes/termsProposalItemRoutes
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
const MOUNT_PATH = '/terms-proposals';
const FIXTURE_VIEWED_AT = new Date().toISOString();

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

let getByIdMock: ReturnType<typeof mock>;
let acceptMock: ReturnType<typeof mock>;
let withdrawMock: ReturnType<typeof mock>;
let markViewedMock: ReturnType<typeof mock>;

beforeAll(async () => {
  getByIdMock = mock(async () => proposalRow());
  acceptMock = mock(async () => proposalRow({ status: 'accepted' }));
  withdrawMock = mock(async () => proposalRow({ status: 'withdrawn' }));
  markViewedMock = mock(async () =>
    proposalRow({ viewed_at: FIXTURE_VIEWED_AT })
  );

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (
      req: { user?: { id: string } },
      _res: unknown,
      next: () => void
    ) => {
      req.user = { id: 'parent-1' };
      next();
    },
    validateSupabaseToken: mock((_r: unknown, _s: unknown, next: () => void) =>
      next()
    ),
    extractBearerToken: mock(() => null),
  }));

  mock.module(
    '../../../../../src/domains/termsProposal/services/termsProposalQueryService',
    () => ({
      termsProposalQueryService: {
        getById: (...args: unknown[]) => getByIdMock(...args),
        getOpen: mock(async () => null),
        getChain: mock(async () => []),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/termsProposal/services/termsProposalCommandService',
    () => ({
      termsProposalCommandService: {
        propose: mock(async () => proposalRow()),
        accept: (...args: unknown[]) => acceptMock(...args),
        withdraw: (...args: unknown[]) => withdrawMock(...args),
        markViewed: (...args: unknown[]) => markViewedMock(...args),
      },
    })
  );

  const express = (await import('express')).default;
  const itemRoutes = (
    await import(
      '../../../../../src/domains/termsProposal/routes/termsProposalItemRoutes'
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
  app.use(MOUNT_PATH, itemRoutes);
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
  getByIdMock.mockClear();
  acceptMock.mockClear();
  withdrawMock.mockClear();
  markViewedMock.mockClear();
});

const item = () => `${baseUrl}/terms-proposals/${PROPOSAL_ID}`;

describe('termsProposalItemRoutes — the deep-link read', () => {
  it('GET /:proposalId needs nothing but the id, and carries the weekly figure', async () => {
    const res = await fetch(item());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.terms_proposal.id).toBe(PROPOSAL_ID);
    // §17/D23 — server-computed, never rate x hours on the client.
    expect(body.data.terms_proposal.weekly_equivalent_minor).toBe(154000);
  });

  it('passes only the caller and the id to the service', async () => {
    await fetch(item());
    expect(getByIdMock.mock.calls[0]).toEqual(['parent-1', PROPOSAL_ID]);
  });

  it('a non-uuid proposalId is a 400 before the service is reached', async () => {
    const res = await fetch(`${baseUrl}/terms-proposals/not-a-uuid`);
    expect(res.status).toBe(400);
    expect(getByIdMock).not.toHaveBeenCalled();
  });
});

describe('termsProposalItemRoutes — accept, the binding act', () => {
  it('POST /:proposalId/accept with the checkbox succeeds', async () => {
    const res = await fetch(`${item()}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ responsibility_confirmed: true }),
    });
    expect(res.status).toBe(200);
    expect(acceptMock.mock.calls[0]?.slice(0, 2)).toEqual([
      'parent-1',
      PROPOSAL_ID,
    ]);
  });

  it('§7.3: an acceptance WITHOUT the checkbox is refused at the wire', async () => {
    const res = await fetch(`${item()}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ responsibility_confirmed: false }),
    });
    expect(res.status).toBe(400);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('an acceptance with the field missing entirely is refused too', async () => {
    const res = await fetch(`${item()}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(acceptMock).not.toHaveBeenCalled();
  });
});

describe('termsProposalItemRoutes — withdraw and viewed', () => {
  it('POST /:proposalId/withdraw resolves the row', async () => {
    const res = await fetch(`${item()}/withdraw`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.terms_proposal.status).toBe('withdrawn');
  });

  it('POST /:proposalId/viewed stamps the receipt', async () => {
    const res = await fetch(`${item()}/viewed`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(markViewedMock.mock.calls[0]).toEqual(['parent-1', PROPOSAL_ID]);
  });

  it('there is no PATCH and no DELETE — the table is append-only', async () => {
    for (const method of ['PATCH', 'DELETE']) {
      const res = await fetch(item(), { method });
      expect(res.status).toBe(404);
    }
  });
});

describe('termsProposalItemRoutes — wiring', () => {
  it('routes/index.ts mounts this router at the path exercised above', () => {
    const source = readFileSync(
      join(import.meta.dir, '../../../../../src/routes/index.ts'),
      'utf8'
    );
    expect(source).toContain(`router.use('${MOUNT_PATH}'`);
  });

  it('GOLDEN-FIXES #32: no route here uses authWithOwnership', () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        '../../../../../src/domains/termsProposal/routes/termsProposalItemRoutes.ts'
      ),
      'utf8'
    );
    // The CALL, not the word — the file's header explains at length why the
    // middleware is not used here, and that explanation must not fail its own
    // test.
    expect(source).not.toMatch(/authWithOwnership\(/);
    expect(source).toMatch(/authWithValidation\(/);
  });
});
