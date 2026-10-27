# AI Collaboration Log

This file records how the implementation was produced with an AI pair-programmer: the
prompts that mattered, what the model produced, and — importantly — **where the output was
wrong and how it was corrected**. The corrections are the part that made the result
trustworthy.

Tools: GitHub Copilot (agent mode) in VS Code, with project-scoped skills and guardrails
(see `docs/SKILLS_AND_GUARDRAILS.md`).

---

## 1. Framing the work

**Prompt**

> Build the URL shortener MVP (M1–M5). Node.js + Express + SQLite, TypeScript, under
> `submissions/kunal-p1/url-shortener/`. Include API key auth, rate limiting, a dashboard,
> tests, docs, and agent skills/guardrails.

**Why it worked**: it fixed the stack, the location, and the grading criteria up front. The
first useful output was not code — it was a decomposition into pure domain rules, a service
layer, repositories and HTTP edges, which is what the final tree follows.

**Correction at this stage**: the first draft put URL validation inside the route handler.
Rejected because M3's matrix is the most edge-case-dense logic in the project and would then
require HTTP for every assertion. Moved to `src/domain/url.ts` (pure) — the unit suite ran in
milliseconds and immediately exposed two bugs (below).

---

## 2. Milestone-by-milestone prompting

The pattern used throughout: **state the invariant, ask for the enforcement point, then ask
for the test that fails if the invariant is broken.**

### M1 — codes

**Prompt**

> Generate base62 codes of 6–8 chars. Must be uniform and unguessable. Retry on collision.

**Output that was kept**: `crypto.randomInt` per character (no modulo bias), configurable
length, retry loop with a bounded attempt count.

**Correction**: the first version used `Math.random()` with a modulo and a 6-char default.
`Math.random` is not cryptographically strong and invites enumeration; modulo introduces
bias. Also 6 chars (62⁶ ≈ 5.7×10¹⁰) is thin for a public shortener — the default became 7
(62⁷ ≈ 3.5×10¹²) while still honouring the brief's 6–8 range. A distribution test now fails
if either mistake returns:

```ts
// 62 * 400 draws; every character within 15% of uniform
expect(maxDeviation).toBeLessThan(0.15);
```

### M2 — redirect semantics

**Prompt**

> Resolve a code: 302 redirect, 410 for expired, 404 for unknown.

**Correction that mattered**: the draft used `res.redirect(link.url)` (Express default 302)
but did _not_ set cache headers. Discussed 301 vs 302 explicitly: **301 is cached
heuristically by browsers**, so a link that expires or is deleted would keep redirecting from
a user's local cache. Decision recorded as a guardrail: _302 only, always `no-store`_.

**Second correction**: `res.redirect()` in Express 5 sends a small HTML body, which is fine,
but a `HEAD` handler initially reused `res.redirect` — that both wrote a body and recorded a
click. Split into an explicit `HEAD` branch that validates, sets headers, and `end()`s with no
click. There is now a test asserting `totalClicks === 0` after two `HEAD`s.

### M3 — validation

**Prompt**

> Only http/https. Reject malformed URLs and `javascript:`-style schemes. Think about
> bypasses.

**Output that was kept**: scheme allowlist, control-character rejection, credential
rejection, host-label validation.

**Corrected/added after review**:

| Model's first pass                      | Why it was insufficient                                                | Fix                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `url.startsWith('javascript:')`         | Trivially bypassed (`JaVaScRiPt:`, leading spaces, `\t`)               | Parse with `URL`, then compare `protocol`                            |
| Allowed all hosts                       | Open redirect into `localhost`/metadata is the classic shortener abuse | `isPrivateHostname` with full IPv4/IPv6 range logic                  |
| Checked only `127.0.0.1` and `10.*`     | Missed CGNAT, link-local, ULA, multicast, IPv4-mapped IPv6             | Explicit range classification + tests per range                      |
| Compared the raw string for private IPs | Bypassed by `2130706433` and `0x7f.1`                                  | Classify **after** `new URL()` canonicalisation (documented in code) |
| Ignored embedded credentials            | `https://bank.com@evil.com` reads as bank.com to a human               | `URL_HAS_CREDENTIALS`                                                |

**Bug the unit tests caught**: the IPv6 expander returned a 9-element array for
`::ffff:127.0.0.1` because the dotted tail was appended before the `::` expansion. The test
matrix now includes that exact input.

### M4 — idempotency

**Prompt**

> Shortening the same URL twice must return the same code, unless a custom alias is given.

**First design (rejected)**: unique index on `url` and a `SELECT` before `INSERT`. Two
problems: raw strings differ by case/default port, and two concurrent requests both see "no
row".

**Final design**

1. Canonicalise, then SHA-256 → `url_hash` (so `HTTPS://Example.com:443` collides with
   `https://example.com`).
2. Wrap lookup + insert in a transaction with `.immediate()` (takes the write lock first).
3. Add a partial unique index as a hard backstop.
4. Map `SQLITE_CONSTRAINT_UNIQUE` to either "retry with a new code" or "return the raced row".

**Semantic question the prompt did not cover**: what if the only matching link has expired?
Two options were considered — resurrect the old code, or mint a new one. **Chose mint a new
one** (the old code keeps returning 410) so historical stats stay attributable and a code
cannot silently change meaning after it was declared dead. This is now an explicit guardrail
and a test.

**Concurrency proof**: 20 parallel identical requests must yield exactly one `201`, nineteen
`200`s, and one distinct code. That test also caught an early bug where the retry branch lost
the race and threw a 500 instead of returning the winner.

### M5 — analytics

**Prompt**

> Stats per code: total clicks, clicks per day, last accessed time.

