---
name: url-shortener-security-review
description: 'Use when reviewing the URL shortener for security: open-redirect abuse, SSRF-adjacent targets, stored XSS in the dashboard, authn/authz gaps, rate-limit behaviour, PII in logs or the click table, and SQL/parameterisation.'
---

# Security Review Checklist — URL Shortener

Run this before any commit that touches URL parsing, redirects, auth, logging, the
dashboard, or the schema.

## 1. Target URL handling

- [ ] Only `http:`/`https:` reachable; every other scheme throws `UNSUPPORTED_SCHEME`.
- [ ] Control chars (`\u0000-\u001F`, `\u007F`), zero-width and bidi chars rejected.
- [ ] Backslashes rejected (browsers normalise `\` to `/`).
- [ ] Embedded credentials (`user:pass@`) rejected.
- [ ] Host labels validated: `^(?!-)[a-z0-9-]{1,63}(?<!-)$`, length ≤ 253.
- [ ] Private targets blocked: loopback, RFC1918, link-local, CGNAT, ULA, multicast,
      metadata IPs, `.local`/`.internal`/`.lan`/`.home.arpa`, single-label hosts.
- [ ] Obfuscated IPv4 (`2130706433`, `0x7f.1`, `0177.0.0.1`) is canonicalised by `URL`
      *before* classification — verify the code path still parses first.
- [ ] IPv4-mapped IPv6 (`::ffff:127.0.0.1`) classifies the embedded address.
- [ ] Self-reference to `BASE_URL` origin rejected.
- [ ] `ALLOW_PRIVATE_HOSTS` cannot be enabled in production (boot check present).

Run the matrix: `npm test -- tests/unit/url.test.ts tests/integration/links.test.ts`.

## 2. Redirect hardening

- [ ] Always `302`; `Cache-Control: no-store, max-age=0`.
- [ ] `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` on the redirect.
- [ ] `HEAD` does not count a click.
- [ ] No `Location` built from unvalidated input (only the stored canonical URL).

## 3. Authn / authz

- [ ] `POST /shorten`, `DELETE /:code`, `GET /links` require a key when `API_KEYS` is set.
- [ ] Key comparison uses `timingSafeEqual` with **all** keys evaluated (no early exit).
- [ ] `Bearer` parsing rejects empty/whitespace-only tokens.
- [ ] Production boot fails without `API_KEYS`.
- [ ] No `403` branch silently treats failure as success.

## 4. Input & output

- [ ] Body ≤ 8 KB; schema is `.strict()` (unknown fields rejected).
- [ ] Alias regex `^[A-Za-z0-9_-]{3,32}$`; no `.`/`/`/`%`; reserved words blocked
      case-insensitively.
- [ ] `limit`/`offset` clamped (1–100 / ≥ 0).
- [ ] No SQL string interpolation — every query is a prepared statement.
- [ ] Error responses never echo raw user input (no reflected `<script>`).
- [ ] `x-request-id` pattern-validated before being echoed (no header injection).

## 5. Dashboard

- [ ] All server data written with `textContent`, never `innerHTML`.
- [ ] No inline `<script>`, no inline `on*=` handlers (CSP has no `unsafe-inline`).
- [ ] Outbound links carry `rel="noopener noreferrer nofollow"`.
- [ ] API key only in `sessionStorage`, never in the URL or a cookie.

## 6. Privacy & logging

- [ ] Logs use `req.path`, not `req.url` (query may contain a target URL).
- [ ] `redact` covers `authorization`, `x-api-key`, `cookie`.
- [ ] Click rows store `ip_hash` only (HMAC-SHA256 + `IP_SALT`), never a raw IP.
- [ ] UA/referer truncated (≤512 chars).
- [ ] API never returns `ip`/`ip_hash`.

## 7. Abuse & availability

- [ ] Global / write / redirect rate limits present; `/health` exempt.
- [ ] `TRUST_PROXY` documented — misconfiguration collapses all clients into one bucket.
- [ ] Analytics write is fail-open (a failure cannot 5xx the redirect).
- [ ] Creation retries bounded (8) then `503`, so a full code space cannot spin forever.
- [ ] Prune job exists for retention.

## 8. Robustness

- [ ] Expected failures are `AppError` with a stable code; unexpected ones are opaque 500s.
- [ ] No framework HTML error pages (body-parser errors mapped).
- [ ] `busy_timeout` set; `BEGIN IMMEDIATE` on the create path.
- [ ] Graceful shutdown closes the DB (WAL checkpoint).

## Residual risks to restate in any security write-up

DNS rebinding at redirect time · no phishing reputation feed · in-memory rate limits ·
single SQLite writer · proxy-level URL logging.

## Reporting

For each finding: severity (blocker/high/medium/low), file:line, the concrete failing input,
and the test that should be added. Do not mark an item resolved without an automated test or
an explicit justification for why a test is impractical.
