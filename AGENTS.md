# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

540 Kitchen: a personal recipe site (cookbook.chrisandelissa.com). Public to browse; Google sign-in for one or two admins (server-side email allow-list); in-app Claude AI (admin-only); and an MCP server + HTTP API so ChatGPT and Claude.ai can submit recipes into an approval queue.

Requirements are in `docs/requirements/`. Owner decisions (D1–D18), the stack, and milestone status (M0–M8) are in `docs/implementation-plan.md`. Milestones are built one at a time, and each starts only when the owner says so. Keep confirmed requirements separate from proposed defaults. Never describe a proposed choice as owner-approved.

## Commands

- `npm run check`: typecheck (runs typegen first), lint, and all unit/integration tests. Run before calling work done.
- `npm test`: Vitest only. Single file: `npx vitest run tests/server/m5.test.ts`. Single test: add `-t "test name"`.
- `npm run test:e2e`: Playwright. It builds the Node host, runs it on :3100 against a throwaway SQLite DB in `.e2e/`, plus an empty second instance on :3101 (restore target, no AI key) and a mock Anthropic API on :3102. One project: `npx playwright test tests/e2e/m5.spec.ts --project=desktop`. Other projects: `phone-chromium`, `phone-webkit`, `tablet`. All depend on the `setup` seed project.
- `npm run smoke:ai`: live Claude API test (`tests/live/`). Costs money; run it only when asked.
- `npm run dev`: dev server in the Cloudflare runtime. Needs `hosting/cloudflare/.dev.vars` (copy from `.dev.vars.example`).
- `npm run db:generate`: create a migration after changing `server/db/`. `npm run db:migrate:local` applies it to local D1.
- `npm run auth:schema`: regenerate `server/db/auth-schema.ts` after changing Better Auth plugins.

## Architecture

**Two hosts, one app.** `hosting/cloudflare/worker.ts` (Workers + D1 + R2) and `hosting/node/app.ts` (Node + better-sqlite3 + filesystem media) are the only places that read the environment and bindings. Each one builds `Services` with `createServices()` in `server/app.ts` and calls `handleRequest()`. `vite.config.ts` picks the target with `BUILD_TARGET` (default `cloudflare`). On Workers, services are built **per request** on purpose: reusing a Better Auth instance across requests hung sign-in. Don't cache them. Config parsing lives in `server/config.ts` (zod). AI is turned off when `ANTHROPIC_API_KEY` is unset.

**Request routing** (`handleRequest`): `/health`, Better Auth (`/api/auth/*`, `/.well-known/*`), `/mcp`, `/api/v1/*`, and `/media/*` are handled before React Router. Everything else goes to the React Router app in `app/`. Every response gets `X-Robots-Tag: noindex` (D10).

**`server/core/` is pure business logic.** ESLint (`eslint.config.js`) fails the build if core imports Cloudflare, React/React Router, Drizzle/SQLite, Better Auth, the Anthropic or MCP SDKs, `node:*`, or anything under `adapters/` or `hosting/`. Core defines repository and service interfaces (e.g. `CatalogRepository`, `SubmissionsRepository`, `RecipeAi` in `core/ai.ts`). Implementations live in `server/adapters/` (Drizzle), `server/ai/anthropic.ts`, and `server/importers/`.

**Database.** Both hosts use SQLite, so there is one Drizzle schema (`server/db/`) and one set of migrations (`db/migrations/`). The `Database` type covers both the sync and async drivers, so always `await` queries. For multi-statement writes, use `atomic()` in `server/adapters/atomic.ts`: D1 `batch` on Workers, a transaction on Node. Search uses SQLite FTS5.

**UI routes** are listed in `app/routes.ts`. Loaders and actions get services with `context.get(servicesContext)` (`app/context.ts`). Admin gating is in `app/admin.server.ts` (`requireAdminPage` / `requireAdminWrite`). Every AI route must refuse signed-out (401) and non-admin (403) requests before any fetch or Claude call.

**External tools.** `server/mcp/server.ts` (MCP tools) and `server/api-v1.ts` (HTTP API) are thin layers over `core/submissions.ts`, so both follow identical validation and approval rules (AC-025). Auth for both goes through `server/tool-auth.ts` (OAuth via Better Auth, or API keys). Submissions either apply directly or wait in the Review queue, depending on the approval setting. Updates carry an expected revision; a stale revision becomes a `conflict`.

