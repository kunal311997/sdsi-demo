# Edge Cases

Every row is a behaviour that was **decided on purpose** and (unless marked otherwise)
covered by an automated test. Test files are referenced as
`unit/url`, `integration/links`, etc. under `tests/`.

Legend: **M#** = links to the brief's milestone. ◆ = covered by an automated test.

---

## 1. URL validation (M3)

| #    | Input                                                            | Expected                                                            | Test                               |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| 1 ◆  | `javascript:alert(1)`                                            | `400 UNSUPPORTED_SCHEME`                                            | `unit/url`, `integration/links`    |
| 2 ◆  | `JavaScript:alert(1)` (mixed case)                               | `400 UNSUPPORTED_SCHEME` — scheme case is normalised by `URL`       | `unit/url`                         |
| 3 ◆  | `javascript:alert(1)` (padded)                                   | `400 UNSUPPORTED_SCHEME` — trimming happens before the scheme check | `unit/url`                         |
| 4 ◆  | `data:text/html,<script>…`                                       | `400 UNSUPPORTED_SCHEME`                                            | `unit/url`                         |
| 5 ◆  | `file:///etc/passwd`                                             | `400 UNSUPPORTED_SCHEME`                                            | `unit/url`                         |
| 6 ◆  | `vbscript:msgbox(1)`                                             | `400 UNSUPPORTED_SCHEME`                                            | `unit/url`                         |
| 7 ◆  | `blob:https://example.com/x`, `about:blank`, `ws://…`, `ftp://…` | `400 UNSUPPORTED_SCHEME`                                            | `unit/url`                         |
| 8 ◆  | `example.com` (no scheme)                                        | `400 INVALID_URL` — not treated as `http://`                        | `unit/url`                         |
| 9 ◆  | `//example.com/path` (protocol-relative)                         | `400 INVALID_URL`                                                   | `unit/url`                         |
| 10 ◆ | `http://` / `https:///path` (no host)                            | `400 INVALID_URL`                                                   | `unit/url`                         |
| 11 ◆ | `http://exa mple.com` (space in host)                            | `400 INVALID_URL`                                                   | `unit/url`                         |
| 12 ◆ | `http://example.com/\r\nSet-Cookie: x=1` (CRLF injection)        | `400 INVALID_URL` — control chars rejected before parsing           | `unit/url`                         |
| 13 ◆ | `http://example.com/\u0000`, `\u0001`                            | `400 INVALID_URL`                                                   | `unit/url`                         |
| 14 ◆ | Zero-width / bidi chars (`\u200B`, `\u202E`)                     | `400 INVALID_URL` — homograph/extension-spoofing defence            | `unit/url`                         |
| 15 ◆ | Backslash in URL (`https://example.com\@evil.com`)               | `400 INVALID_URL` — browsers would treat `\` as `/`                 | `unit/url`                         |
| 16 ◆ | `https://user:pass@example.com`                                  | `400 URL_HAS_CREDENTIALS`                                           | `unit/url`, `integration/links`    |
| 17 ◆ | Host label starting/ending with `-`                              | `400 INVALID_URL`                                                   | `unit/url`                         |
| 18 ◆ | Underscore in host (`exa_mple.com`)                              | `400 INVALID_URL`                                                   | `unit/url`                         |
| 19 ◆ | Unicode host `https://bücher.example`                            | Accepted, stored as punycode `xn--bcher-kva.example`                | `unit/url`                         |
| 20 ◆ | URL > `MAX_URL_LENGTH` (2048)                                    | `400 URL_TOO_LONG`                                                  | `unit/url`, `integration/security` |
| 21 ◆ | `url` is a number/object/array/null                              | `400 VALIDATION_ERROR`                                              | `unit/url`, `integration/security` |
| 22 ◆ | Unknown body field (`sneaky: true`)                              | `400 VALIDATION_ERROR` — strict schema catches typos                | `integration/links`                |

## 2. Private / internal targets (M3 hardening)

