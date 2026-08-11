# No-show during quiet hours — verification note (no Maestro flow)

§8 marks 3-N **Maestro-N/A**, and it is right to. Everything this scenario
asserts happens with the app closed: a scheduled job wakes up, decides a shift
was a no-show, and then decides whether the household's quiet-hours window
means the push waits. No screen renders, no tap exists, and there is no
simulator-visible artifact — push delivery into Simulator is not reliable in
the first place (the reason flows 02, 05 and 06 all substitute `openLink` for
the notification tap).

Driving it through the UI would also test the wrong thing. The behaviour under
test is "a suppressed push must not burn its idempotency claim", which is a
property of the job's claim-then-send ordering, not of any surface.

The job-level tests below cover it. Paths are relative to the repo root.

## The suppression decision itself

| Test | Evidence |
|---|---|
| `apps/api/tests/unit/domains/notification/services/pushDispatchService.test.ts` — `it('suppresses a non-exempt type during quiet hours')` | With `quiet_hours_enabled: true` spanning `00:00`–`23:59`, a non-exempt push type sends nothing. |
| same file — `it('still sends a deadline-bearing exempt type during quiet hours')` | The exemption is real: a type carrying a deadline overrides the window rather than being deferred. |
| same file — `it('sends when prefs are missing (all enabled, quiet hours off)')` | No prefs row fails OPEN — a missing row never silently mutes a household. |
| same file — `it('still sends a non-opted-out type when quiet hours are off')` | The window, not the type, is what gates; with quiet hours off nothing is held. |

## The window arithmetic

| Test | Evidence |
|---|---|
| `apps/api/tests/unit/domains/notification/services/quietHours.test.ts` — `it('returns true during a same-day quiet window')` / `it('returns false outside a same-day quiet window')` | The ordinary case in both directions. |
| same file — `it('handles midnight-wrapping quiet hours')` | `22:00`–`07:00` is the common setting and the one a naive `start < now < end` gets wrong. |
| same file — `it('evaluates against the given IANA timezone')` | Quiet hours are household-local, not server-local. |
| same file — `it('fail-opens (returns false) for an invalid IANA timezone')` | A bad zone lets the push through rather than muting it — the safe direction for a no-show. |

## The no-show job's interaction with it

| Test | Evidence |
|---|---|
| `apps/api/tests/unit/jobs/noShowJob.test.ts` — `it('does not claim a push that prefs or quiet hours would suppress')` | **The scenario itself.** A no-show detected inside quiet hours does not consume its idempotency claim, so the notification is still owed once the window closes instead of being lost to a claim that was burned on a send that never happened. |
| `apps/api/tests/unit/jobs/reminderJob.test.ts` — `it('does not claim a reminder that would be suppressed (quiet hours / opt-out / no devices)')` and `it('does not claim a cover-ask reminder that would be suppressed (quiet hours / opt-out)')` | The same claim-vs-suppress discipline on the reminder paths, i.e. the rule is enforced per-job rather than in one place someone can forget. |
| `apps/api/tests/unit/jobs/coverAskExpiryJob.test.ts` — `it('carries shiftStartsAt so the quiet-hours exemption is decided from a fact, not a flag')` | The exemption is derived from the shift's own start time, so it cannot drift out of sync with a caller-set boolean. |

## Gap worth naming

`apps/api/tests/unit/jobs/noShowDigestJob.test.ts` has **no** quiet-hours case.
It does not need one the way `noShowJob` does — the digest only runs inside a
`[07:00, 10:00)` household-local window, which sits outside any plausible quiet
period by construction — but that is an argument from the window's bounds, not
an assertion. If the digest window is ever widened, this is the test that
should exist and does not.
