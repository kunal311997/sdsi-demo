# URL Shortener with Analytics

A production-minded MVP that shortens URLs into 6–8 character base62 codes, redirects
them, and reports per-link click analytics. Built for the SDSI hackathon brief
(M1–M5) with explicit attention to edge cases, security and testability.

```
POST /shorten  ──▶  { code, shortUrl, targetUrl, expiresAt }
GET  /:code    ──▶  302 → target   |  410 expired/deleted  |  404 unknown
GET  /stats/:code ─▶ { totalClicks, clicksPerDay[], lastAccessedAt, ... }
```

---

## Quick start (zero configuration)

Requires **Node.js 22.5+** (`.nvmrc` pins 22). No compiler, Python or build step is
needed: persistence uses Node's built-in `node:sqlite` module, so `npm install` is
pure JavaScript.

```bash
cd submissions/kunal-p1/url-shortener
npm install
npm run dev            # http://127.0.0.1:3000  (dashboard at /)
```

No `.env` is needed for local development: every setting has a safe default.
To customise, copy the template:

```bash
cp .env.example .env
```

Build and run the compiled output:

```bash
npm run build
npm start
```

Verify everything (typecheck → lint → tests):

```bash
npm run verify
```

### Scripts

| Script                      | What it does                                                 |
| --------------------------- | ------------------------------------------------------------ |
| `npm run dev`               | Watch-mode server via `tsx`                                  |
| `npm run build`             | Compile TypeScript to `dist/`                                |
| `npm start`                 | Run the compiled server                                      |
| `npm test`                  | Vitest unit + integration suite                              |
| `npm run test:cov`          | Suite with V8 coverage (thresholds enforced)                 |
| `npm run test:e2e`          | Build, boot the server on port 3111, run the HTTP smoke test |
| `npm run typecheck`         | `tsc --noEmit`, strict                                       |
| `npm run lint` / `lint:fix` | ESLint 9 flat config                                         |
| `npm run format`            | Prettier                                                     |
| `npm run db:prune`          | Delete links expired > `PRUNE_AFTER_DAYS` ago                |
| `npm run verify`            | typecheck + lint + test                                      |

---

## Try it (M1–M5 walkthrough)

```bash
# M1 — shorten (201 Created)
curl -i -X POST http://127.0.0.1:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/a/very/long/path?utm_source=demo"}'
# → {"code":"Ab3dE9x","shortUrl":"http://127.0.0.1:3000/Ab3dE9x", ...}

# M4 — same URL twice → same code, 200 instead of 201
curl -i -X POST http://127.0.0.1:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/a/very/long/path?utm_source=demo"}'

# M1 — custom alias + expiry
curl -i -X POST http://127.0.0.1:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/promo","alias":"launch-2026","expiresAt":"2026-12-31T23:59:59Z"}'

# M2 — resolve (302 Found, Cache-Control: no-store)
curl -i http://127.0.0.1:3000/launch-2026

# M5 — stats
curl http://127.0.0.1:3000/stats/launch-2026

# M3 — rejection cases
curl -i -X POST http://127.0.0.1:3000/shorten -H 'Content-Type: application/json' \
  -d '{"url":"javascript:alert(1)"}'          # 400 UNSUPPORTED_SCHEME
curl -i -X POST http://127.0.0.1:3000/shorten -H 'Content-Type: application/json' \
  -d '{"url":"http://169.254.169.254/latest"}' # 400 BLOCKED_HOST
```

Or just open <http://127.0.0.1:3000/> and use the dashboard.

---

## API

All responses are JSON except the 302 redirect. Errors always use one envelope:

```json
{
  "error": {
    "code": "INVALID_URL",
    "message": "URL is malformed",
    "details": { "field": "url" },
    "requestId": "0f2f8b2e-..."
  }
}
```

`x-request-id` is echoed on every response and included in error bodies, so a
client report maps to exactly one log line.

### `POST /shorten`

| Field       | Type   | Required | Notes                                                             |
| ----------- | ------ | -------- | ----------------------------------------------------------------- |
| `url`       | string | yes      | Absolute `http`/`https` URL, ≤ `MAX_URL_LENGTH` (2048)            |
| `alias`     | string | no       | 3–32 chars of `[A-Za-z0-9_-]`, not a reserved word                |
| `expiresAt` | string | no       | ISO-8601 **with zone** (`Z` or `±hh:mm`), future-only, ≤ 10 years |