**Corrections**:

- The draft computed stats by scanning `clicks` for the whole table. Added
  `idx_clicks_code_time (code, clicked_at DESC)`; the aggregate is now index-served.
- The draft used JavaScript `toISOString().slice(0,10)` for bucketing per request. Moved to
  SQL `strftime('%Y-%m-%d', clicked_at/1000, 'unixepoch')` so bucketing is UTC by definition
  and happens once, in the database.
- Gap days were missing from the series, forcing every consumer to re-derive them. Added
  `buildDenseSeries` (zero-filled, capped at 366 points) with a unit test.
- The draft let a click-insert failure produce a 500 **after** the redirect had been decided.
  Changed to fail-open: catch, log a warning, continue. A test drops the `clicks` table and
  asserts the redirect still works.

**Privacy correction**: the first schema stored `ip`. Replaced with `ip_hash`
(HMAC-SHA256 + `IP_SALT`) and added `uniqueVisitors` as a by-product. `IP_SALT` became a
production boot requirement.

---

## 3. Prompting for the non-obvious requirements

### Security hardening

**Prompt (skill-driven)**

> Review this as an attacker: what breaks a URL shortener? Cover open redirect, SSRF-adjacent
> targets, stored XSS in the dashboard, key brute force, log leakage.

The resulting checklist became `.github/skills/url-shortener-security-review/SKILL.md`. It
produced three changes that were not in the original plan:

1. `Referrer-Policy: no-referrer` on redirects — otherwise the short URL (and its code) leaks
   to third-party sites.
2. `x-request-id` validation — the draft echoed any client value into a response header,
   which is a header-injection vector. Now pattern-validated, replaced with a UUID otherwise.
3. `textContent`-only dashboard rendering + CSP without `unsafe-inline`, so a stored target
   URL containing markup cannot execute.

### Edge-case enumeration

**Prompt**

> Enumerate edge cases beyond the brief, grouped by area, each with expected behaviour and
> the test that covers it.

Output became `docs/EDGE_CASES.md` (111 rows). It surfaced decisions the brief was silent on:

- exact-expiry-instant behaviour (`expires_at <= now` ⇒ 410);
- timezone-less `expiresAt` (rejected rather than guessed);
- alias reuse after expiry (409);
- `HEAD` must not count a click;
- case-sensitive codes and reserved-word shadowing;
- migration idempotency on restart;
- `EADDRINUSE` and SIGTERM behaviour.

---

## 4. Places the model was wrong (and how it was caught)

| #   | Model output                                                                     | Caught by                                                        | Resolution                                                            |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `DailyClicks` declared twice in `types.ts` (interface + type alias)              | TypeScript `--noEmit`                                            | Removed the alias, kept `DailyClicksEntry[]`                          |
| 2   | A test used `expect.anything() as never` as an error code                        | Reading the assertion while writing the next test                | Rewrote as a table of `[input, expectedCode]`                         |
| 3   | `Stats: public or auth` handled by mounting the auth middleware unconditionally  | Integration test `keeps stats public by default` failed with 401 | Introduced `statsAuth` conditional                                    |
| 4   | `DELETE /:code` fell through to the redirect router's catch-all and returned 405 | Integration test `protects deletes…`                             | Mounted the links router (with DELETE) **before** the redirect router |
| 5   | `ip_hash` test asserted non-null while supertest sent no IP                      | Test failed                                                      | Test corrected to assert "no raw IP" rather than a specific hash      |
| 6   | IPv6 expander off-by-one for IPv4-mapped addresses                               | `isPrivateHostname('::ffff:127.0.0.1')`                          | Fixed the expansion, added the case to the matrix                     |
| 7   | Route order: `/:code` mounted before `/links`                                    | 404 on `/links`                                                  | Reordered mounts; documented as a trap in the skill                   |
| 8   | Config test asserted non-existent properties                                     | `tsc`                                                            | Replaced with real defaults                                           |

Pattern: **the tests and the strict compiler caught the model, not the other way round.** That
is the intended division of labour.

---

## 5. Prompts that worked well (reusable)

- _"What is the smallest pure function that decides this, and which inputs would break a naive
  implementation?"_ — produced the URL and private-host matrices.
- _"Write the failing test first, then the minimum code that passes it, then tell me which
  other test this change could break."_ — kept the concurrency and expiry tests honest.
- _"Do not weaken the assertion. If the behaviour is right, tell me which test is wrong and
  why."_ — used twice; both times the test was wrong, once the code was.
- _"List the residual risks you are not fixing."_ — produced the honest limitations section
  rather than an over-claimed security posture.

## 6. Prompts that worked badly (and the fix)

- _"Make it production ready."_ — produced cosmetic changes (more middleware) without
  addressing correctness. Replaced with a checklist: transactions, cache headers, config
  validation, graceful shutdown, privacy.
- _"Add tests."_ — produced assertions of the form `expect(status).toBeGreaterThanOrEqual(400)`.
  Replaced with _"for each error path, assert the exact code and status, and name the test
  after the milestone"_.

---

## 7. Division of labour

| Human                                                                                              | AI                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Chose the stack, scope, and which requirements were in/out                                         | Produced the layered skeleton and most first drafts |
| Decided the semantic questions (expired re-shorten, alias after expiry, 301 vs 302, private hosts) | Enumerated options and trade-offs for each          |
| Rejected weakened tests and over-claims                                                            | Wrote the test matrices once the rules were fixed   |
| Verified by running the suite and the curl walkthrough                                             | Kept docs, guardrails and code consistent           |

Everything in this repository was reviewed line by line; the corrections above are the audit
trail of that review.
