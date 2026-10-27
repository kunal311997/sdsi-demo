/**
 * End-to-end smoke test against a running server.
 *
 * Verifies the M1-M5 contract over real HTTP, including the status codes the
 * brief asks for. Run with the server already listening:
 *
 *   node scripts/smoke.mjs [baseUrl] [apiKey]
 */

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const apiKey = process.argv[3] ?? '';

let failures = 0;
let checks = 0;

function pass(label, detail = '') {
  checks += 1;
  console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail) {
  checks += 1;
  failures += 1;
  console.error(`  FAIL ${label} — ${detail}`);
}

function expectEqual(label, actual, expected) {
  if (actual === expected) pass(label, String(actual));
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function expectMatch(label, actual, pattern) {
  if (typeof actual === 'string' && pattern.test(actual)) pass(label, actual);
  else fail(label, `${JSON.stringify(actual)} does not match ${pattern}`);
}

async function post(body) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}/shorten`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

async function get(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}${path}`, {
    headers,
    redirect: 'manual',
    method: options.method ?? 'GET',
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json, headers: response.headers };
}

async function main() {
  console.log(`Smoke test against ${baseUrl}\n`);

  // --- health -------------------------------------------------------------
  const health = await get('/health');
  expectEqual('health returns 200', health.status, 200);
  expectEqual('health reports ok', health.body.status, 'ok');

  // --- M1 -----------------------------------------------------------------
  const unique = `https://example.com/smoke-${Date.now()}`;
  const created = await post({ url: unique });
  expectEqual('M1 shorten returns 201', created.status, 201);
  expectMatch('M1 code is 6-8 base62 chars', created.body.code, /^[0-9A-Za-z]{6,8}$/);
  expectEqual('M1 target echoed', created.body.targetUrl, unique);

  const code = created.body.code;

  // --- M4 -----------------------------------------------------------------
  const duplicate = await post({ url: unique });
  expectEqual('M4 duplicate returns 200', duplicate.status, 200);
  expectEqual('M4 duplicate returns the same code', duplicate.body.code, code);
  expectEqual('M4 duplicate reports created=false', duplicate.body.created, false);

  // --- M2 -----------------------------------------------------------------
  const redirect = await get(`/${code}`);
  expectEqual('M2 redirect is 302', redirect.status, 302);
  expectEqual('M2 Location points at the target', redirect.headers.get('location'), unique);
  expectEqual(
    'M2 redirect is not cacheable',
    (redirect.headers.get('cache-control') ?? '').includes('no-store'),
    true,
  );

  const head = await get(`/${code}`, { method: 'HEAD' });
  expectEqual('M2 HEAD is 302', head.status, 302);

  const missing = await get('/zzzzzzz');
  expectEqual('M2 unknown code is 404', missing.status, 404);
  expectEqual('M2 unknown code error code', missing.body.error.code, 'LINK_NOT_FOUND');

  // --- M5 -----------------------------------------------------------------
  const stats = await get(`/stats/${code}`);
  expectEqual('M5 stats returns 200', stats.status, 200);
  expectEqual('M5 totalClicks counts only the GET (not HEAD)', stats.body.totalClicks, 1);
  expectEqual('M5 lastAccessedAt is set', typeof stats.body.lastAccessedAt === 'string', true);
  expectEqual(
    'M5 clicksPerDay is a non-empty array',
    Array.isArray(stats.body.clicksPerDay) && stats.body.clicksPerDay.length > 0,
    true,
  );

  // --- M3 -----------------------------------------------------------------
  const bad = await post({ url: 'javascript:alert(1)' });
  expectEqual('M3 javascript: is rejected', bad.status, 400);
  expectEqual('M3 javascript: error code', bad.body.error.code, 'UNSUPPORTED_SCHEME');

  const privateHost = await post({ url: 'http://169.254.169.254/latest/meta-data' });
  expectEqual('M3 metadata IP is rejected', privateHost.status, 400);
  expectEqual('M3 metadata error code', privateHost.body.error.code, 'BLOCKED_HOST');

  const malformed = await post({ url: 'not a url' });
  expectEqual('M3 malformed URL is rejected', malformed.status, 400);

  // --- aliases ------------------------------------------------------------
  const aliasName = `smoke-${Date.now().toString(36)}`;
  const aliased = await post({ url: `${unique}/alias`, alias: aliasName });
  expectEqual('alias creation returns 201', aliased.status, 201);
  expectEqual('alias is used verbatim', aliased.body.code, aliasName);

  const aliasConflict = await post({ url: `${unique}/other`, alias: aliasName });
  expectEqual('alias reuse for another URL is 409', aliasConflict.status, 409);
  expectEqual('alias conflict error code', aliasConflict.body.error.code, 'ALIAS_TAKEN');

  // --- expiry -------------------------------------------------------------
  const expiring = await post({
    url: `${unique}/expiring`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  expectEqual('expiring link is created', expiring.status, 201);
  const expiringStats = await get(`/stats/${expiring.body.code}`);
  expectEqual('expiring link is not expired yet', expiringStats.body.expired, false);

  // --- delete -------------------------------------------------------------
  const deletable = await post({ url: `${unique}/deletable` });
  const deleted = await get(`/${deletable.body.code}`, { method: 'DELETE' });
  if (apiKey) {
    expectEqual('delete returns 200', deleted.status, 200);
    const gone = await get(`/${deletable.body.code}`);
    expectEqual('deleted code returns 410', gone.status, 410);
    expectEqual('deleted code error', gone.body.error.code, 'LINK_GONE');
  } else {
    expectEqual('delete without a key is 401', deleted.status, 401);
  }

  // --- headers ------------------------------------------------------------
  const csp = redirect.headers.get('content-security-policy') ?? '';
  expectEqual('security headers include a CSP', csp.includes("default-src 'self'"), true);
  expectEqual(
    'request id header is present',
    typeof (health.headers.get('x-request-id') ?? '') === 'string' &&
      (health.headers.get('x-request-id') ?? '').length > 0,
    true,
  );

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
