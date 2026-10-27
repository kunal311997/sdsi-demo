# API Reference

Base URL: `http://127.0.0.1:3000` (see `BASE_URL`).
All request bodies are `application/json`; the limit is **8 KB**.
All responses are JSON except `302` redirects.

Every response carries `x-request-id`. If you supply a safe `x-request-id` (≤64 chars
of `[A-Za-z0-9._:-]`) it is echoed; otherwise a UUID is generated.

## Error envelope

```json
{
  "error": {
    "code": "ALIAS_TAKEN",
    "message": "Alias is already in use",
    "details": { "field": "alias", "alias": "launch" },
    "requestId": "8f2c1e70-5a1f-4b1c-9a4a-b1f0a1b2c3d4"
  }
}
```

`details` and `requestId` are optional. `code` is a stable machine-readable enum —
clients should branch on `code`, not on the human message.

### Error codes

| Code                     | Status | When                                                                                              |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`       | 400    | Body is not valid JSON, is missing `url`, has unknown fields, or a field has the wrong type       |
| `INVALID_URL`            | 400    | URL is malformed, has an invalid host label, contains control/invisible characters or backslashes |
| `URL_TOO_LONG`           | 400    | URL exceeds `MAX_URL_LENGTH` before or after normalisation                                        |
| `UNSUPPORTED_SCHEME`     | 400    | Scheme is not `http:`/`https:` (e.g. `javascript:`, `data:`, `file:`, `ftp:`)                     |
| `URL_HAS_CREDENTIALS`    | 400    | URL embeds `user:pass@`                                                                           |
| `BLOCKED_HOST`           | 400    | Target resolves to loopback/private/link-local/metadata, or a single-label host                   |
| `SELF_REFERENCE`         | 400    | Target origin equals the shortener's own `BASE_URL` origin                                        |
| `INVALID_ALIAS`          | 400    | Alias is not 3–32 chars of `[A-Za-z0-9_-]`                                                        |
| `ALIAS_RESERVED`         | 400    | Alias collides with an application route (`stats`, `health`, …)                                   |
| `INVALID_EXPIRY`         | 400    | `expiresAt` is not ISO-8601 with an explicit timezone                                             |
| `EXPIRY_IN_PAST`         | 400    | `expiresAt` is at or before now                                                                   |
| `EXPIRY_TOO_FAR`         | 400    | `expiresAt` is beyond `EXPIRY_MAX_DAYS`                                                           |
| `UNAUTHORIZED`           | 401    | Missing or invalid API key on a protected route                                                   |
| `LINK_NOT_FOUND`         | 404    | Code does not exist                                                                               |
| `ROUTE_NOT_FOUND`        | 404    | No route matches the path                                                                         |
| `METHOD_NOT_ALLOWED`     | 405    | Verb not supported for an existing path (see `Allow` header)                                      |
| `ALIAS_TAKEN`            | 409    | Alias already maps to a different URL (or belongs to an expired link)                             |
| `LINK_GONE`              | 410    | Code exists but is expired or deleted                                                             |
| `PAYLOAD_TOO_LARGE`      | 413    | Body exceeds 8 KB                                                                                 |
| `UNSUPPORTED_MEDIA_TYPE` | 415    | `POST` without `Content-Type: application/json`                                                   |
| `RATE_LIMITED`           | 429    | Bucket exhausted; see `RateLimit-*` headers                                                       |
| `INTERNAL_ERROR`         | 500    | Unexpected failure (details only in logs)                                                         |
| `CODE_GENERATION_FAILED` | 503    | Could not allocate a unique code after several attempts                                           |

---

## `POST /shorten`

Creates a short link. Requires an API key when `API_KEYS` is configured.

### Body

| Field       | Type   | Required | Constraints                                                                                           |
| ----------- | ------ | -------- | ----------------------------------------------------------------------------------------------------- |
| `url`       | string | yes      | Absolute `http`/`https`, no credentials, ≤ `MAX_URL_LENGTH`, public host unless `ALLOW_PRIVATE_HOSTS` |
| `alias`     | string | no       | `^[A-Za-z0-9_-]{3,32}$`, not reserved, case-sensitive                                                 |
| `expiresAt` | string | no       | ISO-8601 with `Z` or `±hh:mm`, strictly future, ≤ `EXPIRY_MAX_DAYS`                                   |

Unknown fields are rejected (`VALIDATION_ERROR`), which catches typos like `expireAt`.

### Responses

**201 Created** — new code

```http
HTTP/1.1 201 Created
Content-Type: application/json
x-request-id: 3f2b...

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

**200 OK** — idempotent hit (same canonical URL, no alias)

```json
{ "code": "Ab3dE9x", "created": false, "...": "..." }
```

**400** — invalid input, e.g.

```json
{
  "error": {
    "code": "UNSUPPORTED_SCHEME",
    "message": "Only http:// and https:// URLs are supported",
    "details": { "field": "url", "scheme": "javascript" }
  }
}
```

**409** — alias taken

```json
{
  "error": {
    "code": "ALIAS_TAKEN",
    "message": "Alias is already in use",
    "details": { "field": "alias", "alias": "launch" }
  }
}
```

### Idempotency rules (M4)

