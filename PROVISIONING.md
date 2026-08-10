# PROVISIONING.md — dashboard-side setup

Everything in this doc happens in a **web console** or a vendor CLI, not in this repo's source. Do [`SETUP.md`](./SETUP.md) alongside it — several fields in `apps/mobile/src/config/appIdentity.json` and both `.env` files are only knowable once you've completed the matching section below.

> **Note:** This app has no paid tier — the subscription/RevenueCat/entitlement-gating layer was removed from both `apps/api` and `apps/mobile`. The former §5 (RevenueCat) section below is removed accordingly. If a paid tier is ever reintroduced, re-provision RevenueCat (project, entitlement, products, offering, public SDK keys, webhook secret) from scratch — see RevenueCat's own dashboard docs.

Each section ends with **Verify:** — an observable check that the step actually worked.

---

## 1. Supabase

1. Create a new project at supabase.com. Note the **Project URL** and, under **Project Settings → API**, the **anon** key and **service_role** key.
   - `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY` → `apps/api/.env`
   - `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` → `apps/mobile/.env` (anon key only — **never** put the service-role key in the mobile app or bundle it client-side).

2. **Auth settings.** `supabase/config.toml` documents the shape (`site_url`, `additional_redirect_urls`, email confirmation policy). Either apply it via the Supabase CLI (`supabase link --project-ref <ref>` then push your config) or replicate the same settings by hand under **Authentication → URL Configuration** in the dashboard — set `site_url` to your web/deep-link domain and add your app's redirect URL(s).

3. **Apple + Google sign-in providers.** Under **Authentication → Sign In / Providers**:
   - Enable **Apple**: Client ID = your Services ID or bundle id (see §2 Apple Developer below), Secret = the generated JWT client secret (see §2, step 4).
   - Enable **Google**: Client ID = a comma-separated list of every OAuth client id your app presents (iOS, Android, and Web — see §3 Google Cloud below; native `signInWithIdToken` verification needs every audience allow-listed, not just one), Secret = the Web client's secret.
   - `supabase/config.toml`'s commented-out `[auth.external.google]` / `[auth.external.apple]` blocks document the same two fields (`client_id`, `secret`) for CLI-based config-as-code workflows if your Supabase CLI version supports pushing auth config — check `supabase --version` and its docs before relying on that path; the dashboard path above always works.

