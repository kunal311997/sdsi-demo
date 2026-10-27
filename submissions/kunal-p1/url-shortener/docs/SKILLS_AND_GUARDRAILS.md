# Skills and Guardrails

This submission ships agent customization artifacts in two places:

1. **Workspace root** `c:\Projects\sdsi-demo\.github\` — where VS Code actually discovers
   skills and instructions (it does not scan nested `.github/` folders).
2. **This project's docs** — human-readable copies/references so the submission is
   self-explanatory when read in isolation.

## What is in `.github/`

### Guardrails (always applied to matching files)

| File                                                            | `applyTo`                                                        | Purpose                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/instructions/url-shortener-guardrails.instructions.md` | `submissions/kunal-p1/url-shortener/{src,tests,scripts}/**/*.ts` | 30 hard rules: 302-only redirects, base62-only codes, no `Math.random`, private-host blocking, constant-time key comparison, epoch-ms timestamps, transactions, layering, migrations, no `innerHTML`. |
| `.github/instructions/url-shortener-testing.instructions.md`    | `submissions/kunal-p1/url-shortener/tests/**/*.ts`               | Determinism rules (injected clock, in-memory DB), required coverage per change, anti-patterns.                                                                                                        |

Why instructions for these? They must apply to **most** work in the folder, silently, with
no invocation step. The `applyTo` globs are deliberately narrow so unrelated files in the
workspace do not pay a context cost.

### Skills (invoked on demand)

| Skill                                                   | When it is used                                                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/skills/url-shortener-dev/SKILL.md`             | Adding/changing features: the layered workflow, per-milestone contract, recipes (new endpoint, new config, new stat, new migration) and the traps already hit.                         |
| `.github/skills/url-shortener-security-review/SKILL.md` | Pre-commit security pass: 8 checklists covering targets, redirects, auth, input/output, dashboard, privacy, abuse, robustness — plus the residual risks that must not be glossed over. |

Why skills for these? They are multi-step procedures with checklists and codebase-specific
recipes — too long and too situational to load on every request.

## Guardrail summary (the rules that matter most)

1. **M2 is `302`, never `301`.** 301 is cached; expiry/deletion would break silently.
2. **M4 hashes the _normalised_ URL.** Changing `normalizeUrl` changes idempotency.
3. **Expired link + re-shorten = new code.** The old code stays `410`.
4. **Aliases are case-sensitive and may never shadow a route** (reserved-word blocklist).
5. **Only `http`/`https`.** Control chars, credentials, backslashes, private hosts are rejected.
6. **Click writes are fail-open.** Analytics never breaks a redirect.
7. **IPs are HMAC'd; target URLs never enter logs.**
8. **All SQL in `src/db/`; all pure rules in `src/domain/`; all orchestration in the service.**
9. **Every rule change needs a success test and a rejection test.**
10. **`npm run verify` before every commit.**

## Guardrail → code → test traceability

| Guardrail                                         | Enforced in                                   | Verified by                                           |
| ------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------- |
| base62, 6–8 chars, crypto-random                  | `src/domain/base62.ts`                        | `tests/unit/base62.test.ts`                           |
| http/https only, no credentials, no control chars | `src/domain/url.ts`                           | `tests/unit/url.test.ts`                              |
| private/metadata hosts blocked                    | `src/domain/net.ts`                           | `tests/unit/url.test.ts`                              |
| alias rules + reserved words                      | `src/domain/alias.ts`                         | `tests/unit/alias.test.ts`                            |
| expiry must be zoned, future, bounded             | `src/domain/expiry.ts`                        | `tests/unit/expiry.test.ts`                           |
| 302 / 410 / 404 + no-store                        | `src/routes/redirect.ts`                      | `tests/integration/links.test.ts`                     |
| idempotency + `BEGIN IMMEDIATE`                   | `src/services/linkService.ts`                 | `tests/integration/links.test.ts` (incl. 20-way race) |
| click + counter in one transaction, fail-open     | `src/services/linkService.ts`                 | `tests/integration/service.test.ts`                   |
| auth + constant-time compare                      | `src/middleware/auth.ts`, `src/lib/crypto.ts` | `tests/integration/security.test.ts`                  |
| rate limits                                       | `src/middleware/rateLimit.ts`                 | `tests/integration/security.test.ts`                  |
| CSP / no inline / textContent                     | `src/app.ts`, `public/app.js`                 | manual + `docs/SECURITY.md`                           |
| config fail-fast + production invariants          | `src/config.ts`                               | `tests/unit/support.test.ts`                          |
| timestamps are epoch ms, UTC buckets              | `src/db/*`, `src/domain/expiry.ts`            | `tests/unit/support.test.ts`                          |
| all SQL in repos                                  | `src/db/*.repo.ts`                            | review                                                |

## How these were used during development

`PROMPTS.md` records the actual collaboration: the requirement was decomposed into the
layers above, guardrail rules were written **before** the corresponding code (so they act
as constraints rather than after-the-fact documentation), and each milestone was validated
by an integration test that names it (`describe('M4: idempotent shortening')`).

## Extending this setup

- New route prefix → add it to `RESERVED_ALIASES` **and** to the guardrails list.
- New error code → `ERROR_CODES`, `docs/API.md`, and a test asserting status + code.
- New schema change → append a migration; never edit a shipped one.
- New dashboard interaction → keep it in `public/app.js` (CSP forbids inline script).
