#!/usr/bin/env bun
/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ⚠  DANGER — DESTRUCTIVE, WRITE-HEAVY END-TO-END TEST. TESTBED ONLY.     │
 * │                                                                          │
 * │  This script creates a throwaway auth user, writes real rows (profile,   │
 * │  device), and DELETES the user (with cascade) afterward. NEVER point it  │
 * │  at a production Supabase project.                                       │
 * │  It refuses to run unless RUNBOOK_ALLOW_ROUNDTRIP=1 is set.               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Level B re-certification harness: one command exercises the whole template
 * against a live API + Supabase — profile → device (FK order). Cleans up after
 * itself even on failure (try/finally).
 *
 * TODO(wave-1): replace with the nanny round-trip — the widget CRUD /
 * generate-description / notify / job-endpoint / quota-gate / atomic-counter
 * steps that used to live here were removed along with the widget and
 * subscription example domains.
 *
 * Usage:
 *   RUNBOOK_ALLOW_ROUNDTRIP=1 bun scripts/level-b-roundtrip.ts
 *
 * Config (from the environment; a local `.env` in cwd is auto-loaded):
 *   SUPABASE_URL           required
 *   SUPABASE_SERVICE_KEY   required (service role — admin user create/delete)
 *   SUPABASE_ANON_KEY      required (sign in for a real JWT)
 *   API_BASE_URL           optional (default http://127.0.0.1:8099)
 *
 * Exit code is non-zero if any assertion fails, so CI can gate on it.
 *
 * @module scripts/level-b-roundtrip
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  type ChangeRequestOutcomeRow,
  eventsMatchRaceOutcome,
  isSingleWinnerRace,
  pickRaceWinner,
  type ShiftEventRow,
} from './lib/levelBRoundtripHelpers';

dotenv.config();

// ── Safety guard ─────────────────────────────────────────────────────────────
if (process.env.RUNBOOK_ALLOW_ROUNDTRIP !== '1') {
  console.error(
    '✗ Refusing to run. This is a destructive, write-heavy testbed harness.\n' +
      '  Set RUNBOOK_ALLOW_ROUNDTRIP=1 to confirm this is NOT a production project.'
  );
  process.exit(2);
}

// ── Config ───────────────────────────────────────────────────────────────────
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ Missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

