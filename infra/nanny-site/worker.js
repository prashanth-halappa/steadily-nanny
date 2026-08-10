// Serves nanny.getsteadily.app: /.well-known/* carries the app-association
// files, /api/waitlist writes to D1, everything else proxies to the
// Lovable-hosted landing page.
const ORIGIN = 'steadily-nanny.lovable.app';

// ---------------------------------------------------------------------------
// App association (/.well-known/*)
//
// These two files are what make `applinks:` / `webcredentials:` (iOS, see
// `apps/mobile/app.config.js` associatedDomains) and the `autoVerify` intent
// filter (Android) actually resolve. Without them the OS silently treats the
// claim as unverified and universal links stay broken.
//
// They MUST be served from the apex path, over https, as application/json,
// with no redirect and no query string. Apple's CDN caches AASA aggressively,
// so a WRONG file is worse than a missing one — hence the 503 below rather
// than serving a placeholder appID.
//
// Path scope is `"/": "*"` (the whole host) deliberately: it mirrors the
// Android intent filter's `pathPrefix: '/'`, which is already shipped, and
// `webcredentials` (password autofill) claims the host regardless. The app
// therefore captures its own marketing links too — which is exactly why
// `apps/mobile/src/utils/openExternalUrl.ts` exists and routes Terms/Privacy
// through WebBrowser instead of Linking. Narrowing this without also
// narrowing the Android filter would make the two platforms disagree.
// ---------------------------------------------------------------------------
const IOS_BUNDLE_ID = 'com.jetto.steadily.nanny';
const ANDROID_PACKAGE = 'com.jetto.steadily.nanny';

// 10-character Apple Developer Team ID (Membership details). Confirmed by the
// owner 2026-08-10; matches the team on the sibling `com.jetto.steadily`
// provisioning profiles.
const APPLE_TEAM_ID = 'H59RX7HAGW';

// SHA-256 fingerprints of the certs that sign the Android app, upper-case hex,
// colon-separated. With Play App Signing this is the *app signing key* from
// Play Console -> Test and release -> App integrity, NOT the upload key. Add
// the debug keystore's fingerprint too if you want links verified on dev
// builds.
//
// EMPTY ON PURPOSE (2026-08-10): the owner has not pulled the Play App Signing
// fingerprint yet, so /.well-known/assetlinks.json answers 503 rather than
// serving a file with no fingerprints in it — an empty `sha256_cert_fingerprints`
// array is a valid-looking file that verifies nothing, which is the failure mode
// this whole block exists to avoid. Android links stay unverified until this is
// filled; iOS is unaffected.
const ANDROID_SHA256_CERT_FINGERPRINTS = [];

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600',
};

function unconfigured(what) {
  return Response.json(
    { ok: false, error: `${what} is not configured in worker.js` },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

function appleAppSiteAssociation() {
  if (!APPLE_TEAM_ID) return unconfigured('APPLE_TEAM_ID');
  const appID = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;
  return new Response(
    JSON.stringify({
      applinks: { details: [{ appIDs: [appID], components: [{ '/': '*' }] }] },
      webcredentials: { apps: [appID] },
    }),
    { headers: JSON_HEADERS }
  );
}

function assetLinks() {
  if (ANDROID_SHA256_CERT_FINGERPRINTS.length === 0)
    return unconfigured('ANDROID_SHA256_CERT_FINGERPRINTS');
  return new Response(
    JSON.stringify([
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE,
          sha256_cert_fingerprints: ANDROID_SHA256_CERT_FINGERPRINTS,
        },
      },
    ]),
    { headers: JSON_HEADERS }
  );
}

// CORS is open so the form also works from the *.lovable.app preview/editor.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Answered before anything else so the Lovable proxy can never 404 them.
    if (url.pathname === '/.well-known/apple-app-site-association')
      return appleAppSiteAssociation();
    if (url.pathname === '/.well-known/assetlinks.json') return assetLinks();

    if (url.pathname === '/api/waitlist') {
      if (request.method === 'OPTIONS')
        return new Response(null, { headers: CORS });
      if (request.method !== 'POST') {
        return Response.json(
          { ok: false, error: 'Method not allowed.' },
          { status: 405, headers: CORS }
        );
      }
      let email = '';
      try {
        const body = await request.json();
        if (typeof body.email === 'string')
          email = body.email.trim().toLowerCase();
      } catch {
        // fall through to validation error
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json(
          { ok: false, error: 'Please enter a valid email address.' },
          { status: 400, headers: CORS }
        );
      }
      await env.DB.prepare('INSERT OR IGNORE INTO waitlist (email) VALUES (?)')
        .bind(email)
        .run();
      return Response.json({ ok: true }, { headers: CORS });
    }

    url.hostname = ORIGIN;
    return fetch(url, request);
  },
};