- `201 Created` — new code minted.
- `200 OK` — identical URL already shortened; the existing code is returned
  (`created: false`). Custom aliases are never deduped.
- `400` — invalid URL/alias/expiry · `409 ALIAS_TAKEN` · `413`/`415` body issues.

```json
{
  "code": "Ab3dE9x",
  "shortUrl": "http://127.0.0.1:3000/Ab3dE9x",
  "targetUrl": "https://example.com/a/very/long/path?utm_source=demo",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "expiresAt": null,
  "isCustomAlias": false,
  "created": true
}
```

### `GET /:code` · `HEAD /:code`

| Status | Meaning                | Headers                                                                                        |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `302`  | Redirect to the target | `Location`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` |
| `410`  | Expired or deleted     | `error.code = LINK_GONE`                                                                       |
| `404`  | Unknown code           | `error.code = LINK_NOT_FOUND`                                                                  |

`HEAD` validates the link but does **not** count a click, so link previews and uptime
probes cannot inflate analytics. `GET` is always a **302**, never a 301, so expiry and
deletion take effect immediately instead of being cached by browsers.

### `GET /stats/:code`

```json
{
  "code": "Ab3dE9x",
  "shortUrl": "http://127.0.0.1:3000/Ab3dE9x",
  "targetUrl": "https://example.com/a/very/long/path",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "expiresAt": null,
  "deletedAt": null,
  "expired": false,
  "totalClicks": 42,
  "uniqueVisitors": 17,
  "firstAccessedAt": "2026-01-15T10:01:05.000Z",
  "lastAccessedAt": "2026-01-19T16:20:00.000Z",
  "clickDays": 4,
  "clicksPerDay": [
    { "date": "2026-01-15", "clicks": 20 },
    { "date": "2026-01-16", "clicks": 0 },
    { "date": "2026-01-17", "clicks": 12 },
    { "date": "2026-01-18", "clicks": 0 },
    { "date": "2026-01-19", "clicks": 10 }
  ]
}
```

`clicksPerDay` is **dense** (gaps filled with `0`) and bucketed by **UTC** day.
Stats stay readable for expired and deleted links so historical numbers survive.

### Other endpoints

| Method   | Path                           | Auth         | Purpose                                                     |
| -------- | ------------------------------ | ------------ | ----------------------------------------------------------- |
| `GET`    | `/stats/:code/clicks?limit=20` | configurable | Recent clicks (UA + referrer only)                          |
| `GET`    | `/links?limit=50&offset=0`     | required     | Paginated link listing for the dashboard                    |
| `DELETE` | `/:code`                       | required     | Soft delete → future hits return 410                        |
| `GET`    | `/health`                      | public       | Liveness + schema version, never cached, never rate limited |
| `GET`    | `/`                            | public       | Dashboard (static HTML/CSS/JS)                              |

---

## Configuration

Every value has a working default; production mode additionally validates secrets.

| Variable                         | Default                 | Description                                                  |
| -------------------------------- | ----------------------- | ------------------------------------------------------------ |
| `NODE_ENV`                       | `development`           | `development` \| `test` \| `production`                      |
| `PORT` / `HOST`                  | `3000` / `127.0.0.1`    | HTTP listener                                                |
| `BASE_URL`                       | `http://127.0.0.1:3000` | Public origin used to build `shortUrl`                       |
| `DATABASE_PATH`                  | `./data/links.db`       | SQLite path (`:memory:` supported)                           |
| `CODE_LENGTH`                    | `7`                     | Generated code length, 6–8                                   |
| `MAX_URL_LENGTH`                 | `2048`                  | Longest accepted target URL                                  |
| `ALLOW_PRIVATE_HOSTS`            | `false`                 | Allow loopback/private targets (local demos only)            |
| `EXPIRY_MAX_DAYS`                | `3650`                  | Maximum expiry horizon                                       |
| `API_KEYS`                       | _(empty)_               | Comma-separated keys; **required in production**             |
| `STATS_REQUIRE_AUTH`             | `false`                 | Require a key to read stats                                  |
| `TRUST_PROXY`                    | `0`                     | `0`/`false`, `true`, or hop count                            |
| `IP_SALT`                        | `dev-only-salt`         | HMAC salt for visitor IPs; **must be changed in production** |
| `LOG_LEVEL`                      | `info`                  | pino level                                                   |
| `RATE_LIMIT_GLOBAL_PER_MINUTE`   | `300`                   | All routes                                                   |
| `RATE_LIMIT_WRITE_PER_MINUTE`    | `30`                    | `POST /shorten`, `DELETE`                                    |
| `RATE_LIMIT_REDIRECT_PER_MINUTE` | `600`                   | `GET /:code`                                                 |
| `PRUNE_AFTER_DAYS`               | `30`                    | Retention for `npm run db:prune`                             |

