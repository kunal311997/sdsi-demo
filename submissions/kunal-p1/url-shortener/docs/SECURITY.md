# Security & Robustness

## Threat model

A URL shortener is a **trust boundary in two directions**:

- **Inbound**: anyone can create links, so the write path must resist abuse, storage
  exhaustion and injection.
- **Outbound**: every short link is an open redirect, so a shortener can be abused to
  launder a malicious destination through a trusted-looking domain, or to probe internal
  networks.

| Threat                                                    | Impact                                                    | Mitigation                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `javascript:`/`data:` targets                             | Stored XSS on click                                       | Scheme allowlist (`http:`, `https:` only) rejects everything else with `UNSUPPORTED_SCHEME`                                       |
| Open redirect to private hosts                            | SSRF-adjacent internal probing, metadata credential theft | `BLOCKED_HOST` for loopback/RFC1918/link-local/CGNAT/ULA/metadata/single-label hosts, with `ALLOW_PRIVATE_HOSTS` opt-in for demos |
| Obfuscated IPv4 (`2130706433`, `0x7f.1`)                  | Bypass of private-host filter                             | WHATWG `URL` canonicalises numeric hosts to dotted quads before classification                                                    |
| Credential phishing display (`https://bank.com@evil.com`) | User misreads destination                                 | `URL_HAS_CREDENTIALS` rejects `user:pass@`                                                                                        |
| CRLF / header injection via URL or `x-request-id`         | Response splitting                                        | Control characters and invisible chars rejected; request ids pattern-validated, otherwise regenerated                             |
| Homograph / bidi spoofing                                 | Misleading links                                          | Invisible/bidi chars rejected; unicode hosts stored as punycode                                                                   |
| Stored XSS via dashboard                                  | Session/API-key theft                                     | `textContent`-only rendering, CSP with no `unsafe-inline`, no inline handlers                                                     |
| Alias shadowing a route                                   | Broken API, auth bypass                                   | Reserved-word blocklist + case-sensitive routing                                                                                  |
| Enumeration of codes                                      | Private link discovery                                    | 62⁷ ≈ 3.5 × 10¹² space, `crypto.randomInt` (uniform, non-sequential)                                                              |
| Brute force / key guessing                                | Unauthorised writes                                       | Constant-time comparison over all configured keys; rate limits                                                                    |
| Timing oracle on API keys                                 | Key recovery                                              | `timingSafeEqual`; length mismatch still performs a comparison                                                                    |
| Storage exhaustion                                        | Cost/DoS                                                  | 8 KB body cap, write rate limit, URL length cap, prune job                                                                        |
| Log-based PII leakage                                     | Privacy breach                                            | Query strings and target URLs are never logged; only path + status + request id                                                   |
| Database leak exposing visitors                           | Privacy breach                                            | IPs stored as HMAC-SHA256 with a server-side salt; UA/referer truncated                                                           |
| Concurrent double-allocation                              | Duplicate codes / lost updates                            | `BEGIN IMMEDIATE` + partial unique index + constraint mapping                                                                     |
| Click-write failure taking down redirects                 | Availability                                              | Fail-open with warning log                                                                                                        |

**Explicitly out of scope** (documented rather than pretended): DNS rebinding checks at
redirect time, malware/phishing reputation feeds, user accounts, per-tenant quotas, and
distributed rate limiting.

## Input validation rules

| Input            | Rule                                                                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`            | string → trim → reject empty, > `MAX_URL_LENGTH`, control/invisible chars, `\`; parse with `URL`; scheme ∈ {http, https}; no credentials; hostname labels match `^(?!-)[a-z0-9-]{1,63}(?<!-)$`; public host unless allowed; not a self-origin |
| `alias`          | string, 3–32 chars, `^[A-Za-z0-9_-]+$`, not a reserved word (case-insensitive)                                                                                                                                                                |
| `expiresAt`      | string, `YYYY-MM-DDThh:mm[:ss[.sss]]` + `Z`/`±hh:mm`, strictly future, ≤ `EXPIRY_MAX_DAYS`                                                                                                                                                    |
| Body             | `application/json` only, ≤ 8 KB, strict object (unknown keys rejected)                                                                                                                                                                        |
| `limit`/`offset` | integers, clamped (`1..100`, `≥ 0`)                                                                                                                                                                                                           |
| `x-request-id`   | ≤ 64 chars of `[A-Za-z0-9._:-]`, else regenerated                                                                                                                                                                                             |

Validation order matters: cheap structural checks (type, length, control chars) run before
parsing, so pathological inputs are rejected without allocating a `URL` object.

## Response hardening

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow        (redirects)
Cache-Control: no-store, max-age=0     (redirects and stats)
X-Powered-By: (removed)
```