const SUPABASE_URL = required('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = required('SUPABASE_SERVICE_KEY');
const SUPABASE_ANON_KEY = required('SUPABASE_ANON_KEY');
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8099';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

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

// ── HTTP helper ──────────────────────────────────────────────────────────────
interface ApiResult {
  status: number;
  body: Record<string, unknown> | null;
}

let token = '';
async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<ApiResult> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...extraHeaders,
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
  // 1. Create the throwaway user + sign in for a real JWT.
  const { data: createdData, error: createErr } =
    await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
  createdUserId = createdData.user?.id ?? null;
  check('admin createUser', !createErr && !!createdUserId, createErr?.message);

  const { data: signInData, error: signInErr } =
    await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  token = signInData.session?.access_token ?? '';
  check(
    'sign in → JWT',
    !signInErr && token.length > 20,
    signInErr?.message ?? `token …${token.slice(-6)}`
  );
  if (!token) {
    throw new Error('No access token — cannot continue.');
  }

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

  // 4. G4 — concurrent accept serialisation (opt-in live DB; needs migrations 024–029).
  const carerEmail = `roundtrip-carer+${suffix}@example.test`;
  const carerPassword = `Rt-carer-${Math.random().toString(36).slice(2)}-9A!`;

  const { data: carerAuth, error: carerCreateErr } =
    await admin.auth.admin.createUser({
      email: carerEmail,
      password: carerPassword,
      email_confirm: true,
    });
  g4CarerUserId = carerAuth.user?.id ?? null;
  check(
    'G4 setup — carer createUser',
    !carerCreateErr && !!g4CarerUserId,
    carerCreateErr?.message
  );

  if (createdUserId && g4CarerUserId) {
    await admin.from('user_profiles').upsert({
      user_id: g4CarerUserId,
      name: 'Round Trip Carer',
    });

    const { data: household, error: hhErr } = await admin
      .from('households')
      .insert({
        name: 'Round Trip Household',
        timezone: 'America/Los_Angeles',
        created_by: createdUserId,
      })
      .select('id')
      .single();

    const householdId = household?.id;
    createdHouseholdId = householdId ?? null;
    check('G4 setup — household insert', !hhErr && !!householdId, hhErr?.message);

    if (householdId) {
      await admin.from('household_members').insert([
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

      const { data: shiftRow, error: shiftErr } = await admin
        .from('shifts')
        .insert({
          household_id: householdId,
          carer_id: g4CarerUserId,
          starts_at: startsAt,
          ends_at: endsAt,
          timezone: 'America/Los_Angeles',
          kind: 'recurring',
          status: 'confirmed',
          origin: 'system_generated',
          sequence: 0,
        })
        .select('id, sequence')
        .single();

      check(
        'G4 setup — shift insert',
        !shiftErr && !!shiftRow?.id,
        shiftErr?.message
      );

      if (shiftRow?.id) {
        // crA is opened through the REAL open path — POST
        // .../change-requests, which the API routes to the
        // open_shift_change_request RPC (migration 028) — so that guard
        // actually runs end-to-end for at least one of this fixture's rows,
        // instead of being bypassed entirely.
        //
        // crB CANNOT go through the same path: open_shift_change_request
        // unconditionally supersedes any OTHER pending request on the shift
        // under a `for update` row lock (migrations 024/028), so two
        // requests can never be simultaneously 'pending' via the API —
        // sequentially or concurrently, the lock serialises even racing
        // opens. That invariant is exactly why a direct insert is the only
        // way to reach the two-pending state the G4 race below exercises: it
        // is a defense-in-depth check on accept_shift_change_request's CAS
        // logic (migration 029) against a state real user traffic can never
        // actually produce.
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
          'G4 setup — change request A opened via real endpoint (exercises 028 guard)',
          openCrA.status === 200 && !!crAId,
          `status ${openCrA.status}`
        );

        const { data: crBRow, error: crBErr } = crAId
          ? await admin
              .from('shift_change_requests')
              .insert({
                shift_id: shiftRow.id,
                requested_by: createdUserId,
                kind: 'time_change',
                proposed_starts_at: startsAt,
                proposed_ends_at: endsAt,
                message: 'Actually keep original?',
                status: 'pending',
              })
              .select('id')
              .single()
          : { data: null, error: null };

        check(
          'G4 setup — change request B inserted directly (two-pending race fixture)',
          !crBErr && !!crBRow?.id,
          crBErr?.message
        );

        if (crAId && crBRow?.id) {
          const crA = { id: crAId };
          const crB = { id: crBRow.id };
          const { data: carerSignIn, error: carerSignInErr } =
            await anon.auth.signInWithPassword({
              email: carerEmail,
              password: carerPassword,
            });
          const carerToken = carerSignIn.session?.access_token ?? '';
          check(
            'G4 — carer sign in',
            !carerSignInErr && carerToken.length > 20,
            carerSignInErr?.message
          );

          if (carerToken) {
            const respond = (changeRequestId: string) =>
              fetch(
                `${API_BASE_URL}/api/v1/change-requests/${changeRequestId}/respond`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${carerToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ status: 'accepted' }),
                }
              ).then(async res => ({
                id: changeRequestId,
                status: res.status,
              }));

            const [first, second] = await Promise.all([
              respond(crA.id),
              respond(crB.id),
            ]);
            check(
              'G4 concurrent accept — one 2xx + one 409',
              isSingleWinnerRace(first.status, second.status),
              `statuses ${first.status}, ${second.status}`
            );

            const { data: finalCrs } = await admin
              .from('shift_change_requests')
              .select('id, status')
              .in('id', [crA.id, crB.id]);
            const winner = pickRaceWinner(
              (finalCrs ?? []) as ChangeRequestOutcomeRow[]
            );
            check(
              'G4 — one accepted + one superseded',
              winner !== null,
              `rows=${JSON.stringify(finalCrs)}`
            );

            const { data: finalShift } = await admin
              .from('shifts')
              .select('sequence')
              .eq('id', shiftRow.id)
              .single();
            check(
              'G4 — shift sequence +1 after winning time-change accept',
              finalShift?.sequence === (shiftRow.sequence ?? 0) + 1,
              `sequence=${finalShift?.sequence}`
            );

            // Migration 029's whole purpose: the accept's shift mutation and
            // its day-thread events land atomically. Verifying the row
            // statuses above says nothing about that — this does.
            if (winner) {
              const { data: shiftEvents } = await admin
                .from('shift_events')
                .select('event_type, payload')
                .eq('shift_id', shiftRow.id);
              check(
                'G4 — shift_events atomic with the winning accept (029)',
                eventsMatchRaceOutcome(
                  (shiftEvents ?? []) as ShiftEventRow[],
                  winner
                ),
                `events=${JSON.stringify(shiftEvents)}`
              );
            }
          }
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
  // Household cleanup FIRST. households.created_by (009_households.sql:59-60)
  // and shifts.carer_id (015_shifts.sql:25) are ON DELETE SET NULL, NOT
  // cascade, so deleting the throwaway users below would strand this
  // household + shift permanently rather than removing them. Deleting the
  // household row itself does cascade the whole tree hung off it:
  // household_members (009_households.sql:71-72), shifts
  // (015_shifts.sql:23), which in turn cascades shift_change_requests
  // (015_shifts.sql:151) and shift_children (015_shifts.sql:113), and
  // shift_events via both its household_id and shift_id FKs
  // (015_shifts.sql:193-194) — one delete covers everything G4 created.
  if (createdHouseholdId) {
    const { error: hhDelErr } = await admin
      .from('households')
      .delete()
      .eq('id', createdHouseholdId);
    console.log(
      hhDelErr
        ? `\n⚠ cleanup FAILED to delete household ${createdHouseholdId.slice(0, 8)}: ${hhDelErr.message}`
        : `\n🧹 cleaned up household ${createdHouseholdId.slice(0, 8)} (+ cascaded shift/change-requests/events)`
    );
  }

  // Always clean up throwaway users. This DOES cascade — user_profiles.user_id
  // -> auth.users(id) ON DELETE CASCADE (002_user_profiles.sql:10) and
  // user_device_info.user_id -> user_profiles(user_id) ON DELETE CASCADE
  // (003_user_device_info.sql:16) — but, per the household note above, it does
  // NOT reach household/shift rows, which is why those are deleted explicitly
  // first rather than relied on here.
  if (createdUserId) {
    const { error: delErr } = await admin.auth.admin.deleteUser(createdUserId);
    console.log(
      delErr
        ? `\n⚠ cleanup FAILED to delete user ${createdUserId.slice(0, 8)}: ${delErr.message}`
        : `\n🧹 cleaned up throwaway user ${createdUserId.slice(0, 8)} (+ cascade)`
    );
  }
  if (typeof g4CarerUserId === 'string') {
    const { error: carerDelErr } =
      await admin.auth.admin.deleteUser(g4CarerUserId);
    if (carerDelErr) {
      console.log(
        `\n⚠ cleanup FAILED to delete carer ${g4CarerUserId.slice(0, 8)}: ${carerDelErr.message}`
      );
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(
  `\n──────── ${passes.length} pass / ${failures.length} fail ────────`
);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
}
process.exit(failures.length === 0 ? 0 : 1);