**In-app AI** fills the editor only; the owner's Save is the approval (D2). AI must never invent quantities (except recipes it writes in AI mode, D19), and ingredient suggestions never overwrite existing rows (D14). Link import tries schema.org JSON-LD first and falls back to Claude only when needed. Page fetching (`importers/fetch-page.ts`) is SSRF-guarded. The model defaults to `claude-opus-5-5` and can be changed with `ANTHROPIC_MODEL`. AI mode in the search bar (`core/discover.ts`, M7, D19) finds only new recipes: web links must be ones Claude's web search/fetch tools actually returned in that request, and recipes Claude writes itself (the one place AI may propose amounts) are labeled "Written by AI · untested". It never saves anything. The preference profile (`core/preferences.ts`) changes only when the owner refreshes it, and a refresh never brings back a rejected or corrected inference.

**Free-plan CPU limit** (~10 ms per request on Workers): keep server work light. Image resizing and re-encoding, and backup zip assembly and restore chunking, happen in the browser (`app/photo-prepare.ts`, `app/backup-client.ts`).

## Tests

Server tests use `createTestServices()` from `tests/helpers/services.ts`: an in-memory SQLite DB with real migrations, no network, and an optional `FakeAi` (records every call) and `MemoryMediaStore`. Route tests call loaders and actions directly with `createRouterContext(services)`, and use `sessionCookieFor()` for an admin session. Acceptance criteria are cited by ID (e.g. AC-047) in tests and in the plan's status tables.

## Workflow

- **One milestone per session.** Start by reading the milestone's section and status table in `docs/implementation-plan.md`. Don't start the next milestone until the owner says to.
- **Branches:** work on `feature/<name>` branches created from an up-to-date `origin/main` (e.g. `feature/m6-cooking-mode`). Never commit directly to `main`.
- **PRs:** open a PR to `main` on the remote when the work is done and verified. The owner reviews and merges it. Don't merge PRs yourself.
- **Staging:** stage files explicitly by path. Never use `git add -A` or `git add .`: the owner keeps untracked personal files in the repo.
- **Before opening a PR:** run `npm run check` and `npm run test:e2e`, then update the milestone's status table in the plan. Tell the owner about any secrets or manual steps the change needs.
- **Large pushes:** if a push fails with "remote end hung up", retry with `git -c http.postBuffer=157286400 push`.

## Migrations and production

- Migrations run in order and depend on each other. Apply them with one `wrangler d1 migrations apply` command; never run them in parallel or one by one out of order. Never edit a migration that has already been applied; add a new one.
- Production deploys come from Cloudflare Workers Builds when `main` changes. The deploy command must be `npm run deploy:ci`, which applies D1 migrations before deploying.
- **After any merged PR that adds a migration**, check production with `npx wrangler d1 migrations list cookbook --remote -c hosting/cloudflare/wrangler.jsonc` (read-only). It should say "No migrations to apply". If it lists pending ones, tell the owner and ask before applying them. In November 2026, 0003–0005 were silently skipped and signed-in pages failed with "Something went wrong".
  - **Run it from an up-to-date `main`.** Wrangler only compares production with the migration files in the local `db/migrations/` folder. In a stale checkout or a feature worktree, a new migration is missing, so the check wrongly says "No migrations to apply". First run `git fetch origin` and confirm the newest file in `db/migrations/` matches `git ls-tree --name-only origin/main db/migrations/`. In November 2026, 0007 was missed this way and every recipe page failed.
  - To double-check, list what production has actually applied: `npx wrangler d1 execute cookbook --remote -c hosting/cloudflare/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY id"` (read-only).
- Commands that change production (remote migrations, `wrangler secret put`, `wrangler deploy`) need the owner's confirmation first. Always pass `--name cookbook-site` or `-c hosting/cloudflare/wrangler.jsonc`, because the account has another Worker with similar settings.
- For production errors, `npx wrangler tail cookbook-site --format json` shows live logs while the owner reproduces the problem.
