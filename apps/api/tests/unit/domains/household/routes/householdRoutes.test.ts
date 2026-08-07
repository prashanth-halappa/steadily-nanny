/**
 * @module tests/unit/domains/household/routes/householdRoutes
 *
 * The member-removal and invite-revoke PATCHes are the first WRITES on this
 * router that address a nested resource by id, and both are guarded entirely by
 * middleware the route file wires up rather than by anything the controller
 * does. A controller test cannot see any of that: it cannot tell whether the
 * ownership validator is present (without it, ANY authenticated user could
 * remove a member of ANY household), whether the param schema survives
 * `validate()` intact, or whether the invite router still matches
 * `/invites/redeem` as a literal now that `/:householdId/invites/:inviteId`
 * exists.
 *
 * Approach copied from `tests/unit/domains/timesheet/routes/
 * householdTimesheetRoutes.test.ts`: a real `express()` app, the REAL router
 * mounted at the path `routes/index.ts` uses, the REAL presets, `validate()`
 * and `errorHandler`, driven over a real socket with `fetch`. Only the auth
 * boundary and the two services are stubbed.
 *
 * WHAT THIS PROVES:
 *  - A non-member gets 404 from the ownership validator BEFORE the command
 *    service is reached, on both new routes.
 *  - Both ids are validated as uuids, and `householdId` still reaches the
 *    ownership lookup after params are parsed.
 *  - A body outside the schema (member `status: 'bogus'`, invite
 *    `status: 'accepted'`) is 400'd before the service.
 *  - `status: 'active'` on a member is 400'd — reactivation is redeem-only.
 *  - `POST /invites/redeem` still resolves as a literal, not as
 *    `:householdId/...`, now that more `:householdId` routes exist.
 *
 * WHAT THIS DOES NOT PROVE:
 *  - Real Supabase JWT verification (`requireAuth` is stubbed) or the role
 *    gate (owner/parent), which lives in the mocked command service.
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

// Real RFC-4122 v4-shaped uuids — `z.uuid()` checks the version/variant nibbles.
const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_HOUSEHOLD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
// A SECOND stranger household, so the invite 404 test exercises its own
// ownership lookup instead of coasting on the negative relationship cache the
// members 404 test leaves behind (makeOwnershipValidator caches misses).
const OTHER_HOUSEHOLD_ID_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
// A THIRD stranger household for the leave route, same reason.
const OTHER_HOUSEHOLD_ID_3 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const INVITE_ID = 'dddddddd-dddd-4ddd-9ddd-dddddddddddd';
const AUTH_USER_ID = 'parent-1';

let server: import('node:http').Server;
let baseUrl: string;

let removeMemberMock: ReturnType<typeof mock>;
let revokeInviteMock: ReturnType<typeof mock>;
let redeemInviteMock: ReturnType<typeof mock>;
let leaveMock: ReturnType<typeof mock>;
let getOwnedMock: ReturnType<typeof mock>;

function patch(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function post(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
}

beforeAll(async () => {
  removeMemberMock = mock(async (..._args: unknown[]) => ({
    id: MEMBER_ID,
    status: 'removed',
  }));
  revokeInviteMock = mock(async (..._args: unknown[]) => ({
    id: INVITE_ID,
    status: 'revoked',
  }));
  redeemInviteMock = mock(async (..._args: unknown[]) => ({ id: 'm-new' }));
  leaveMock = mock(async (..._args: unknown[]) => ({
    id: MEMBER_ID,
    status: 'removed',
  }));
  getOwnedMock = mock(async (_userId: string, householdId: string) => ({
    id: householdId,
  }));

  mock.module('../../../../../src/middlewares/auth', () => ({
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { id: AUTH_USER_ID };
      next();
    },
    validateSupabaseToken: mock((_req: any, _res: any, next: any) => next()),
    extractBearerToken: mock(() => null),
  }));

  mock.module(
    '../../../../../src/domains/household/services/householdQueryService',
    () => ({
      householdQueryService: {
        getOwned: (...args: any[]) => getOwnedMock(...args),
        listForUser: mock(async () => []),
        listMembers: mock(async () => []),
        previewInvite: mock(async () => ({})),
      },
    })
  );
  mock.module(
    '../../../../../src/domains/household/services/householdCommandService',
    () => ({
      householdCommandService: {
        removeMember: (...args: any[]) => removeMemberMock(...args),
        revokeInvite: (...args: any[]) => revokeInviteMock(...args),
        redeemInvite: (...args: any[]) => redeemInviteMock(...args),
        leave: (...args: any[]) => leaveMock(...args),
        create: mock(async () => ({})),
        update: mock(async () => ({})),
        createInvite: mock(async () => ({})),
      },
    })
  );

  // Dynamic imports AFTER every mock.module() (docs/09-TESTING.md §4).
  const express = (await import('express')).default;
  const householdRoutes = (
    await import('../../../../../src/domains/household/routes/householdRoutes')
  ).default;
  const { requestId } = await import(
    '../../../../../src/middlewares/requestId'
  );
  const { errorHandler } = await import(
    '../../../../../src/middlewares/errorHandler'
  );

  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use('/households', householdRoutes);
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
  removeMemberMock.mockClear();
  revokeInviteMock.mockClear();
  redeemInviteMock.mockClear();
  leaveMock.mockClear();
});

describe('PATCH /households/:householdId/members/:memberId', () => {
  it('passes both ids through to the command service on a removal', async () => {
    const res = await patch(
      `/households/${HOUSEHOLD_ID}/members/${MEMBER_ID}`,
      { status: 'removed' }
    );

    expect(res.status).toBe(200);
    expect(removeMemberMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      MEMBER_ID
    );
  });

  it('404s a household the caller is not a member of, BEFORE the service', async () => {
    // The ownership preset is the only thing standing between an authenticated
    // stranger and another family's member list.
    getOwnedMock.mockImplementationOnce(async () => {
      const { HouseholdNotFoundError } = await import(
        '../../../../../src/domains/household/errors/householdErrors'
      );
      throw new HouseholdNotFoundError(OTHER_HOUSEHOLD_ID);
    });

    const res = await patch(
      `/households/${OTHER_HOUSEHOLD_ID}/members/${MEMBER_ID}`,
      { status: 'removed' }
    );

    expect(res.status).toBe(404);
    expect(removeMemberMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid memberId with 400 BEFORE the service', async () => {
    const res = await patch(`/households/${HOUSEHOLD_ID}/members/not-a-uuid`, {
      status: 'removed',
    });

    expect(res.status).toBe(400);
    expect(removeMemberMock).not.toHaveBeenCalled();
  });

  it('rejects a status outside the enum with 400 BEFORE the service', async () => {
    const res = await patch(
      `/households/${HOUSEHOLD_ID}/members/${MEMBER_ID}`,
      { status: 'bogus' }
    );

    expect(res.status).toBe(400);
    expect(removeMemberMock).not.toHaveBeenCalled();
  });

  it("rejects status: 'active' with 400 — reactivation is redeem-only", async () => {
    const res = await patch(
      `/households/${HOUSEHOLD_ID}/members/${MEMBER_ID}`,
      { status: 'active' }
    );

    expect(res.status).toBe(400);
    expect(removeMemberMock).not.toHaveBeenCalled();
  });

  it('rejects an empty body with 400', async () => {
    const res = await patch(
      `/households/${HOUSEHOLD_ID}/members/${MEMBER_ID}`,
      {}
    );

    expect(res.status).toBe(400);
    expect(removeMemberMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /households/:householdId/invites/:inviteId', () => {
  it('passes both ids through to the command service on a revoke', async () => {
    const res = await patch(
      `/households/${HOUSEHOLD_ID}/invites/${INVITE_ID}`,
      { status: 'revoked' }
    );

    expect(res.status).toBe(200);
    expect(revokeInviteMock).toHaveBeenCalledWith(
      AUTH_USER_ID,
      HOUSEHOLD_ID,
      INVITE_ID
    );
  });

  it('404s a household the caller is not a member of, BEFORE the service', async () => {
    getOwnedMock.mockImplementationOnce(async () => {
      const { HouseholdNotFoundError } = await import(
        '../../../../../src/domains/household/errors/householdErrors'
      );
      throw new HouseholdNotFoundError(OTHER_HOUSEHOLD_ID_2);
    });

    const res = await patch(
      `/households/${OTHER_HOUSEHOLD_ID_2}/invites/${INVITE_ID}`,
      { status: 'revoked' }
    );

    expect(res.status).toBe(404);
    expect(revokeInviteMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid inviteId with 400 BEFORE the service', async () => {
    const res = await patch(`/households/${HOUSEHOLD_ID}/invites/not-a-uuid`, {
      status: 'revoked',
    });

    expect(res.status).toBe(400);
    expect(revokeInviteMock).not.toHaveBeenCalled();
  });

  it("rejects any status other than 'revoked' with 400 — revoke is the only client transition", async () => {
    const res = await patch(
      `/households/${HOUSEHOLD_ID}/invites/${INVITE_ID}`,
      { status: 'accepted' }
    );

    expect(res.status).toBe(400);
    expect(revokeInviteMock).not.toHaveBeenCalled();
  });
});

describe('POST /households/:householdId/members/leave', () => {
  it('passes the caller and household through to the command service', async () => {
    // No body and no memberId: the caller IS the subject, which is the whole
    // difference from the removal PATCH.
    const res = await post(`/households/${HOUSEHOLD_ID}/members/leave`);

    expect(res.status).toBe(200);
    expect(leaveMock).toHaveBeenCalledWith(AUTH_USER_ID, HOUSEHOLD_ID);
  });

  it('404s a household the caller is not a member of, BEFORE the service', async () => {
    getOwnedMock.mockImplementationOnce(async () => {
      const { HouseholdNotFoundError } = await import(
        '../../../../../src/domains/household/errors/householdErrors'
      );
      throw new HouseholdNotFoundError(OTHER_HOUSEHOLD_ID_3);
    });

    const res = await post(`/households/${OTHER_HOUSEHOLD_ID_3}/members/leave`);

    expect(res.status).toBe(404);
    expect(leaveMock).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid householdId with 400 BEFORE the service', async () => {
    const res = await post('/households/not-a-uuid/members/leave');

    expect(res.status).toBe(400);
    expect(leaveMock).not.toHaveBeenCalled();
  });
});

describe('route ordering', () => {
  it('still matches /invites/redeem as a literal, not as :householdId', async () => {
    // The new `/:householdId/invites/:inviteId` route must stay BELOW the
    // literal invite routes; if it ever moves above, 'invites' starts being
    // read as a household id and redeem 400s on the uuid check.
    const res = await fetch(`${baseUrl}/households/invites/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ABC-234' }),
    });

    expect(res.status).toBe(200);
    expect(redeemInviteMock).toHaveBeenCalledWith(AUTH_USER_ID, {
      code: 'ABC-234',
    });
  });
});
