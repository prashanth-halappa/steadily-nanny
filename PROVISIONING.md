# PROVISIONING.md — dashboard-side setup

Everything in this doc happens in a **web console** or a vendor CLI, not in this repo's source. Do [`SETUP.md`](./SETUP.md) alongside it — several fields in `apps/mobile/src/config/appIdentity.json` and both `.env` files are only knowable once you've completed the matching section below.

> **Note:** This app has no paid tier — the subscription/RevenueCat/entitlement-gating layer was removed from both `apps/api` and `apps/mobile`. The former §5 (RevenueCat) section below is removed accordingly. If a paid tier is ever reintroduced, re-provision RevenueCat (project, entitlement, products, offering, public SDK keys, webhook secret) from scratch — see RevenueCat's own dashboard docs.

Each section ends with **Verify:** — an observable check that the step actually worked.

---

## 1. Cloudflare (D1 database + Workers API)

> Supabase was removed 2026-11-22. The database is Cloudflare D1, auth is Better Auth (cookie sessions, served by the API at `/api/auth/*`), and the API runs as a Cloudflare Worker. See `apps/api/src/db/MIGRATION-NOTES.md`.

1. Install/log in: `cd apps/api && bunx wrangler login`. The Workers **Paid** plan is required: `wrangler.jsonc` declares 10 cron triggers and the free plan allows 5.
2. **Create the database** and wire its id:
   ```bash
   bunx wrangler d1 create steadily-nanny
   ```
   Paste the returned `database_id` into `apps/api/wrangler.jsonc` (`d1_databases[0].database_id`, currently a placeholder).
3. **Apply migrations** (Drizzle-generated SQL in `apps/api/migrations/`):
   ```bash
   bunx wrangler d1 migrations apply steadily-nanny --remote
   ```
   Always run this **before** `wrangler deploy` (see `docs/ROLLBACK-RUNBOOK.md`). Add a migration with `drizzle-kit generate` after editing `src/db/schema/*`.
4. **Secrets.** Set each with `bunx wrangler secret put <NAME>` (local dev reads `apps/api/.dev.vars` instead; the list is in the comment block of `wrangler.jsonc` and `apps/api/.env.example`):
   - `BETTER_AUTH_SECRET` (required, >= 32 chars; `openssl rand -base64 32`; rotating it signs everyone out)
   - `JOB_API_KEY` (production-required)
   - `APPLE_CLIENT_ID`, `APPLE_APP_BUNDLE_IDENTIFIER`, `APPLE_CLIENT_SECRET` (optional, see below)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (secret optional)
   - `SENTRY_DSN`, `OPS_ALERT_USER_IDS` (optional)
   - **Never** `EMAIL_AUTH_ENABLED`: email/password sign-in is dev/test only (`.dev.vars` sets it `true`; unset means off)

   Non-secret vars (`NODE_ENV`, `LOG_LEVEL`, `BETTER_AUTH_URL`) live in `wrangler.jsonc` `vars`. Set `BETTER_AUTH_URL` to the API's public origin.
