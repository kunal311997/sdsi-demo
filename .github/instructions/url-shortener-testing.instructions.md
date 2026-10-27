---
name: url-shortener-testing
description: 'Testing conventions for the URL shortener project: Vitest + Supertest structure, fixtures, determinism, and coverage expectations.'
applyTo: 'submissions/kunal-p1/url-shortener/tests/**/*.ts'
---

# Testing Conventions

## Structure

| Location | Scope |
|---|---|
| `tests/unit/**` | Pure domain + config. No HTTP, no DB. |
| `tests/integration/**` | Service + SQLite, or HTTP via Supertest. |
| `tests/helpers/**` | Fixtures only — no assertions. |

## Determinism (mandatory)

- Use `createTestContext()` / `createServiceContext()`; each builds an **in-memory**
  database and a **fixed clock** at `T0 = 2026-01-15T10:00:00Z`.
- Move time with `ctx.clock.set(ts)` or `ctx.clock.advance(ms)`. Never `vi.useFakeTimers`
  for domain logic, and never assert against `Date.now()`.
- Always `ctx.cleanup()` in `afterEach` — leaked handles keep Vitest from exiting.
- Never write to `./data/links.db`. Use `tempDir()` (auto-disposed) when a real file is
  required, e.g. migration/reopen tests.

## HTTP tests

- Import the app from the context and drive it with `supertest`; no `app.listen`.
- Rate limiting is disabled by default in fixtures (`disableRateLimit: true`) — opt in
  explicitly with `disableRateLimit: false` when testing `429`.
- Use `.expect(status)` so a regression fails at the right assertion, then assert the
  `error.code` (stable contract), not the human message.
- Auth tests must pass explicit `Authorization` headers; do not mutate module state.

## Required coverage per change

1. **Happy path** for the new behaviour.
2. **Rejection path** with the exact `AppError` code / HTTP status.
3. **Boundary**: empty, min−1, min, max, max+1 where a limit exists.
4. **Race**: if the change touches creation, assert the concurrent case still yields one code.

## Naming

- Describe behaviour, not implementation: `it('returns 410 for a code that expired one second ago')`.
- Include the milestone prefix when a test maps to the brief: `describe('M4: idempotent shortening')`.

## Anti-patterns

- `expect(status).toBeGreaterThanOrEqual(400)` — too vague; assert the precise code.
- Broad `try/catch` around an assertion that hides a thrown error.
- Sharing a single mutable context across files.
- Snapshot tests for API payloads (they hide intent and churn on formatting).
- Sleeping to test expiry — advance the injected clock instead.