| #    | Input                                                                       | Expected                                                                           | Test                            |
| ---- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| 23 ◆ | `http://localhost`, `http://127.0.0.1`, `http://127.1`, `http://0.0.0.0`    | `400 BLOCKED_HOST`                                                                 | `unit/url`                      |
| 24 ◆ | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`                             | `400 BLOCKED_HOST`                                                                 | `unit/url`                      |
| 25 ◆ | `169.254.169.254` (cloud metadata)                                          | `400 BLOCKED_HOST`                                                                 | `unit/url`, `integration/links` |
| 26 ◆ | `100.64.0.0/10` (CGNAT)                                                     | `400 BLOCKED_HOST`                                                                 | `unit/url`                      |
| 27 ◆ | `http://2130706433/` (decimal IPv4 for 127.0.0.1)                           | `400 BLOCKED_HOST` — `URL` canonicalises to `127.0.0.1` first                      | `unit/url`                      |
| 28 ◆ | `http://0x7f.1/` (hex/octal shorthand)                                      | `400 BLOCKED_HOST`                                                                 | `unit/url`                      |
| 29 ◆ | `http://[::1]/`, `[fd00::1]`, `[fe80::1]`                                   | `400 BLOCKED_HOST`                                                                 | `unit/url`                      |
| 30 ◆ | `::ffff:127.0.0.1` (IPv4-mapped)                                            | `400 BLOCKED_HOST` — embedded IPv4 is classified                                   | `unit/url`                      |
| 31 ◆ | `metadata.google.internal`, `printer.local`, `service.internal`, `intranet` | `400 BLOCKED_HOST` — suffix + single-label rules                                   | `unit/url`                      |
| 32 ◆ | Same inputs with `ALLOW_PRIVATE_HOSTS=true`                                 | Accepted (local demos)                                                             | `unit/url`, `integration/links` |
| 33   | DNS rebinding (`evil.com` → `127.0.0.1` after validation)                   | **Not defended** — we never resolve DNS; documented residual risk in `SECURITY.md` | —                               |
| 34 ◆ | Target equals the shortener's own origin                                    | `400 SELF_REFERENCE`                                                               | `unit/url`, `integration/links` |

## 3. Short codes and aliases (M1)

| #    | Input                                                             | Expected                                                   | Test                               |
| ---- | ----------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| 35 ◆ | Default request                                                   | 7-char `[0-9A-Za-z]` code                                  | `unit/base62`, `integration/links` |
| 36 ◆ | `CODE_LENGTH=6` / `=8`                                            | 6- or 8-char codes                                         | `unit/base62`, `integration/links` |
| 37 ◆ | `CODE_LENGTH` outside 6–8                                         | Boot fails with `ConfigError`                              | `unit/support`                     |
| 38 ◆ | 20 000 generated codes                                            | No duplicates                                              | `unit/base62`                      |
| 39 ◆ | Character distribution                                            | Within 15 % of uniform (catches `Math.random`/modulo bias) | `unit/base62`                      |
| 40 ◆ | Alias `ab` (too short), 33 chars (too long)                       | `400 INVALID_ALIAS`                                        | `unit/alias`                       |
| 41 ◆ | Alias with `/`, `.`, spaces, emoji, `%2e`, `..`                   | `400 INVALID_ALIAS` — no traversal or encoding tricks      | `unit/alias`                       |
| 42 ◆ | Alias `stats`, `STATS`, `Stats`, `health`, `links`, `favicon.ico` | `400 ALIAS_RESERVED`                                       | `unit/alias`, `integration/links`  |
| 43 ◆ | Alias `stats-2026`, `healthy` (contains reserved word)            | Accepted                                                   | `unit/alias`                       |
| 44 ◆ | Deleted link exists for a URL, then same URL shortened            | **New** code; old code stays 410                           | `integration/links`                |
| 45 ◆ | Generated code collides with an existing row                      | Retried; after 8 failures → `503`                          | `services/linkService` logic       |

## 4. Idempotency (M4)

| #    | Input                                                          | Expected                                  | Test                            |
| ---- | -------------------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| 46 ◆ | Same URL twice                                                 | Same code, `200`, `created:false`         | `integration/links`             |
| 47 ◆ | `HTTPS://Example.com:443/path` then `https://example.com/path` | Same code (canonical hash)                | `unit/url`, `integration/links` |
| 48 ◆ | Trailing root dot `example.com.` vs `example.com`              | Same code                                 | `unit/url`                      |
| 49 ◆ | Path/query case differs (`/Path?A=1` vs `/path?a=1`)           | **Different** codes — semantics differ    | `unit/url`                      |
| 50 ◆ | Same URL + different alias                                     | Alias creates its own link, never deduped | `integration/links`             |
| 51 ◆ | Same alias + same URL                                          | `200`, same code                          | `integration/links`             |
| 52 ◆ | Same alias + different URL                                     | `409 ALIAS_TAKEN`                         | `integration/links`             |
| 53 ◆ | Same alias + same URL, but expired                             | `409 ALIAS_TAKEN` (cannot resurrect)      | `integration/service`           |
| 54 ◆ | 20 concurrent identical shortens                               | Exactly one `201`, 19 × `200`, one code   | `integration/links`             |
| 55 ◆ | 10 concurrent claims on one alias                              | Exactly one `201`, nine `409`             | `integration/links`             |