5. **Apple + Google sign-in** use the native **id-token flow** through Better Auth (`apps/api/src/auth.ts`). A provider is on only when its client id secret is set:
   - **Apple:** `APPLE_APP_BUNDLE_IDENTIFIER` = your bundle id (the native id-token audience). Apple sign-in is iOS-only (the Android app hides it), so the redirect-flow `APPLE_CLIENT_SECRET` is not needed.
   - **Google:** `GOOGLE_CLIENT_ID` (web client id, also Android's `serverClientId`) and `GOOGLE_IOS_CLIENT_ID`; both are accepted as the id-token audience (see §3). The client secret is not used by id-token sign-in.
6. **No email.** Production sign-in is Apple/Google only; there is no password reset and the API sends no email.
7. **Scheduled jobs** are Workers cron triggers (`wrangler.jsonc` `triggers.crons`, handled by `src/scheduled.ts`). No cron secret or Vault setup is needed; `JOB_API_KEY` only guards manual `POST /api/jobs/*`.

**Verify:** `bunx wrangler d1 migrations list steadily-nanny --remote` shows nothing pending; `bunx wrangler d1 execute steadily-nanny --remote --command "select count(*) from user_profiles"` succeeds.

---

## 2. Apple Developer

1. Register your bundle id (from `apps/mobile/src/config/appIdentity.json` → `ios.bundleIdentifier`, e.g. `com.mycompany.sleepwell`) at developer.apple.com → **Certificates, Identifiers & Profiles → Identifiers**.
2. Enable the **Sign In with Apple** capability on that identifier (the mobile app already has `usesAppleSignIn: true` and the `expo-apple-authentication` plugin wired in `app.config.ts` — this dashboard step is what makes the capability valid for the bundle id).
3. **APNs key** (for push notifications): **Keys → Create a key** with the Apple Push Notifications service capability enabled, download the `.p8` once (Apple won't let you re-download it), then register it with EAS:
   ```bash
   eas credentials
   ```
   Follow the iOS → push notifications prompts to upload the key, Key ID, and Team ID.
4. If you need Sign In with Apple on Android/web (the redirect flow; `APPLE_CLIENT_ID`/`APPLE_CLIENT_SECRET` in §1 step 5), you'll also need a **Services ID** and a generated JWT client secret — see Apple's Sign In with Apple REST API docs for the JWT format (signed with your key, issuer = Team ID, audience = `https://appleid.apple.com`).

**Verify:** `eas credentials` lists a valid push key for iOS; a dev build can request a push token without an APNs error.

---

## 3. Google Cloud

Use **one GCP project per app**, holding everything below for that app. Two rules that look similar but guard opposite mistakes:

- **Never split one app across projects.** Google Sign-In and Firebase for the same app belong in the same project — otherwise you get mismatched OAuth audiences and SHA-1s registered where nothing reads them.
- **Never share one project across apps.** A GCP project is the only unit Google lets you hand over: you can transfer a whole project to another owner or organisation, but there is **no supported way to move an app out of a Firebase project**. Two apps in one project can therefore never be cleanly separated later.

Convention: project id `<company>-<app>` (e.g. `steadily-nanny`), Firebase enabled on that same project (§4), one project per app forever.

**Why sharing a project across apps is a trap** — even though it looks cheaper on day one:

| Coupled thing | Consequence |
|---|---|
| OAuth consent screen | Per-project. All apps show the same name, logo and privacy URL to users. |
| IAM | Project-scoped. Firebase has no per-app access control, so granting a contractor access to one app exposes every other app's config, analytics and Crashlytics. |
| FCM registration tokens | Issued per (app, project). Moving an app to a new project invalidates every device token — push goes dark until each client re-registers. |
| OAuth client IDs | Recreating them in a new project changes the ids, which forces a client release. |
| Billing, quotas, analytics export | Shared pool; one app's spike or export touches the others. |

Sharing buys you almost nothing here: with only the non-sensitive `profile`/`email` scopes, each project's consent screen needs **no Google verification**, so a second project costs a few clicks rather than a review cycle. Firebase billing is usage-based, so N projects cost the same as one for the same total traffic.

1. **OAuth consent screen** — configure it (external or internal) under **APIs & Services → OAuth consent screen**.
2. **OAuth client IDs** — create three under **APIs & Services → Credentials**:
   - **iOS** — bundle id = your app's. The resulting client id becomes `ios.googleSignInUrlScheme` in `appIdentity.json` as `com.googleusercontent.apps.<client-id>`, and its numeric/string id also goes to `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in `apps/mobile/.env`.
   - **Android** — package name = your app's, **plus the SHA-1 fingerprint**. Register **both** your local debug/EAS-build keystore SHA-1 **and** the Play Console's App Signing SHA-1 (Play re-signs your app for distribution with its own key — if you only register your upload-key SHA-1, sign-in works in internal testing but breaks for real Play Store installs). Get the Play Signing SHA-1 from **Play Console → Setup → App Integrity** once your app has been uploaded once.
   - **Web** — used as the `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and as the API's `GOOGLE_CLIENT_ID` (§1 step 5). Better Auth verifies the native id token against `GOOGLE_CLIENT_ID` and `GOOGLE_IOS_CLIENT_ID` as accepted audiences, so every client id your app presents must be set.
Google Cloud is used only for Sign-In and (via Firebase, §4) Android push. There is no LLM/Vertex dependency, and the API does not run on GCP.

**Verify:** a dev build signs in with Google against your API and a session cookie is created (`POST /api/auth/sign-in/social` returns 200).

---

## 4. Firebase

Needed **only for Android push notifications** (Expo/FCM).

Firebase is *not* needed for Google Sign-In in this template. `app.config.js` passes `{ iosUrlScheme }` to the `@react-native-google-signin/google-signin` plugin, which selects its no-Firebase path — that applies the iOS URL scheme only and never wires Android google-services — and `GoogleSignin.configure` passes `webClientId` explicitly rather than reading the `default_web_client_id` resource that `google-services.json` generates. Android sign-in needs the §3 step 2 **Android OAuth clients**, nothing more.

1. Enable Firebase on the app's existing GCP project from §3 (Firebase projects ARE GCP projects; adding Firebase is non-destructive and leaves your OAuth clients and project number intact). Do **not** reuse another app's project — see §3.
2. Add an Android app with your `android.package` (from `appIdentity.json`).
3. Download `google-services.json` to `apps/mobile/google-services.json` — gitignored on purpose; never commit it. `app.config.js` wires it only when the file exists, so a clone without it still prebuilds.
4. Upload that project's **FCM V1 service account key** to EAS (`eas credentials` → Android → FCM V1). The file alone delivers nothing; both halves are required.

**Verify:** on a device build, `getExpoPushTokenAsync` returns a token and a test push arrives. Do **not** rely on the build failing — because step 3 is existence-gated, a build without `google-services.json` succeeds silently and only fails at runtime push registration. iOS needs none of this: Expo delivers via APNs using a key EAS manages.

---

## 5. Sentry

Create **two separate projects** — one for the API (Cloudflare Workers), one for mobile (React Native) — sharing DSNs across them defeats per-platform issue grouping and alerting.

- API DSN → `SENTRY_DSN` (Worker secret; `apps/api/.dev.vars` locally).
- Mobile DSN → `EXPO_PUBLIC_SENTRY_DSN` in `apps/mobile/.env`, and the mobile project's **org slug** / **project slug** → `appIdentity.json`'s `sentry.organization` / `sentry.project` (consumed by the `@sentry/react-native/expo` config plugin in `app.config.ts`, which needs them to auto-upload source maps).
- `apps/mobile/eas.json`'s `production` build profile already sets `SENTRY_ALLOW_FAILURE: "false"` — keep it that way. It means a broken Sentry source-map upload **fails the production build** instead of silently shipping a release with unsymbolicated crash reports.

**Verify:** trigger a test error in a dev build; it shows up in the mobile Sentry project within a minute, symbolicated (not raw hex addresses).

---

## 6. PostHog

1. Create a project, grab its **Project API Key**.
2. API side → `POSTHOG_API_KEY` (optional Worker secret). Mobile side → `EXPO_PUBLIC_POSTHOG_API_KEY` (and `EXPO_PUBLIC_POSTHOG_HOST` if you're not on PostHog Cloud US — defaults to `https://us.i.posthog.com`) in `apps/mobile/.env`.

**Verify:** an event fired from a dev build appears in **Activity → Live events** within a few seconds.

---

## 7. EAS (Expo Application Services)

1. From `apps/mobile/`: `eas login`, then `eas init` — see `SETUP.md` step 12 for why you must hand-wire the returned project id into `appIdentity.json` (dynamic `app.config.ts` doesn't get this written automatically).
2. Confirm the three build profiles in `eas.json` (`development`, `preview`, `production`) have the channels you want; `production`'s `EXPO_PUBLIC_API_URL` env override should point at your real deployed API host, not the setup-script default.
3. Android submission needs a Play Console **service account JSON** at the path `eas.json`'s `submit.production.android.serviceAccountKeyPath` points to (`./SETUP-play-service-account.json` by default — rename the file and update the path, or vice versa; it's gitignored either way).

**Verify:** `eas build --platform ios --profile development` completes and installs on a device/simulator.

---

## 8. Workers (API deploy)

The API is a Cloudflare Worker (`apps/api/wrangler.jsonc`, entry `src/worker.ts`: Express under `nodejs_compat` via `httpServerHandler`). There is no container, Cloud Run service, or gateway proxy.

### 8.1 Deploy a new version

Prerequisites (once per machine): `bunx wrangler login`, and `bun run qc` green on the commit you're shipping.

```bash
cd apps/api
bun run deploy   # = wrangler d1 migrations apply steadily-nanny --remote && wrangler deploy
```

That's the whole release. Migrations always go first, because an older Worker must tolerate a newer schema but a newer Worker can't run on an older one (`docs/ROLLBACK-RUNBOOK.md`). `wrangler deploy` uploads the bundle, keeps the custom domain and the cron trigger from `wrangler.jsonc`, and prints a **Version ID**: note it down.

Check it straight after:

```bash
curl -s https://api.nanny.getsteadily.app/health                        # {"status":"OK",...}
curl -s -o /dev/null -w '%{http_code}\n' https://api.nanny.getsteadily.app/api/v1/households   # 401
bunx wrangler tail steadily-nanny-api --format pretty                   # live requests, errors, cron runs
```

Roll back the code (not the schema) to the previous version in seconds:

```bash
bunx wrangler deployments list          # find the last good Version ID
bunx wrangler rollback <version-id>
```

Notes:
- **Secrets** (`wrangler secret put NAME`) apply to the next deploy and survive later deploys. Set them before the first deploy (§1 step 4). `NODE_ENV=production` makes the Worker refuse to boot without `JOB_API_KEY`. `bunx wrangler secret list` shows what's set.
- **Deploy from a clean checkout of `main`**, never from a branch with uncommitted work: the bundle is built from your working tree.
- **`NODE_ENV` is a `vars` entry**, not your shell's: `wrangler.jsonc`'s `define` stops wrangler baking the deploying shell's value into the bundle. Never read `process.env.NODE_ENV` directly in `apps/api` (see CLAUDE.md).
- **workers.dev is off**: with a custom domain and no `workers_dev`, the `*.workers.dev` URL is disabled. To test a build without touching production, deploy a copy of `wrangler.jsonc` with `"routes"` swapped for `"workers_dev": true, "preview_urls": false` and `BETTER_AUTH_URL` set to the workers.dev origin, under a different `name`, so you don't overwrite the production Worker.
- **CI does not deploy.** `.github/workflows/ci.yml` only runs the checks; releases are manual.

### 8.2 Public hostname

Serve the Worker on `api.nanny.getsteadily.app` as a **Workers Custom Domain** (dashboard: Workers & Pages, the worker, Settings, Domains & Routes; or a `routes` entry with `custom_domain: true` in `wrangler.jsonc`). Custom domains provision the DNS record and certificate themselves. Keep `BETTER_AUTH_URL` equal to this origin.

### 8.3 Local dev

`bun run dev` (in `apps/api`) runs `wrangler dev --test-scheduled` on `http://localhost:8080` with a local D1 and `.dev.vars` secrets. Use `--remote` only deliberately, since that talks to the production database.

**Verify:** `curl https://api.nanny.getsteadily.app/health` returns `{"status":"OK",...}`; `curl -i .../api/v1/households` returns 401, not 404; `bunx wrangler triggers`/the dashboard lists the 10 cron triggers.

### 8.4 What depends on this hostname

- `apps/mobile/eas.json` -> `build.production.env.EXPO_PUBLIC_API_URL`.
- Cron schedules run inside the Worker and need no hostname. Check runs in the `job_runs` table (`wrangler d1 execute steadily-nanny --remote --command "select * from job_runs order by started_at desc limit 5"`; confirm the column name in `src/db/schema/platform.ts`).

---

## 9. Universal links / AASA (associated domains)

This template ships **without** a hosted `apple-app-site-association` file — `app.config.ts` declares `associatedDomains: [applinks:<your-domain>, webcredentials:<your-domain>]` and the Android intent filter, but nothing in this repo hosts the AASA/`assetlinks.json` file those require. Your options:
- **Skip it for now.** Deep links via the custom URL scheme (`sleepwell://...`) work with zero extra hosting; only *universal* links (`https://sleepwell.example.com/...` opening the app directly) need AASA hosting.
- **Host it yourself** at `https://<your-domain>/.well-known/apple-app-site-association` (and `/.well-known/assetlinks.json` for Android App Links) — the content format is standard; generate it from your bundle id + Apple Team ID (iOS) and package name + SHA-256 signing cert fingerprint (Android). Any static host works; this template doesn't include one.

**Verify (if you host it):** `https://<your-domain>/.well-known/apple-app-site-association` returns valid JSON over HTTPS with no redirect; Apple's associated-domains validation (visible in Xcode's device console on install) shows no errors.

---

Once every section above has a green **Verify:**, go back to `SETUP.md` Phases 2–4 and fill in the identity-module fields these steps produced (EAS project id, Sentry org, Google Sign-In client id, store URLs), then run the exit gates.
