#!/usr/bin/env bun
/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ⚠  DESTRUCTIVE, WRITE-HEAVY END-TO-END TEST. LOCAL D1 ONLY.             │
 * │                                                                          │
 * │  Creates throwaway users, writes real rows (profile, device, household,  │
 * │  shift, change requests) and deletes them afterward. Direct DB writes go │
 * │  through scripts/lib/localDb.ts, which only ever binds the LOCAL D1 that │
 * │  `wrangler dev` persists to — so API_BASE_URL must be that local server. │
 * │  It refuses to run unless RUNBOOK_ALLOW_ROUNDTRIP=1 is set.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Level B re-certification harness: one command exercises a live local API —
 * Better Auth email sign-in → profile → device (FK order) → G4, the
 * concurrent-accept race on two pending change requests. Cleans up after
 * itself even on failure (try/finally).
 *
 * Usage (with `scripts/dev-local.sh api` running):
 *   RUNBOOK_ALLOW_ROUNDTRIP=1 bun scripts/level-b-roundtrip.ts
 *
 * Config:
 *   API_BASE_URL   optional (default http://127.0.0.1:8080)
 *
 * Exit code is non-zero if any assertion fails, so CI can gate on it.
 *
 * @module scripts/level-b-roundtrip
 */
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { type AnyD1Database, drizzle } from 'drizzle-orm/d1';
import { getPlatformProxy } from 'wrangler';
import { shiftLocalDate } from '../src/db/localDate';
import * as schema from '../src/db/schema';
import {
  householdMembers,
  households,
  shiftChangeRequests,
  shiftEvents,
  shifts,
  user,
  userProfiles,
} from '../src/db/schema';
import {
  type ChangeRequestOutcomeRow,
  eventsMatchRaceOutcome,
  isSingleWinnerRace,
  pickRaceWinner,
  type ShiftEventRow,
} from './lib/levelBRoundtripHelpers';

// ── Safety guard ─────────────────────────────────────────────────────────────
if (process.env.RUNBOOK_ALLOW_ROUNDTRIP !== '1') {
  console.error(
    '✗ Refusing to run. This is a destructive, write-heavy testbed harness.\n' +
      '  Set RUNBOOK_ALLOW_ROUNDTRIP=1 to confirm.'
  );
  process.exit(2);
}

// ── Config ───────────────────────────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080';
// Miniflare's on-disk D1 — the same files `wrangler dev` serves (and that
// scripts/lib/localDb.ts binds). Never the remote database: that would need
// `remote: true` on the binding.
const API_DIR = join(import.meta.dir, '..');
const proxy = await getPlatformProxy<{ DB: AnyD1Database }>({
  configPath: join(API_DIR, 'wrangler.jsonc'),
  persist: { path: join(API_DIR, '.wrangler', 'state', 'v3') },
});
const db = drizzle(proxy.env.DB, { schema });

// Random throwaway identity (`.test` TLD is reserved and never routable).
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const EMAIL = `roundtrip+${suffix}@example.test`;
const PASSWORD = `Rt-${Math.random().toString(36).slice(2)}-9A!`;

// ── Assertion tracking ───────────────────────────────────────────────────────
const passes: string[] = [];
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passes.push(line);
    console.log(`✓ ${line}`);
  } else {
    failures.push(line);
    console.log(`✗ ${line}`);
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
interface ApiResult {
  status: number;
  body: Record<string, unknown> | null;
}

/**
 * Better Auth email sign-up over HTTP (sign-up also signs in). The API
 * authenticates by session cookie, so the `Cookie` header value is the
 * credential.
 */
async function signUp(
  email: string,
  password: string,
  name: string
): Promise<{ id: string; cookie: string }> {
  const res = await fetch(`${API_BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) {
    throw new Error(`sign-up ${email} → ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { user?: { id?: string } };
  const cookie = res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ');
  return { id: body.user?.id ?? '', cookie };
}

let cookie = '';
async function api(
  method: string,
  path: string,
  body?: unknown,
  sessionCookie = cookie
): Promise<ApiResult> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

// ── Run ──────────────────────────────────────────────────────────────────────
let createdUserId: string | null = null;
let g4CarerUserId: string | null = null;
let createdHouseholdId: string | null = null;

console.log(`\n🔁 Level B round-trip — ${API_BASE_URL}`);
console.log(`   throwaway user: ${EMAIL}\n`);

try {
  // 1. Sign the throwaway user up through Better Auth.
  const owner = await signUp(EMAIL, PASSWORD, 'Round Trip');
  createdUserId = owner.id;
  cookie = owner.cookie;
  check(
    'sign up → user + session cookie',
    !!createdUserId && cookie.includes('session_token')
  );

  // 2. Profile create — the FK-parent row for device registration.
  const profile = await api('POST', '/api/v1/users/profile', {
    name: 'Round Trip',
    city: 'Testville',
    country: 'Testland',
  });
  check(
    'POST /users/profile → 201',
    profile.status === 201 && profile.body?.success === true,
    `status ${profile.status}`
  );

  // 3. Device register — MUST be after the profile (FK ordering contract).
  const device = await api('POST', '/api/v1/notifications/devices', {
    deviceId: `rt-device-${suffix}`,
    expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    platform: 'ios',
    notificationPermission: 'granted',
    timezone: 'America/Los_Angeles',
    appVersion: '1.0.0',
  });
  check(
    'POST /notifications/devices → 2xx (FK order OK)',
    device.status >= 200 &&
      device.status < 300 &&
      device.body?.success === true,
    `status ${device.status}`
  );

  // 4. G4 — concurrent accept serialisation.
  const carerEmail = `roundtrip-carer+${suffix}@example.test`;
  const carerPassword = `Rt-carer-${Math.random().toString(36).slice(2)}-9A!`;
  const carer = await signUp(carerEmail, carerPassword, 'Round Trip Carer');
  g4CarerUserId = carer.id;
  check(
    'G4 setup — carer sign up',
    !!g4CarerUserId && carer.cookie.includes('session_token')
  );

  await db
    .insert(userProfiles)
    .values({ user_id: g4CarerUserId, name: 'Round Trip Carer' })
    .onConflictDoNothing();

  const [household] = await db
    .insert(households)
    .values({
      name: 'Round Trip Household',
      timezone: 'America/Los_Angeles',
      created_by: createdUserId,
    })
    .returning({ id: households.id });
  const householdId = household?.id;
  createdHouseholdId = householdId ?? null;
  check('G4 setup — household insert', !!householdId);

  if (householdId) {
    await db.insert(householdMembers).values([
      {
        household_id: householdId,
        user_id: createdUserId,
        role: 'owner',
        can_edit: true,
      },
      {
        household_id: householdId,
        user_id: g4CarerUserId,
        role: 'nanny',
        can_edit: false,
      },
    ]);

    const weekOut = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const startsAt = new Date(weekOut).toISOString();
    const endsAt = new Date(weekOut + 8 * 60 * 60 * 1000).toISOString();
    const altStarts = new Date(weekOut + 60 * 60 * 1000).toISOString();
    const altEnds = new Date(weekOut + 9 * 60 * 60 * 1000).toISOString();

    const [shiftRow] = await db
      .insert(shifts)
      .values({
        household_id: householdId,
        carer_id: g4CarerUserId,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: 'America/Los_Angeles',
        local_date: shiftLocalDate(startsAt, 'America/Los_Angeles'),
        kind: 'recurring',
        status: 'confirmed',
        origin: 'system_generated',
        sequence: 0,
      })
      .returning({ id: shifts.id, sequence: shifts.sequence });
    check('G4 setup — shift insert', !!shiftRow?.id);

    if (shiftRow) {
      // crA is opened through the REAL open path (POST .../change-requests),
      // so the open guard runs end-to-end for at least one row.
      //
      // crB CANNOT go through the same path: opening a request supersedes any
      // OTHER pending request on the shift, so two requests can never be
      // simultaneously 'pending' via the API. A direct insert is the only way
      // to reach the two-pending state the race below exercises: a
      // defense-in-depth check on the accept's compare-and-set against a
      // state real traffic never produces.
      const openCrA = await api(
        'POST',
        `/api/v1/shifts/${shiftRow.id}/change-requests`,
        {
          kind: 'time_change',
          proposed_starts_at: altStarts,
          proposed_ends_at: altEnds,
          message: 'Can we start an hour later?',
        }
      );
      const openedData = openCrA.body?.data as
        | { shift_change_request?: { id?: string } }
        | undefined;
      const crAId = openedData?.shift_change_request?.id;
      check(
        'G4 setup — change request A opened via real endpoint',
        openCrA.status === 200 && !!crAId,
        `status ${openCrA.status}`
      );

      const [crBRow] = crAId
        ? await db
            .insert(shiftChangeRequests)
            .values({
              shift_id: shiftRow.id,
              requested_by: createdUserId,
              kind: 'time_change',
              proposed_starts_at: startsAt,
              proposed_ends_at: endsAt,
              message: 'Actually keep original?',
              status: 'pending',
            })
            .returning({ id: shiftChangeRequests.id })
        : [];
      check(
        'G4 setup — change request B inserted directly (two-pending race fixture)',
        !!crBRow?.id
      );

      if (crAId && crBRow) {
        const respond = (id: string) =>
          api(
            'POST',
            `/api/v1/change-requests/${id}/respond`,
            { status: 'accepted' },
            carer.cookie
          );
        const [first, second] = await Promise.all([
          respond(crAId),
          respond(crBRow.id),
        ]);
        check(
          'G4 concurrent accept — one 2xx + one 409',
          isSingleWinnerRace(first.status, second.status),
          `statuses ${first.status}, ${second.status}`
        );

        const finalCrs: ChangeRequestOutcomeRow[] = await db
          .select({
            id: shiftChangeRequests.id,
            status: shiftChangeRequests.status,
          })
          .from(shiftChangeRequests)
          .where(inArray(shiftChangeRequests.id, [crAId, crBRow.id]));
        const winner = pickRaceWinner(finalCrs);
        check(
          'G4 — one accepted + one superseded',
          winner !== null,
          `rows=${JSON.stringify(finalCrs)}`
        );

        const [finalShift] = await db
          .select({ sequence: shifts.sequence })
          .from(shifts)
          .where(eq(shifts.id, shiftRow.id));
        check(
          'G4 — shift sequence +1 after winning time-change accept',
          finalShift?.sequence === shiftRow.sequence + 1,
          `sequence=${finalShift?.sequence}`
        );

        // The accept's shift mutation and its day-thread events must land
        // atomically. The row statuses above say nothing about that — this does.
        if (winner) {
          const events: ShiftEventRow[] = await db
            .select({
              event_type: shiftEvents.event_type,
              payload: shiftEvents.payload,
            })
            .from(shiftEvents)
            .where(eq(shiftEvents.shift_id, shiftRow.id));
          check(
            'G4 — shift_events atomic with the winning accept',
            eventsMatchRaceOutcome(events, winner),
            `events=${JSON.stringify(events)}`
          );
        }
      }
    }
  }
} catch (error) {
  check(
    'unexpected error',
    false,
    error instanceof Error ? error.message : String(error)
  );
} finally {
  // Household FIRST: households.created_by and shifts.carer_id are ON DELETE
  // SET NULL, so deleting the users alone would strand the household + shift.
  // Deleting the household cascades members, shifts, change requests, events.
  try {
    if (createdHouseholdId) {
      await db.delete(households).where(eq(households.id, createdHouseholdId));
      console.log(`\n🧹 cleaned up household ${createdHouseholdId.slice(0, 8)}`);
    }
    // Deleting a user cascades its profile, sessions, accounts and devices.
    const userIds = [createdUserId, g4CarerUserId].filter(
      (id): id is string => !!id
    );
    if (userIds.length) {
      await db.delete(user).where(inArray(user.id, userIds));
      console.log(`🧹 cleaned up ${userIds.length} throwaway user(s)`);
    }
  } catch (error) {
    console.log(
      `\n⚠ cleanup FAILED: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  await proxy.dispose();
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(
  `\n──────── ${passes.length} pass / ${failures.length} fail ────────`
);
for (const f of failures) {
  console.log(`  ✗ ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