## 5. Expiry (M1/M2)

| #    | Input                                                            | Expected                                                      | Test                               |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| 56 ◆ | `2026-02-01T00:00:00Z`                                           | Accepted                                                      | `unit/expiry`                      |
| 57 ◆ | `2026-02-01T05:30:00+05:30`, `-04:00` offsets                    | Accepted, normalised to UTC                                   | `unit/expiry`                      |
| 58 ◆ | `2026-02-01T00:00:00.250Z` (fractional seconds)                  | Accepted                                                      | `unit/expiry`                      |
| 59 ◆ | `2026-02-01T00:00:00` (no zone)                                  | `400 INVALID_EXPIRY` — never guessed as server-local          | `unit/expiry`, `integration/links` |
| 60 ◆ | `2026-02-01` (date only)                                         | `400 INVALID_EXPIRY`                                          | `unit/expiry`                      |
| 61 ◆ | `2026-13-01T00:00:00Z`, `2026-02-30T…`, `tomorrow`, `01/02/2026` | `400 INVALID_EXPIRY`                                          | `unit/expiry`                      |
| 62 ◆ | Past timestamp / exactly now                                     | `400 EXPIRY_IN_PAST`                                          | `unit/expiry`, `integration/links` |
| 63 ◆ | Beyond 10 years                                                  | `400 EXPIRY_TOO_FAR`                                          | `unit/expiry`                      |
| 64 ◆ | Hit exactly at `expires_at`                                      | `410` — the instant itself is expired                         | `integration/links`                |
| 65 ◆ | Hit one second after expiry                                      | `410` with `details.expiredAt`                                | `integration/links`                |
| 66 ◆ | Stats for an expired link                                        | `200` with `expired: true`, clicks intact                     | `integration/links`                |
| 67 ◆ | Re-shorten a URL whose only link expired                         | New code; old code remains 410                                | `integration/links`                |
| 68 ◆ | `expiresAt: null` / `""`                                         | Treated as "no expiry"                                        | `integration/links`                |
| 69   | Server clock moves backwards                                     | Link appears un-expired again (state derives from wall clock) | —                                  |

## 6. Resolution (M2)

| #    | Input                              | Expected                                        | Test                                       |
| ---- | ---------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| 70 ◆ | Valid code                         | `302` + `Location` + `Cache-Control: no-store`  | `integration/links`                        |
| 71 ◆ | Unknown code                       | `404 LINK_NOT_FOUND`                            | `integration/links`                        |
| 72 ◆ | Deleted code                       | `410 LINK_GONE`                                 | `integration/links`, `integration/service` |
| 73 ◆ | `HEAD` twice                       | `302` both times, `totalClicks` stays 0         | `integration/links`                        |
| 74 ◆ | `PUT /:code`, `POST /:code`        | `405` + `Allow: GET, HEAD`                      | `integration/links`                        |
| 75 ◆ | `/CaseAlias` vs `/casealias`       | Case-sensitive: only the exact code resolves    | `integration/links`                        |
| 76 ◆ | Alias `stats2` (prefix of a route) | Redirects normally — reserved matching is exact | `integration/links`                        |
| 77 ◆ | `/stats/x/y/z` (extra segments)    | `404 ROUTE_NOT_FOUND`                           | `integration/links`                        |
| 78 ◆ | Always 302, never 301              | Expiry/deletion honoured by clients and caches  | `integration/links`                        |

## 7. Analytics (M5)

| #    | Scenario                                      | Expected                                                     | Test                                        |
| ---- | --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| 79 ◆ | 2 hits on day 1, 1 on day 3                   | `totalClicks: 3`; buckets `[2, 0, 1]`                        | `integration/links`                         |
| 80 ◆ | `lastAccessedAt`                              | Timestamp of the newest click                                | `integration/links`                         |
| 81 ◆ | No clicks                                     | Zeros, `lastAccessedAt: null`, one zero bucket               | `integration/links`                         |
| 82 ◆ | Same IP twice, another IP once                | `totalClicks: 3`, `uniqueVisitors: 2`                        | `integration/links`                         |
| 83 ◆ | Click write fails (table locked/dropped)      | Redirect still succeeds; warning logged                      | `integration/service`                       |
| 84 ◆ | Raw IP storage                                | Only `ip_hash` (HMAC-SHA256) is stored; API never returns it | `integration/links`                         |
| 85 ◆ | UA/referer huge                               | Truncated to 512 chars                                       | `integration/service`                       |
| 86 ◆ | `limit` out of range on `/stats/:code/clicks` | Clamped to 1–100                                             | `service.recentClicks`, `integration/links` |
| 87 ◆ | Stats after soft delete                       | Readable, `deletedAt` set                                    | `integration/links`                         |
| 88 ◆ | Dense series capped at 366 days               | Oldest entries drop off, newest kept                         | `unit/support`                              |

