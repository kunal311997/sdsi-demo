---
name: url-shortener-guardrails
description: 'Hard rules for the URL shortener submission (submissions/kunal-p1/url-shortener). Use when editing or reviewing any TypeScript, SQL, or route code in that project.'
applyTo: 'submissions/kunal-p1/url-shortener/{src,tests,scripts}/**/*.ts'
---

# URL Shortener — Guardrails

These are non-negotiable rules for this codebase. They encode the errors that are easiest
to reintroduce. If a change requires breaking one, stop and document why in
`docs/ARCHITECTURE.md`.

## Correctness rules (M1–M5)

1. **Codes are base62 and 6–8 chars.** Never use `Math.random`, never use sequential ids,
   never hardcode a length outside `MIN_CODE_LENGTH`–`MAX_CODE_LENGTH`. Use
   `generateCode()` from `src/domain/base62.ts`.
2. **Redirects are `302`, never `301`.** A 301 is cached by browsers; expiry and deletion
   would silently stop working. Always send `Cache-Control: no-store`.
3. **`HEAD /:code` must not record a click.** Probes and previews would inflate analytics.
4. **Expiry comparison is `expires_at <= now`** — the exact instant is already expired.
5. **Idempotency keys on the normalised URL hash, not the raw string.** Any change to
   `normalizeUrl` changes M4 behaviour; update `tests/unit/url.test.ts` in the same commit.
6. **Alias requests never dedupe to a generated code**, and a taken alias is `409`.
7. **An expired non-alias link must not be reused.** Mint a new code and leave the old one
   returning `410`.
8. **Stats remain readable after expiry and after soft delete.** Never hard-delete on
   `DELETE /:code`; set `deleted_at`.

## Security rules

9. **Schemes: only `http:` and `https:`.** Every other scheme (`javascript:`, `data:`,
   `file:`, `vbscript:`, `blob:`, `about:`, `ftp:`, `ws:`) must throw `UNSUPPORTED_SCHEME`.
10. **Never bypass `normalizeUrl`.** It performs control-character rejection, credential
    rejection, private-host classification and self-reference checks. Do not parse URLs
    with `new URL` elsewhere in the request path.
11. **Private/loopback/metadata hosts stay blocked by default.** `ALLOW_PRIVATE_HOSTS` is
    the only escape hatch and must remain refused in production.
12. **No alias may shadow a route.** Add new route prefixes to `RESERVED_ALIASES` in
    `src/domain/alias.ts` in the same commit that adds the route.
13. **Never log target URLs, query strings, API keys, or raw IPs.** Log `req.path` (not
    `req.url`), and use `hashIp()` for any IP storage.
14. **Never interpolate user input into HTML.** The dashboard writes with `textContent`
    only. No `innerHTML`, no inline `<script>`, no inline event handlers — CSP forbids them.
15. **API key comparison must stay constant-time** (`safeCompare`/`matchesAnyKey`). Do not
    add early `break`/`return` inside the key loop.

## Data rules

16. **All timestamps are epoch milliseconds (UTC integers).** Format to ISO only at the
    service/route boundary via `toIso()`.
17. **Every write that touches `links` + `clicks` together runs in one transaction**
    (`transaction(db, fn)` from `src/db/connection.ts`), and creation uses the default
    `BEGIN IMMEDIATE` mode.
18. **Analytics writes are fail-open.** A click-recording failure must be caught and
    logged; it must never turn a redirect into a 5xx.
19. **All SQL lives in `src/db/*`.** Routes and services must not contain SQL strings.
20. **New schema changes are new migrations.** Never edit an already-shipped migration;
    append a new entry to the `migrations` array with the next id.

## Layering rules

21. **`src/domain/*` has no I/O and no Express imports.** It must stay unit-testable
    without a database.
22. **Business errors are `AppError` with a code from `ERROR_CODES`.** Never `throw new
    Error('...')` for an expected client mistake, and never set status codes in services.
23. **Every new error code needs**: an entry in `ERROR_CODES`, a row in `docs/API.md`, and
    a test asserting the status + code.

## Testing rules

24. **Every rule change lands with a test.** Minimum: one success case and one rejection
    case per new branch.
25. **Tests use the injected clock (`ctx.clock.set/advance`) and an in-memory DB.** Never
    use `Date.now()` in a test assertion and never write to the real database.
26. **Do not weaken a test to make it pass.** If behaviour is wrong, fix the code; if the
    expectation is wrong, say so explicitly in the change description.
27. **`npm run verify` must pass** (typecheck + lint + tests) before a commit.

## Style rules

28. Strict TypeScript: no `any` (use `unknown` + narrowing), no non-null `!` assertions on
    request data, no `@ts-ignore`.
29. Prefer `const`, early returns, and named helpers over deeply nested conditionals.
30. Comments explain *why*, not *what*. The existing comments describe decisions — keep
    that tone and do not delete them without replacing the rationale.