Production mode refuses to boot when `API_KEYS` is empty, `IP_SALT` is the development
default, `ALLOW_PRIVATE_HOSTS` is enabled, or `BASE_URL` is plain `http://` on a
non-loopback host.

---

## Design decisions (and why)

| Decision                                     | Rationale                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **302, never 301**                           | A permanent redirect is cached by browsers, so expiry and deletion would be silently ignored.                                                                                  |
| **`Cache-Control: no-store` on redirects**   | Prevents intermediary caching of the hop and keeps click counts honest.                                                                                                        |
| **Idempotency on a canonical URL hash**      | Scheme/host case, default ports and trailing root dots are normalised, so `HTTPS://Example.com:443` and `https://example.com` share a code (M4). Path/query case is preserved. |
| **Expired link re-shorten mints a new code** | The old code keeps returning 410, so its historical stats stay attributable instead of being resurrected.                                                                      |
| **Partial unique index + `BEGIN IMMEDIATE`** | The transaction serialises read-then-insert; the index is a hard guarantee under concurrency.                                                                                  |
| **Soft delete**                              | Preserves analytics and prevents code reuse by a third party for a different destination.                                                                                      |
| **Aliases are case-sensitive**               | `CaseAlias` and `casealias` are different codes; routing is case-sensitive so an alias can never shadow `/stats`.                                                              |
| **Reserved-word blocklist**                  | No alias can collide with `/health`, `/links`, `/shorten`, `/stats`, `favicon.ico`, etc.                                                                                       |
| **Codes from `crypto.randomInt`**            | Uniform (no modulo bias), unguessable, and not sequential — enumeration-resistant.                                                                                             |
| **Fail-open analytics**                      | A click-write failure is logged but never blocks the redirect; availability beats metrics.                                                                                     |
| **Hashed visitor IPs**                       | HMAC-SHA256 with a server salt keeps unique-visitor counts without storing personal data.                                                                                      |
| **Structured logs without URLs**             | Target URLs can embed tokens/PII, so logs carry path + status + latency + request id only.                                                                                     |
| **Fail-fast configuration**                  | An invalid env aborts boot with a readable message instead of producing mysterious 500s.                                                                                       |
| **CSP with no inline script**                | The dashboard ships external JS/CSS only, so a stored-XSS payload has no execution surface.                                                                                    |

### Data model

```sql
links(id, code UNIQUE, url, url_hash, alias, created_at, expires_at, deleted_at,
      click_count, last_accessed_at)
clicks(id, code → links.code ON DELETE CASCADE, clicked_at, ip_hash, user_agent, referer)

-- idempotency guard for live non-alias links
CREATE UNIQUE INDEX idx_links_dedupe ON links (url_hash)
  WHERE alias = 0 AND expires_at IS NULL AND deleted_at IS NULL;
-- analytics aggregation
CREATE INDEX idx_clicks_code_time ON clicks (code, clicked_at DESC);
```

`click_count` and `last_accessed_at` are denormalised onto `links` so the dashboard
list stays a single indexed read; the `clicks` table remains the source of truth and is
re-aggregated for per-day stats.

### Performance notes

- Redirect path = 1 indexed lookup + 1 small transaction (2 row updates). No joins.
- Prepared statements are compiled once per process; `node:sqlite` is synchronous, so
  there is no async scheduling overhead on the hot path.
