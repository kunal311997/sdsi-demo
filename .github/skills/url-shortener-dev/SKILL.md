---
name: url-shortener-dev
description: 'Use when adding or changing features in submissions/kunal-p1/url-shortener: shortening, redirects, aliases, expiry, click analytics, dashboard, or configuration. Covers the layered workflow, the M1-M5 contract, and the verification loop.'
---

# URL Shortener Development Workflow

Use this skill for any feature or fix inside `submissions/kunal-p1/url-shortener/`.

## Project facts

- **Stack**: Node.js 22.5+, Express 5, `node:sqlite` (built-in, synchronous), TypeScript
  strict, Zod, pino, Vitest + Supertest. No build step for the dashboard and no native
  addon, so `npm install` is pure JavaScript.
- **Layers**: `domain/` (pure) → `db/` (SQL only) → `services/` (orchestration) →
  `routes/` + `middleware/` (HTTP). Dependencies point inwards.
- **Run**: `npm run dev` · **Verify**: `npm run verify` · **Coverage**: `npm run test:cov`.

## Milestone contract (do not regress)

| ID | Contract |
|---|---|
| M1 | `POST /shorten` → base62 code 6–8 chars, optional alias + expiry; `201` on create |
| M2 | `GET /:code` → `302` live / `410` expired-or-deleted / `404` unknown |
| M3 | Only `http`/`https`; reject malformed, `javascript:`-style schemes, credentials, control chars, private hosts |
| M4 | Same URL twice → same code (`200`), unless a custom alias is given |
| M5 | `GET /stats/:code` → total clicks, clicks per UTC day, last accessed |

## Workflow for a new feature

1. **Search before writing.** `grep_search` for the rule's current home:
   - validation → `src/domain/url.ts`, `alias.ts`, `expiry.ts`, `net.ts`
   - SQL → `src/db/*.repo.ts`
   - orchestration → `src/services/linkService.ts`
   - status codes/headers → `src/routes/*`
2. **Put pure logic in `domain/`,** thrown as `AppError`. Add the code to `ERROR_CODES`
   first, then implement.
3. **Expose through the service** (not directly from the route). Keep SQL in repos.
4. **Wire the HTTP edge last**: Zod schema, `requireApiKey` where appropriate, explicit
   `405` for wrong verbs, `Cache-Control` for mutable data.
5. **Update the three test layers**: domain unit test, HTTP integration test, and — if the
   rule is an edge case — a row in `docs/EDGE_CASES.md`.
6. **Sync docs in the same commit**: `README.md` (config/API table), `docs/API.md`
   (endpoint + error codes), `docs/ARCHITECTURE.md` (if data model or flow changed).
7. **Run `npm run verify`** and paste the result into the change summary.

## Recipes

**Add a config option**
`src/config.ts` (Zod schema + default) → `.env.example` → `README.md` config table →
test in `tests/unit/support.test.ts`.

**Add an endpoint**
Route factory in `src/routes/` → mount in `src/app.ts` *before* the `/:code` catch-all →
add prefix to `RESERVED_ALIASES` if it could collide → integration test → `docs/API.md`.

**Add a migration**
Append `{ id: n, name, up }` to `src/db/migrations.ts`; never edit shipped SQL. Add a
reopen test asserting `schemaVersion` and data survival.

**Add a stat**
Extend `ClicksRepository` with a prepared statement + index if needed, aggregate in
`LinkService.getStats`, expose in the route, test with the injected clock across two
UTC days.

## Traps that have already bitten this codebase

- Route order: `/:code` must stay **last**; a new `GET /foo` mounted after it is dead code.
- `express-rate-limit` needs `trust proxy` set correctly, or all clients share one bucket.
- Statements must use `COLLATE BINARY` for case-sensitive codes on SQLite.
- `transaction(db, fn)` is required for creation: it issues `BEGIN IMMEDIATE`, taking the
  write lock before the read so concurrent requests cannot both insert.
- `node:sqlite` is synchronous — never `await` inside a transaction callback.
- Express dispatches `HEAD` to `
- The dashboard is CSP-restricted: new JS must be in `public/app.js` (external), and DOM
  writes must use `textContent`.
- `better-sqlite3` is synchronous — never `await` inside a transaction callback.

## Definition of done

- [ ] `npm run verify` green
- [ ] New behaviour has a success + rejection test
- [ ] `docs/API.md` and `docs/EDGE_CASES.md` updated when contracts change
- [ ] No new `any`, no weakened assertions, no committed secrets or `.db` files
- [ ] `git diff` contains no unrelated reformatting