4. **Run the migrations.** From `apps/api/`:
   ```bash
   bun run db:migrate            # supabase db push — after `supabase link --project-ref <ref>`
   ```
   This applies every file in `supabase/migrations/` (extensions/helpers, user profiles, device info, job runs, app-config + beta overrides, email log, pg_cron + Vault helpers, plus this app's own domain migrations).

5. **Vault secrets for the cron pattern.** Migration `007_pg_cron_vault_and_example_cron.sql` reads two secrets via `vault.decrypted_secrets` (never via `current_setting('app.settings.*')`, which hosted Supabase doesn't grant): `cron_api_base_url` (your deployed API's base URL) and `cron_job_api_key` (must equal your API's `JOB_API_KEY` env var). Create both under **Database → Vault** in the dashboard, or via SQL as `service_role`:
   ```sql
   select vault.create_secret('https://api.nanny.getsteadily.app', 'cron_api_base_url');
   select vault.create_secret('<same value as JOB_API_KEY>', 'cron_job_api_key');
   ```
   The migration's own `cron.schedule(...)` example is commented out by design (so the migration never fails on an environment without `pg_cron`) — uncomment and adapt it, or add a new migration, once you have real job endpoints to schedule.

6. **RLS advisor check.** In the dashboard, **Database → Advisors → Security Advisor**. Every table in this template's migrations ships with RLS enabled by default (owner-only policies where the client should read/write directly; `revoke all ... from PUBLIC, anon, authenticated` plus service-role-only grants for tables/RPCs the client should never touch directly, e.g. `job_runs`, `app_config`, `email_log`). If you add a table, decide its RLS policy in the same migration — don't defer it.

**Verify:** `bunx supabase migration list` (or the dashboard's Table Editor) shows every migration applied; the Security Advisor reports no "RLS disabled" findings on your tables.

---

## 2. Apple Developer

1. Register your bundle id (from `apps/mobile/src/config/appIdentity.json` → `ios.bundleIdentifier`, e.g. `com.mycompany.sleepwell`) at developer.apple.com → **Certificates, Identifiers & Profiles → Identifiers**.
2. Enable the **Sign In with Apple** capability on that identifier (the mobile app already has `usesAppleSignIn: true` and the `expo-apple-authentication` plugin wired in `app.config.ts` — this dashboard step is what makes the capability valid for the bundle id).
3. **APNs key** (for push notifications): **Keys → Create a key** with the Apple Push Notifications service capability enabled, download the `.p8` once (Apple won't let you re-download it), then register it with EAS:
   ```bash
   eas credentials
   ```
   Follow the iOS → push notifications prompts to upload the key, Key ID, and Team ID.
4. If you're enabling Sign In with Apple on the web/Supabase side too (for the OAuth `client_id`/`secret` in §1 step 3), you'll also need a **Services ID** and a generated JWT client secret — see Apple's Sign In with Apple REST API docs for the JWT format (signed with your key, issuer = Team ID, audience = `https://appleid.apple.com`).

**Verify:** `eas credentials` lists a valid push key for iOS; a dev build can request a push token without an APNs error.

---

## 3. Google Cloud

Use **one GCP project per app**, holding everything below for that app. Two rules that look similar but guard opposite mistakes:

- **Never split one app across projects.** Google Sign-In and Firebase/Vertex for the same app belong in the same project — otherwise you get mismatched OAuth audiences and SHA-1s registered where nothing reads them.
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
   - **Web** — used as the `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (this is the audience Supabase verifies native `signInWithIdToken` calls against) and as the Supabase Google provider's Client ID (§1 step 3).
3. **Vertex AI** — enable the **Vertex AI API** on the same project (**APIs & Services → Library → Vertex AI API → Enable**).
4. **Service account for ADC** (Application Default Credentials — the API authenticates to Vertex via ADC, **not** an API key):
   - Locally: `gcloud auth application-default login` (uses your own Google identity — fine for local dev).
   - For a deployed API: create a service account with the **Vertex AI User** role, and either mount its JSON key and set `GOOGLE_APPLICATION_CREDENTIALS` to its path, or (on Cloud Run specifically) attach the service account directly to the Cloud Run service and skip the JSON key entirely — Cloud Run's built-in ADC will pick it up.
   - Set `GOOGLE_VERTEX_PROJECT` = your GCP project id and `GOOGLE_VERTEX_LOCATION` (default `us-central1`) in `apps/api/.env` (and as Cloud Run env vars in production — see §8).

**Verify:** `apps/api` boots without the `GOOGLE_VERTEX_PROJECT is required` Zod validation error; a manual call to one of your domain's LLM-backed endpoints returns a real Gemini-generated string, not a graceful-degradation fallback.

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

Create **two separate projects** — one for the API (Node/Bun), one for mobile (React Native) — sharing DSNs across them defeats per-platform issue grouping and alerting.

- API DSN → `SENTRY_DSN` in `apps/api/.env`.
- Mobile DSN → `EXPO_PUBLIC_SENTRY_DSN` in `apps/mobile/.env`, and the mobile project's **org slug** / **project slug** → `appIdentity.json`'s `sentry.organization` / `sentry.project` (consumed by the `@sentry/react-native/expo` config plugin in `app.config.ts`, which needs them to auto-upload source maps).
- `apps/mobile/eas.json`'s `production` build profile already sets `SENTRY_ALLOW_FAILURE: "false"` — keep it that way. It means a broken Sentry source-map upload **fails the production build** instead of silently shipping a release with unsymbolicated crash reports.

**Verify:** trigger a test error in a dev build; it shows up in the mobile Sentry project within a minute, symbolicated (not raw hex addresses).

---

## 6. PostHog

1. Create a project, grab its **Project API Key**.
2. API side → `POSTHOG_API_KEY` in `apps/api/.env`. Mobile side → `EXPO_PUBLIC_POSTHOG_API_KEY` (and `EXPO_PUBLIC_POSTHOG_HOST` if you're not on PostHog Cloud US — defaults to `https://us.i.posthog.com`) in `apps/mobile/.env`.

**Verify:** an event fired from a dev build appears in **Activity → Live events** within a few seconds.

---

## 7. EAS (Expo Application Services)

1. From `apps/mobile/`: `eas login`, then `eas init` — see `SETUP.md` step 12 for why you must hand-wire the returned project id into `appIdentity.json` (dynamic `app.config.ts` doesn't get this written automatically).
2. Confirm the three build profiles in `eas.json` (`development`, `preview`, `production`) have the channels you want; `production`'s `EXPO_PUBLIC_API_URL` env override should point at your real deployed API host, not the setup-script default.
3. Android submission needs a Play Console **service account JSON** at the path `eas.json`'s `submit.production.android.serviceAccountKeyPath` points to (`./SETUP-play-service-account.json` by default — rename the file and update the path, or vice versa; it's gitignored either way).

**Verify:** `eas build --platform ios --profile development` completes and installs on a device/simulator.

---

## 8. Cloud Run (API deploy) + Cloudflare gateway

**This app is deployed.** Live values, not a template:

| | |
|---|---|
| GCP project | `steadily-nanny` (662649119218) |
| Region | `northamerica-northeast1` — same city as the Supabase project's `ca-central-1`, so the API's per-request DB round-trips stay local |
| Cloud Run service | `nanny-api` (`https://nanny-api-662649119218.northamerica-northeast1.run.app`) |
| Artifact Registry | `northamerica-northeast1-docker.pkg.dev/steadily-nanny/nanny-api` |
| Public hostname | `api.nanny.getsteadily.app` via the Cloudflare Worker in `infra/api-gateway/` |

### 8.1 One-time GCP setup

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com --project=steadily-nanny
gcloud artifacts repositories create nanny-api --repository-format=docker \
  --location=northamerica-northeast1 --project=steadily-nanny
gcloud auth configure-docker northamerica-northeast1-docker.pkg.dev
```

### 8.2 Two gitignored files next to the deploy script

`apps/api/.env.cloudrun` — *where* to deploy (`GCP_PROJECT_ID`, `GCP_REGION`, `SERVICE_NAME`,
`ARTIFACT_REGISTRY_REPO`, `IMAGE_TAG`, plus the optional sizing vars).

`apps/api/.env.cloudrun.yaml` — *what the container gets at runtime*, passed as
`--env-vars-file`. Generated from `apps/api/.env` with three deliberate differences:

- `NODE_ENV: production` (not `development`).
- **Omit** `PORT` (Cloud Run injects it), `SUPABASE_DB_URL` (only `scripts/e2e-assert.ts` reads it),
  `POSTHOG_API_KEY` (mobile-only — nothing in `apps/api/src` reads it), and any empty value.
- A real `RESEND_API_KEY` is mandatory: `productionRequiredCoreKeys` in
  `src/config/env.core.ts` makes the container refuse to boot without it under `NODE_ENV=production`,
  which fails the deploy outright.

YAML, not `--set-env-vars`, because several values contain commas, spaces and angle brackets.
Regenerate it whenever `apps/api/.env` changes. **Known limitation, not a bug:** secrets live on the
service, not in Secret Manager.

No service account is attached — the default compute SA is used. Vertex/ADC (§3) is not needed: no
domain calls `llmGenerate`, and `GOOGLE_VERTEX_PROJECT` is a placeholder.

### 8.3 Deploy

```bash
bash apps/api/deploy-cloud-run.sh   # Cloud Build -> Artifact Registry -> gcloud run deploy
```

The image is built on **Cloud Build** (`apps/api/cloudbuild.yaml`), not locally: Cloud Run needs
linux/amd64 and an emulated `docker build --platform linux/amd64` on Apple Silicon spends 20+ minutes
in `bun install`. Cloud Build is native amd64 and takes ~50s. Two files control what gets uploaded /
copied, and both matter:

- Root `.gcloudignore` — what `gcloud builds submit` uploads. Without it gcloud falls back to
  `.gitignore` semantics and ships ~400 MiB of mobile assets and doc images.
- Root `.dockerignore` — the Docker build context. `apps/api/.dockerignore` is dead code: the context
  is the monorepo root, so Docker never reads it.

The Dockerfile must copy `tsconfig.base.json` (which `apps/api/tsconfig.json` extends) and `patches/`
(the root `patchedDependencies` entry makes `bun install` fail without the patch file, even though the
patched package is mobile-only).

**Verify:** `curl https://nanny-api-662649119218.northamerica-northeast1.run.app/health` returns
`{"status":"OK",...}`; `/api/app/status` returns a valid `AppStatusResponse` envelope.

### 8.4 Cloudflare gateway

There is **no** Cloud Run domain mapping. `api.nanny.getsteadily.app` is a Cloudflare Worker
(`infra/api-gateway/`) that rewrites `Host` to the `run.app` name and proxies through — the same shape
that fronts `api.getsteadily.app`. The route is a **Workers Custom Domain**, not a plain route:
Universal SSL covers `*.getsteadily.app` but not this third-level name, and a custom domain
provisions the DNS record and a matching cert itself.

```bash
cd infra/api-gateway && npx wrangler deploy
```

If the Cloud Run URL ever changes (new service name, new region), update `CLOUD_RUN_ORIGIN` in
`infra/api-gateway/wrangler.jsonc` and redeploy the worker.

**Verify:** `curl -i https://api.nanny.getsteadily.app/health` → 200 with both `server: cloudflare`
and `x-cloud-trace-context` headers (proves the proxy reached Cloud Run);
`curl -i https://api.nanny.getsteadily.app/api/v1/households` → 401, not 404.

### 8.5 What depends on this hostname

- `apps/mobile/eas.json` → `build.production.env.EXPO_PUBLIC_API_URL`.
- Supabase vault secret `cron_api_base_url`, used by 5 active pg_cron jobs that POST to
  `/api/jobs/*` with `X-Job-Api-Key` = vault `cron_job_api_key`, which must equal the service's
  `JOB_API_KEY`. Check runs with
  `select * from cron.job_run_details order by start_time desc limit 5;`.

---

## 9. Universal links / AASA (associated domains)

This template ships **without** a hosted `apple-app-site-association` file — `app.config.ts` declares `associatedDomains: [applinks:<your-domain>, webcredentials:<your-domain>]` and the Android intent filter, but nothing in this repo hosts the AASA/`assetlinks.json` file those require. Your options:
- **Skip it for now.** Deep links via the custom URL scheme (`sleepwell://...`) work with zero extra hosting; only *universal* links (`https://sleepwell.example.com/...` opening the app directly) need AASA hosting.
- **Host it yourself** at `https://<your-domain>/.well-known/apple-app-site-association` (and `/.well-known/assetlinks.json` for Android App Links) — the content format is standard; generate it from your bundle id + Apple Team ID (iOS) and package name + SHA-256 signing cert fingerprint (Android). Any static host works; this template doesn't include one.

**Verify (if you host it):** `https://<your-domain>/.well-known/apple-app-site-association` returns valid JSON over HTTPS with no redirect; Apple's associated-domains validation (visible in Xcode's device console on install) shows no errors.

---

Once every section above has a green **Verify:**, go back to `SETUP.md` Phases 2–4 and fill in the identity-module fields these steps produced (EAS project id, Sentry org, Google Sign-In client id, store URLs), then run the exit gates.