- WAL mode lets stats queries read while redirects write.
- `idx_clicks_code_time` serves both `GROUP BY day` and `ORDER BY clicked_at DESC`.
- Pagination is clamped (`limit ≤ 100`) so a client cannot request an unbounded scan.
- Rate limits protect the expensive write path and hot-link hammering.

---

## Testing

```bash
npm test               # 207 assertions across unit + integration
npm run test:cov       # coverage with thresholds
npm run test:e2e       # build + boot + 34 live HTTP checks
```

| Area                                                                                 | File                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------ |
| base62 generation, alphabet, uniformity                                              | `tests/unit/base62.test.ts`          |
| URL validation/normalisation matrix (schemes, CRLF, IDN, numeric IPs, private hosts) | `tests/unit/url.test.ts`             |
| alias rules and reserved words                                                       | `tests/unit/alias.test.ts`           |
| expiry parsing (zones, past, horizon)                                                | `tests/unit/expiry.test.ts`          |
| config parsing/validation, dense series, clamping                                    | `tests/unit/support.test.ts`         |
| M1–M5 over HTTP, concurrency races                                                   | `tests/integration/links.test.ts`    |
| auth, rate limiting, input hardening                                                 | `tests/integration/security.test.ts` |
| service + persistence, migrations, cascade, fail-open                                | `tests/integration/service.test.ts`  |

Every HTTP test uses an **in-memory database** and an **injected clock**, so tests are
deterministic, parallel-safe and never touch the filesystem.

---

## Project layout

```
src/
  domain/      pure rules: base62, url, alias, expiry, net, errors
  db/          connection + pragmas, migrations, repositories
  services/    linkService - the only place business rules are orchestrated
  middleware/  auth, rate limiting, validation, request id, error handling
  routes/      shorten, redirect, stats, links, health
  lib/         clock, logger, crypto helpers
  app.ts       app factory (testable, no sockets)
  index.ts     process bootstrap + graceful shutdown
public/        dashboard (no build step)
scripts/       prune job
tests/         unit + integration + helpers
docs/          architecture, API, edge cases, security, skills/guardrails
```

---

## Operational notes

- **Backups**: SQLite in WAL mode needs the `-wal` file too; use `sqlite3 links.db ".backup"` or stop the process first.
- **Maintenance**: `npm run db:prune -- 90` removes links expired more than 90 days ago (clicks cascade).
- **Scaling**: rate limiting is in-memory and SQLite is single-writer. Multi-instance deployment needs a shared rate-limit store and a server database — explicitly out of MVP scope (see `docs/ARCHITECTURE.md`).
- **Logs**: JSON in production; `pino-pretty` in development.

## Limitations / deliberately out of scope

User accounts and teams · Redis-backed rate limits · click dedupe windows · QR codes ·
link-in-bio pages · safe-browsing interstitials · horizontal scaling · custom domains ·
A/B rotation.

## Documentation index

| Document                                                         | Contents                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| [`docs/API.md`](docs/API.md)                                     | Full endpoint reference with every error code            |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                   | Layers, data model, request flows, scaling               |
| [`docs/EDGE_CASES.md`](docs/EDGE_CASES.md)                       | ~50 edge cases with expected behaviour and covering test |
| [`docs/SECURITY.md`](docs/SECURITY.md)                           | Threat model and mitigations                             |
| [`docs/SKILLS_AND_GUARDRAILS.md`](docs/SKILLS_AND_GUARDRAILS.md) | Agent skills/instructions used to build this             |
| [`PROMPTS.md`](PROMPTS.md)                                       | AI collaboration log                                     |

## Troubleshooting

| Symptom                          | Fix                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `node:sqlite` unavailable        | Use Node 22.5+ (`node -e "new (require('node:sqlite').DatabaseSync)(':memory:')"` to check) |
| `EADDRINUSE`                     | Another process owns the port; change `PORT`                                                |
| `401 UNAUTHORIZED` on writes     | `API_KEYS` is set — send `Authorization: Bearer <key>`                                      |
| `400 BLOCKED_HOST` for localhost | Set `ALLOW_PRIVATE_HOSTS=true` for local demos                                              |
| Stats always zero                | Check you are hitting the code with `GET` (not `HEAD`)                                      |
| Config error at boot             | The message names the offending variable and why it is refused                              |
