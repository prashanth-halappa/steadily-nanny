/**
 * Mint the Sign in with Apple client secret (an ES256 JWT, max 6 months) that
 * Better Auth needs for the Android/web Apple flow, and print it to stdout:
 *
 *   bun scripts/apple-client-secret.ts <TEAM_ID> <KEY_ID> <SERVICES_ID> <AuthKey.p8> \
 *     | (cd apps/api && bunx wrangler secret put APPLE_CLIENT_SECRET)
 *
 * It expires: re-run before the date it prints to stderr.
 */
const [teamId, keyId, servicesId, p8Path] = process.argv.slice(2);
if (!teamId || !keyId || !servicesId || !p8Path) {
  console.error(
    'usage: apple-client-secret.ts <TEAM_ID> <KEY_ID> <SERVICES_ID> <AuthKey.p8>'
  );
  process.exit(1);
}

const pem = await Bun.file(p8Path).text();
const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
const key = await crypto.subtle.importKey(
  'pkcs8',
  der,
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign']
);

const b64url = (data: string | ArrayBuffer): string =>
  Buffer.from(typeof data === 'string' ? data : new Uint8Array(data)).toString(
    'base64url'
  );

const now = Math.floor(Date.now() / 1000);
const exp = now + 180 * 24 * 60 * 60; // Apple's ceiling is 6 months.
const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
const payload = b64url(
  JSON.stringify({
    iss: teamId,
    iat: now,
    exp,
    aud: 'https://appleid.apple.com',
    sub: servicesId,
  })
);
// WebCrypto's ECDSA output is already the raw r||s form JWS ES256 expects.
const signature = await crypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  key,
  new TextEncoder().encode(`${header}.${payload}`)
);

console.error(`expires ${new Date(exp * 1000).toISOString()}`);
process.stdout.write(`${header}.${payload}.${b64url(signature)}`);
