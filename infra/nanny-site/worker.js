// Serves nanny.getsteadily.app: /.well-known/* carries the app-association
// files, /api/waitlist writes to D1, /t/:code renders the terms preview.
//
// The landing page is NOT here — it is a static file in ./public, served by
// the Workers Static Assets binding in wrangler.jsonc BEFORE this script runs.
// So anything reaching the fall-through below matched no asset and no route,
// and is a genuine 404. (This replaced a reverse proxy to a Lovable-hosted
// page; that dependency is gone.)

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

// The waitlist form is now same-origin (the page is a static asset on this
// same Worker), so CORS is no longer load-bearing. Left open so the endpoint
// stays callable from a local preview or a curl smoke test.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------------------------------------------------------------------------
// /t/:code — the public terms preview (D-37, spec §6.2)
//
// WHY THIS IS SERVER-RENDERED IN THE WORKER. The page is per-code and its
// Open Graph tags must be server-rendered, or the link previews as a bare URL
// in iMessage — which is the exact failure D-37 exists to fix. A static asset
// could not do this, so /t/:code stays a Worker route.
//
// WHY THE WORKER FORMATS NOTHING. Every string on this page — every label,
// every value, the rate, the weekly line — arrives already rendered from
// `GET /api/v1/household-invites/:code/terms-preview`, built by the SAME
// `renderTermRows`/`renderTermsHeader` pair the app's own review screen uses
// and pinned by a test against the mobile builder's source. That is what makes
// "the family reads the same contract on the web as in the app" a property of
// the code rather than a promise in a doc. If you ever find yourself computing
// a figure or picking a word in this file, something has gone wrong: in
// particular a `rate x hours` here would print $1,400.00 where the API prints
// $1,540.00, on the page where the contract starts.
//
// THE 404 IS OPAQUE AND IT IS THE SAME PAGE EVERY TIME. The API collapses all
// five death conditions (redeemed — including the instant it is redeemed —
// past `link_expires_at`, past the code's 30-day `expires_at`, revoked, and
// not-a-nanny-invite) into one indistinguishable 404. Naming the reason would
// confirm the code was real, which is exactly the existence-hiding convention
// `previewInvite`'s header protects. Do not add a friendlier message that
// leaks which one it was.
//
// WHAT IS DELIBERATELY NOT ON THE PAGE: the children's names, the family's
// name, the nanny's surname, any address, any contact detail. Her first name
// and last initial only — and the API enforces that, this file just never asks
// for more.
// ---------------------------------------------------------------------------

/**
 * Everything interpolated below comes from user-entered data — her note, a
 * stipend label she typed, a family name. This page is public and
 * unauthenticated, so every one of those is escaped on the way in. There is no
 * "trusted" field here.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * `sha256(code)[0:16]` — the join key that spans the pre-auth hop between
 * `terms_shared` (her device) and `code_redeemed` (his). The raw code is a
 * BEARER SECRET and PostHog is not where it belongs; a truncated hash is
 * enough to join a funnel and useless for redeeming anything.
 */
async function hashCode(code) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(code)
  );
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * §11 event 3 — the ONE event in the funnel the app cannot emit, because at
 * this point nobody has opened it. A direct HTTPS POST to /capture, no SDK:
 * `apps/api` has no server-side PostHog client and adding one for a single
 * anonymous event would be a new production dependency for no other gain.
 *
 * Fire-and-forget through `waitUntil` so a slow or dead analytics host can
 * never delay — or fail — a family's first look at the terms.
 */
function captureLinkOpened(env, codeHash, request) {
  if (!env.POSTHOG_API_KEY) return Promise.resolve();
  const host = env.POSTHOG_HOST || 'https://us.i.posthog.com';
  return fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: env.POSTHOG_API_KEY,
      event: 'link_opened',
      // Anonymous by construction: the hash IS the only identity this hop has.
      distinct_id: `code_${codeHash}`,
      properties: {
        code_hash: codeHash,
        ua_platform: request.headers.get('user-agent') ?? 'unknown',
        referrer_kind: request.headers.get('referer') ? 'referred' : 'direct',
        $process_person_profile: false,
      },
    }),
  }).catch(() => {});
}

/** §5.3's "Opened" — the read receipt, stamped once, idempotent server-side. */
function stampOpened(env, code) {
  if (!env.API_BASE_URL) return Promise.resolve();
  return fetch(
    `${env.API_BASE_URL}/api/v1/household-invites/${encodeURIComponent(code)}/opened`,
    { method: 'POST' }
  ).catch(() => {});
}

