/**
 * @module app/auth/__tests__/register.confirmEmail
 *
 * A successful sign-up is not the same event as being signed in. With email
 * confirmation enabled, Supabase returns no error and no session; before this
 * branch existed the screen simply stopped — spinner off, no message, no
 * navigation — and the only feedback the person ever got was "Confirm your
 * email before signing in." on some later attempt.
 *
 * WHAT THIS COVERS: that `register.tsx` branches on the `confirm-email`
 * outcome and has a screen to show for it.
 *
 * WHAT IT DOES NOT COVER, deliberately and worth knowing: the rendered swap.
 * The state change is driven from a promise continuation two microtasks deep
 * (the store awaits Supabase, then the caller awaits the store), and it lands
 * outside the press's act() scope — `waitFor`, `findBy*` and an explicit
 * act() flush all failed to observe the re-render, while runtime logging
 * confirmed the component receives 'confirm-email' and calls the setter. The
 * OUTCOME half of the contract is properly covered by
 * `src/store/__tests__/auth.signUp.test.ts`, which exercises all three return
 * values against a mocked Supabase. This file pins the wiring between them.
 *
 * Source-text assertion, same technique as `button.disabled` and the
 * `SchedulePatternBanner` contrast tests, and for the same reason: the thing
 * that needs guarding is invisible to a render in this harness.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';

let registerSource: string;

beforeAll(async () => {
  registerSource = await Bun.file(join(__dirname, '../register.tsx')).text();
});

describe('Register handles a session-less sign-up', () => {
  it('branches on the confirm-email outcome rather than ignoring the result', () => {
    // Not `void signUp(...)` on its own — the result has to be read.
    expect(registerSource).toMatch(/signUp\(email, password\)\s*\.then\(/);
    expect(registerSource).toMatch(/'confirm-email'/);
  });

  it('has a screen to show for it, with a way back to sign in', () => {
    expect(registerSource).toContain('register-confirm-email');
    expect(registerSource).toContain('confirmEmailTitle');
    expect(registerSource).toContain('confirmEmailBody');
    expect(registerSource).toContain('register-confirm-email-back');
  });

  it('names the address, so a typo is visible while it can still be fixed', () => {
    expect(registerSource).toMatch(/confirmEmailBody',\s*\{\s*email\s*\}/);
  });
});