The CSP has **no `unsafe-inline`**: `public/app.js` and `public/styles.css` are external
files, and all DOM writes use `textContent`, so a stored payload has nothing to execute.

`upgradeInsecureRequests` is disabled so the demo works over plain HTTP on localhost; an
HTTPS deployment should re-enable it and HSTS.

## Authentication & authorisation

- Keys are operator-supplied via `API_KEYS`; there is no user registry (single-tenant
  MVP). Production **refuses to start** without at least one key.
- Accepted headers: `Authorization: Bearer <key>` (case-insensitive scheme) or `X-API-Key`.
- Every configured key is compared with `timingSafeEqual`; the loop does not short-circuit,
  so the timing does not reveal position.
- Redirects, health and the dashboard stay public; stats are public by default so links can
  be shared, and `STATS_REQUIRE_AUTH=true` protects them.
- No `403` path exists today; `FORBIDDEN` is reserved for future per-link ownership.

## Rate limiting

| Bucket   | Default | Purpose                                           |
| -------- | ------- | ------------------------------------------------- |
| global   | 300/min | blunt flood protection                            |
| write    | 30/min  | creation abuse, which is also the phishing vector |
| redirect | 600/min | hot-link hammering of one code                    |

Keyed on client IP (`req.ip`), which is why `TRUST_PROXY` must be set correctly behind a
proxy — otherwise every request appears to come from the proxy and one client can throttle
everyone, or the header can be spoofed to evade limits. `/health` is exempt so
orchestrator probes never trip it.

## Data protection

| Data                 | Treatment                                                                |
| -------------------- | ------------------------------------------------------------------------ |
| Target URLs          | Stored (needed to redirect); excluded from logs                          |
| Visitor IPs          | HMAC-SHA256 + salt, truncated to 32 hex chars; never returned by the API |
| User agent / referer | Truncated to 512 chars; exposed only via `/stats/:code/clicks`           |
| API keys             | Never logged (`redact` paths), never returned                            |
| `IP_SALT`            | Required ≥ 16 chars and non-default in production                        |

Retention: `npm run db:prune -- <days>` physically removes links expired beyond the window
(clicks cascade). There is no automatic scheduler in the MVP — wire the script to cron/Task
Scheduler in a real deployment.

## Robustness practices

- **Fail fast config**: enum/range-validated env; production invariants enforced at boot.
- **Typed errors**: expected failures are `AppError` with stable codes; unexpected ones
  become opaque `500`s with the stack only in logs, correlated by `request_id`.
- **No HTML error pages**: body-parser and framework errors map to the JSON envelope.
- **Fail-open analytics**: click recording is wrapped in try/catch.
- **Bounded inputs**: body size, URL length, pagination, UA/referer, code length.
- **Transactional writes**: click + counter, create + lookup.
- **Graceful shutdown**: 10 s budget, then force exit; DB closed so WAL checkpoints.
- **Health endpoint**: proves the DB is readable, reports schema version.

## Verifying the claims

```bash
npm test                       # includes the security integration suite
curl -i -X POST localhost:3000/shorten -H 'Content-Type: application/json' \
  -d '{"url":"javascript:alert(1)"}'                 # 400 UNSUPPORTED_SCHEME
curl -i -X POST localhost:3000/shorten -H 'Content-Type: application/json' \
  -d '{"url":"http://169.254.169.254/latest/meta-data"}'  # 400 BLOCKED_HOST
curl -i localhost:3000/health | grep -i content-security-policy
```

## Residual risks

1. **DNS rebinding** — a hostname validated as public can later resolve to a private IP.
   Mitigation would require resolving DNS at redirect time (latency, cache complexity).
2. **Phishing destinations** — a publicly routable malicious URL is accepted. Production
   would add a reputation/safe-browsing check and an interstitial.
3. **Single-node limits** — in-memory rate limits and a single SQLite writer.
4. **Clock trust** — expiry uses wall-clock time; an attacker cannot change server time,
   but a misconfigured NTP can shift behaviour.
5. **Access logs at the proxy** — a reverse proxy may log full URLs; configure it to strip
   query strings if that matters.