| Situation                                              | Result                                   |
| ------------------------------------------------------ | ---------------------------------------- |
| Same canonical URL, no alias, live link exists         | `200`, existing code                     |
| Same canonical URL, no alias, only expired links exist | `201`, **new** code (old stays 410)      |
| Same alias + same URL, still live                      | `200`, same code                         |
| Same alias + different URL                             | `409 ALIAS_TAKEN`                        |
| Same alias + same URL, but expired                     | `409 ALIAS_TAKEN` (choose another alias) |
| Any alias request                                      | Never deduped to a generated code        |

Canonicalisation: scheme and host lowercased; default port removed; empty path becomes
`/`; trailing root dot removed; path/query/fragment case preserved.

---

## `GET /:code` and `HEAD /:code`

| Status | Body                                             | Extra headers                                                                                                       |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `302`  | empty                                            | `Location`, `Cache-Control: no-store, max-age=0`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` |
| `410`  | `LINK_GONE` (+ `details.expiredAt` when expired) | `Cache-Control` from global middleware                                                                              |
| `404`  | `LINK_NOT_FOUND`                                 | —                                                                                                                   |
| `405`  | `METHOD_NOT_ALLOWED`                             | `Allow: GET, HEAD`                                                                                                  |

- Always **302**. A 301 would be cached and break expiry/deletion.
- `GET` records a click; `HEAD` validates only.
- Exact expiry instant counts as expired (`expires_at <= now`).
- Codes are matched **case-sensitively**.

```bash
curl -i http://127.0.0.1:3000/Ab3dE9x
```

---

## `GET /stats/:code`

Public by default; set `STATS_REQUIRE_AUTH=true` to require a key.

```json
{
  "code": "Ab3dE9x",
  "shortUrl": "http://127.0.0.1:3000/Ab3dE9x",
  "targetUrl": "https://example.com/a/very/long/path",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "deletedAt": null,
  "expired": false,
  "totalClicks": 42,
  "uniqueVisitors": 17,
  "firstAccessedAt": "2026-01-15T10:01:05.000Z",
  "lastAccessedAt": "2026-01-19T16:20:00.000Z",
  "clickDays": 4,
  "clicksPerDay": [{ "date": "2026-01-15", "clicks": 20 }]
}
```

- `totalClicks` — every `GET` hit (M5).
- `clicksPerDay` — dense UTC series, gaps filled with `0`, capped at 366 entries.
- `uniqueVisitors` — distinct HMAC'd IPs (no raw IPs are stored or returned).
- Stats remain available after expiry/deletion; `expired`/`deletedAt` describe state.
- `Cache-Control: no-store`.

Errors: `404 LINK_NOT_FOUND`.

---

## `GET /stats/:code/clicks?limit=20`

Recent clicks, newest first. `limit` is clamped to 1–100.

```json
{
  "code": "Ab3dE9x",
  "limit": 20,
  "clicks": [
    {
      "clickedAt": "2026-01-19T16:20:00.000Z",
      "userAgent": "Mozilla/5.0 (…)",
      "referer": "https://news.example.com/post"
    }
  ]
}
```

Raw IPs are never returned; `userAgent`/`referer` are truncated to 512 chars.

---

## `GET /links?limit=50&offset=0`

Requires an API key. Newest first. `limit` 1–100, `offset` ≥ 0.

```json
{
  "items": [
    {
      "code": "Ab3dE9x",
      "shortUrl": "http://127.0.0.1:3000/Ab3dE9x",
      "url": "https://example.com/a/very/long/path",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "expiresAt": null,
      "expired": false,
      "clickCount": 42,
      "lastAccessedAt": "2026-01-19T16:20:00.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

---

## `DELETE /:code`

Requires an API key. Soft delete: the row is retained for analytics, future hits return
`410`, and the code is never reassigned. Idempotent.

```json
{ "code": "Ab3dE9x", "deleted": true }
```

Errors: `404 LINK_NOT_FOUND`, `401 UNAUTHORIZED`.

---

## `GET /health`

Never cached, never rate limited. `200` when the database responds.

```json
{
  "status": "ok",
  "database": "ok",
  "schemaVersion": 2,
  "uptimeSeconds": 128,
  "timestamp": "2026-01-15T10:02:08.000Z"
}
```

---

## Authentication

Send either header:

```http
Authorization: Bearer <key>
```

```http
X-API-Key: <key>
```

Keys come from `API_KEYS` (comma separated). Comparison is constant-time over every
configured key, so timing does not reveal prefix matches. When `API_KEYS` is empty
(development only) writes are anonymous; production refuses to start in that state.

| Route                                               | Auth                                |
| --------------------------------------------------- | ----------------------------------- |
| `POST /shorten`                                     | yes                                 |
| `DELETE /:code`                                     | yes                                 |
| `GET /links`                                        | yes                                 |
| `GET /stats/:code`, `/stats/:code/clicks`           | only when `STATS_REQUIRE_AUTH=true` |
| `GET /:code`, `HEAD /:code`, `GET /health`, `GET /` | never                               |

---

## Rate limiting

| Bucket   | Default | Scope                            |
| -------- | ------- | -------------------------------- |
| global   | 300/min | every route except `/health`     |
| write    | 30/min  | `POST /shorten`, `DELETE /:code` |
| redirect | 600/min | `GET                             | HEAD /:code` |

`429` responses include `RateLimit-*` headers (draft-8) and:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests, slow down and retry shortly",
    "details": { "retryAfterSeconds": 60 }
  }
}
```

The store is in-memory (single instance). Set `TRUST_PROXY` behind a load balancer so
limits key on the real client IP instead of the proxy's.