const PAGE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F5F1F2; color: #2A1F2B;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.45; -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 480px; margin: 0 auto; padding: 22px; }
  .wordmark { color: #5B3E5D; font-weight: 700; font-size: 15px; letter-spacing: .2px; }
  h1 { font-size: 26px; line-height: 32px; font-weight: 600; margin: 18px 0 6px; }
  .meta { color: #6E6270; font-size: 13px; margin: 0 0 16px; }
  .card {
    background: #fff; border-radius: 20px; padding: 20px;
    box-shadow: 0 1px 2px rgba(91,62,93,.06), 0 8px 24px rgba(91,62,93,.08);
  }
  .rate { font-size: 30px; line-height: 36px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .weekly { color: #5F5461; font-size: 14px; margin-top: 2px; }
  .pill {
    display: inline-block; background: #FBEFD9; color: #7A5312;
    border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600;
    vertical-align: middle; margin-left: 8px;
  }
  .rows { margin-top: 16px; border-top: 1px solid #E5DDE2; }
  .row {
    display: flex; justify-content: space-between; gap: 16px;
    padding: 11px 0; border-bottom: 1px solid #E5DDE2; font-size: 14px;
  }
  .row dt { color: #6E6270; margin: 0; flex: 0 0 auto; }
  .row dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .cta {
    display: block; text-align: center; text-decoration: none;
    background: #5B3E5D; color: #fff; font-weight: 600; font-size: 16px;
    border-radius: 14px; padding: 17px 20px; margin: 20px 0 10px;
  }
  .stores { display: flex; gap: 10px; }
  .stores a {
    flex: 1; text-align: center; text-decoration: none; font-size: 14px;
    color: #5B3E5D; border: 1px solid #E5DDE2; background: #fff;
    border-radius: 12px; padding: 12px;
  }
  .codeblock { background: #fff; border-radius: 16px; padding: 18px; margin-top: 18px; text-align: center; }
  .codeblock p { margin: 0 0 8px; color: #5F5461; font-size: 13px; }
  .code {
    font-size: 32px; line-height: 40px; font-weight: 800; color: #5B3E5D;
    letter-spacing: 3.2px; user-select: all; -webkit-user-select: all;
  }
  .copy {
    margin-top: 10px; background: #EDE5EA; color: #2A1F2B; border: 0;
    border-radius: 10px; padding: 10px 16px; font-size: 14px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  .fine { color: #6E6270; font-size: 12px; margin-top: 16px; }
`;

/**
 * The opaque dead-link page. HTTP 404, no OG tags, no code echoed back, no
 * hint at which of the five conditions closed it.
 */
function deadLinkPage() {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Steadily Nanny</title><style>${PAGE_CSS}</style></head>
<body><div class="wrap">
  <div class="wordmark">Steadily Nanny</div>
  <div class="card" style="margin-top:18px">
    <h1 style="margin-top:0">This link isn't active any more</h1>
    <p class="meta" style="margin:0">Ask for a new one.</p>
  </div>
</div></body></html>`,
    {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}

function termsPage(preview) {
  const title = `${preview.carer_name} sent you her working terms`;
  const rows = (preview.rows ?? [])
    .map(
      row =>
        `<div class="row"><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`
    )
    .join('');
  // NO RATE IN THE OG TAGS. A message preview is the most-screenshotted,
  // most-forwarded surface in the whole chain, and it is not where the number
  // needs to be (§6.2).
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="Steadily Nanny · review and respond in the app">
<meta property="og:type" content="website">
<style>${PAGE_CSS}</style></head>
<body><div class="wrap">
  <div class="wordmark">Steadily Nanny</div>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Proposed ${escapeHtml(preview.proposed_at)}${
    preview.link_expires_at
      ? ` · this link works until ${escapeHtml(preview.link_expires_at)}`
      : ''
  }</p>

  <div class="card">
    <div class="rate">${escapeHtml(preview.rate)}<span class="pill">Proposed</span></div>
    ${preview.weekly_line ? `<div class="weekly">${escapeHtml(preview.weekly_line)}</div>` : ''}
    <dl class="rows">${rows}</dl>
  </div>

  <a class="cta" href="https://nanny.getsteadily.app/t/${encodeURIComponent(preview.code)}">Open in Steadily Nanny</a>
  <div class="stores">
    <a href="https://apps.apple.com/app/id0000000000">App Store</a>
    <a href="https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}">Google Play</a>
  </div>

  <div class="codeblock">
    <p>Or enter this code in the app</p>
    <div class="code" id="code">${escapeHtml(preview.code)}</div>
    <button class="copy" id="copy" type="button">Copy code</button>
  </div>

  <p class="fine">These terms aren't agreed until you accept them in the app.</p>
  <p class="fine">Steadily Nanny records what you agree. It doesn't give legal or tax advice — please check your terms against your state's rules.</p>
</div>
<script>
// §6.4 step 1 — the page copies the code so the app can pre-fill from the
// clipboard. A convenience ONLY: the code is printed above in selectable text,
// which is the floor that always works. Nothing in this flow may depend on the
// clipboard, because a universal link does not survive an App Store install
// and a person reading the code off a friend's phone still has to be able to
// type six characters.
(function () {
  var code = ${JSON.stringify(preview.code)};
  var button = document.getElementById('copy');
  function copy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(code).then(function () {
      button.textContent = 'Copied';
    }, function () {});
  }
  button.addEventListener('click', copy);
  copy();
})();
</script>
</body></html>`,
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Never cached: the page must die the INSTANT the code is redeemed
        // (D-51's third condition), and a CDN holding it for even a minute
        // would leave her rate readable after the private copy exists.
        'Cache-Control': 'no-store, must-revalidate',
      },
    }
  );
}

async function termsPreviewPage(request, env, ctx, code) {
  if (!env.API_BASE_URL) return deadLinkPage();

  let preview = null;
  try {
    const response = await fetch(
      `${env.API_BASE_URL}/api/v1/household-invites/${encodeURIComponent(code)}/terms-preview`,
      { headers: { Accept: 'application/json' } }
    );
    if (!response.ok) return deadLinkPage();
    const body = await response.json();
    preview = body?.data ?? null;
  } catch {
    // A dead API is indistinguishable from a dead code, on purpose: the
    // alternative is a 500 page that confirms the code was real.
    return deadLinkPage();
  }
  if (!preview?.code) return deadLinkPage();

  // Both receipts fire AFTER the fetch succeeded, so a dead code never
  // produces a "link_opened" and never stamps `opened_at` — the nanny's
  // "Opened" pill has to mean the family actually saw her terms.
  const codeHash = await hashCode(preview.code);
  ctx.waitUntil(
    Promise.all([
      captureLinkOpened(env, codeHash, request),
      stampOpened(env, preview.code),
    ])
  );

  return termsPage(preview);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Answered before anything else so they can never fall through to a 404.
    if (url.pathname === '/.well-known/apple-app-site-association')
      return appleAppSiteAssociation();
    if (url.pathname === '/.well-known/assetlinks.json') return assetLinks();

    // /t/:code — the D-37 terms preview.
    //
    // On iOS, and on Android once the Play App Signing fingerprint is filled
    // in above, a tap on this URL with the app INSTALLED never arrives here at
    // all — the OS claims it (`applinks` components `{"/": "*"}`,
    // `pathPrefix: '/'`) and hands it to `app/t/[code].tsx`. So this page is
    // the not-installed path, and its job is to be worth the tap: a real
    // number and a real name in about four seconds, plus a code that can be
    // typed by hand when the link itself does not survive the App Store.
    const termsMatch = /^\/t\/([A-Za-z0-9-]{1,32})\/?$/.exec(url.pathname);
    if (termsMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405 });
      }
      return termsPreviewPage(request, env, ctx, termsMatch[1].toUpperCase());
    }

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
      let role = null;
      try {
        const body = await request.json();
        if (typeof body.email === 'string')
          email = body.email.trim().toLowerCase();
        // Allowlisted, never free text — the column is read as a segment count.
        if (body.role === 'parent' || body.role === 'nanny') role = body.role;
      } catch {
        // fall through to validation error
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json(
          { ok: false, error: 'Please enter a valid email address.' },
          { status: 400, headers: CORS }
        );
      }
      await env.DB.prepare(
        'INSERT OR IGNORE INTO waitlist (email, role) VALUES (?, ?)'
      )
        .bind(email, role)
        .run();
      return Response.json({ ok: true }, { headers: CORS });
    }

    // No asset matched and no route claimed it.
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