## 8. Security / abuse

| #     | Scenario                                         | Expected                                                      | Test                   |
| ----- | ------------------------------------------------ | ------------------------------------------------------------- | ---------------------- |
| 89 ◆  | Writes with `API_KEYS` set, no header            | `401 UNAUTHORIZED`                                            | `integration/security` |
| 90 ◆  | `Authorization: bearer <key>` (lowercase scheme) | Accepted                                                      | `integration/security` |
| 91 ◆  | `X-API-Key` instead of Bearer                    | Accepted                                                      | `integration/security` |
| 92 ◆  | Prefix of a valid key, or a superstring          | `401` — no partial match, constant-time                       | `integration/security` |
| 93 ◆  | `DELETE` without key                             | `401`, link untouched                                         | `integration/security` |
| 94 ◆  | Redirect with no key                             | `302` — public by design                                      | `integration/security` |
| 95 ◆  | 31st write in a minute                           | `429 RATE_LIMITED` + `RateLimit-*` headers                    | `integration/security` |
| 96 ◆  | 10 × `/health` under a 2/min global limit        | All `200` — health is exempt                                  | `integration/security` |
| 97 ◆  | 9 KB body                                        | `413` or `400`, never a crash                                 | `integration/security` |
| 98 ◆  | `text/plain` POST                                | `415 UNSUPPORTED_MEDIA_TYPE`                                  | `integration/links`    |
| 99 ◆  | `{"__proto__":{...}}` in body                    | Rejected; `Object.prototype` unpolluted                       | `integration/security` |
| 100 ◆ | `<script>` in the `url` field                    | Error message does not echo it                                | `integration/security` |
| 101 ◆ | Malicious `x-request-id` with CRLF               | Replaced with a UUID (no header injection)                    | `integration/links`    |
| 102 ◆ | Target URL with a script payload                 | Dashboard renders via `textContent`; CSP blocks inline script | manual + `SECURITY.md` |
| 103 ◆ | Millions of distinct URLs (storage exhaustion)   | Rate limits + per-IP write budget; quotas are future work     | `SECURITY.md`          |

## 9. Operations

| #     | Scenario                                                      | Expected                                                                 | Test                  |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| 104 ◆ | Restart on an existing database                               | Migrations are idempotent; data intact; version stays 2                  | `integration/service` |
| 105 ◆ | Migrations interrupted                                        | Each runs in a transaction; version only advances on success             | migration runner      |
| 106 ◆ | Two processes writing                                         | `busy_timeout=5000` makes writers wait instead of erroring               | pragma                |
| 107 ◆ | SIGTERM                                                       | Stops accepting, finishes in-flight, closes DB (WAL checkpoint), exits 0 | `src/index.ts`        |
| 108 ◆ | `EADDRINUSE`                                                  | Fatal log naming the port, exit code 1                                   | `src/index.ts`        |
| 109 ◆ | Production without `API_KEYS`/real `IP_SALT`/`https BASE_URL` | Refuses to boot with a readable reason                                   | `unit/support`        |
| 110 ◆ | Link purged after retention                                   | Row and clicks deleted (cascade); code returns 404                       | `integration/service` |
| 111 ◆ | Health check                                                  | `200` with schema version, no caching, no rate limit                     | `integration/links`   |

## Known limitations (explicitly not handled)

1. **DNS rebinding** — validation is syntactic; a hostname that later resolves to a
   private IP is not re-checked at redirect time.
2. **Click dedupe** — every `GET` counts (documented choice); no per-IP window.
3. **Multi-instance rate limiting** — in-memory store per process.
4. **Malware/phishing reputation** — no safe-browsing check; rate limits are the only
   abuse control.
5. **Very large click volumes** — SQLite single writer; partitioning/archival is future
   work.
6. **Backdated clocks** — expiry derives from wall-clock time, so a backwards clock can
   make an expired link valid again.
