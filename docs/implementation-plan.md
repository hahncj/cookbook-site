# Implementation plan

Approved by the owner on 2026-11-03. Requirements live in [requirements/](requirements/README.md); this plan records how they will be built. If the plan and the requirements disagree, resolve the conflict before building the affected behavior.

Milestones are implemented one at a time. Each milestone starts only when the owner says to proceed.

## Owner decisions (2026-11-03)

| ID | Decision |
| --- | --- |
| D1 | External AI tools in use are **ChatGPT and Claude.ai**. The integration is a remote **MCP server with OAuth 2.1** (as those connectors require), plus a documented HTTP API over the same operations. |
| D2 | The approval queue and on/off toggle apply to **external tool submissions only**. In-app AI actions (paste import, link/photo extraction, ingredient identification) fill the editor; the owner's Save is the approval. |
| D3 | **Everything readable is public**: recipes, notes, experiment notes, feedback markers, sources, all photos, version history, pasted import text, and the preference profile. Private: credentials, settings, inactive (deleted) records, and pending/rejected submissions. Editing and all AI features are admin-only. |
| D4 | Host on **Cloudflare** at **cookbook.chrisandelissa.com** (domain moving to Cloudflare). |
| D5 | **One or two admin Google accounts** share full owner access. The server checks a configured email allow-list; Google OAuth configuration alone is not relied on. History records which account made each edit. |
| D6 | Deleting marks a record **inactive**: hidden from the app, kept in the database. No automatic purge; purging can be added later if needed. |
| D7 | Backups are **manual**: a "Download full backup" button and a matching restore tool. No scheduled backups. D1 Time Travel (7 days on the free plan) is an additional safety net. |
| D8 | Duplicate detection: **free text similarity on every add/import**, plus an explicit "Check with AI" button. |
| D9 | Preferences refresh **on request** (button) and **apply immediately**; the owner can view and correct them at any time. They only influence the "Ask AI for suggestions" feature. |
| D10 | **No search-engine indexing** (noindex + robots.txt). Pages still include schema.org Recipe markup for Lose It! URL import testing. |
| D11 | Test on **iPhone Safari, Chrome on iPhone, Home Screen web app, and Android**. |
| D12 | Old-chat import is **one recipe at a time**. No bulk or chat-export import. |
| D13 | Lose It!: copy/paste is acceptable **only if the whole ingredient list transfers in one paste**. Gate: the owner tests the Lose It! Text Importer with a multi-line sample before M6. If it accepts only one ingredient at a time, the feature is dropped. |
| D14 | AI ingredient identification works on **new and existing** recipes. Suggestions never overwrite existing ingredients without review. |
| D15 | Database is **Cloudflare D1** (owner choice), accessed only through an adapter. D1 is a documented Cloudflare dependency. |
| D16 | Use the **Cloudflare Workers free plan**. If measured CPU time exceeds free-plan limits, moving to the paid plan is the owner's decision. **2026-11-03:** measured production CPU exceeds the 10 ms limit (medians 11–34 ms; see M0 status) with no failures observed; the owner chose to **stay on the free plan and watch for errors** (Cloudflare error 1102 / `exceededCpu`). Revisit if failures appear. |

## Technology stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript 6.0 | One language for UI, server, and integration; catches errors early. (6.0 rather than 7 because typescript-eslint does not support 7 yet.) |
| Web framework | React Router v8 (framework mode) | Server-rendered pages (fast on phones; real HTML for Lose It! URL import); official adapters for Cloudflare Workers and Node. (Plan said v7; v8 is the current release of the same framework — updated in M0.) |
| Database | Cloudflare D1 (SQLite) | Free, included with Workers, ample for a personal catalog; Time Travel point-in-time restore. |
| Database toolkit | Drizzle ORM (D1 driver on Cloudflare; SQLite driver on the alternative host) | Same schema and migrations on both hosts. |
| Search | SQLite FTS5 | Full-text search over title, ingredients, and notes with no extra service. |
| Free duplicate matching | App-computed similarity (normalized title tokens and ingredient overlap) | SQLite lacks trigram matching; catalog size makes app-side scoring cheap. |
| Media storage | Cloudflare R2 through a binding, behind the `MediaStore` interface; filesystem on the Node host | Free tier (10 GB), no egress fees. (Updated in M0: the binding needs no access keys; portability comes from the interface, and an S3 adapter can be added for any S3-compatible store.) |
| Image handling | Browser resizes and re-encodes before upload; server validates type and size | Strips location metadata, converts HEIC, keeps uploads small, avoids server CPU. |
| Authentication | Better Auth: Google sign-in, `@better-auth/mcp` (OAuth 2.1 provider for MCP), and `@better-auth/cimd` | One portable library for owner sign-in and connector OAuth. Supports CIMD (current MCP client identification) with dynamic client registration as fallback. Avoids Cloudflare-only auth libraries. |
| MCP | Official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), stateless | Standard protocol; serves both the 2025 and 2026-07-28 protocol versions; no Express dependency; avoids Durable Objects-based helpers. |
| AI | Anthropic TypeScript SDK (`@anthropic-ai/sdk`), model `claude-opus-5-5` (configurable) | Vision, extraction, and recommendations; structured outputs for reliable fields; server-side web search and web fetch tools for discovery. |
| Link import | schema.org Recipe JSON-LD parsing first; Claude only as fallback | Many imports cost nothing and contain only what the page states. |
| Styling | Hand-written CSS with design tokens + React Aria components | Distinctive look with reliable accessibility. |
| Testing | Vitest (logic), Playwright (browser flows at phone/desktop sizes), recorded AI responses | Repeatable and free to run. |
| Primary hosting | Cloudflare Workers free plan + static assets | Owner choice; $0 within limits. |
| Alternative hosting | Docker image on Node with a SQLite file, verified on a disposable host (e.g., Fly.io or Render) | Same app code with only the database and entry adapters swapped. |

### Free-plan constraints and how the design respects them

- **~10 ms CPU per request.** Waiting on Claude, D1, or R2 does not count; rendering and computation do. Keep server work light, push image processing and backup assembly to the browser, and measure CPU time in M0.
- **100,000 requests/day; D1 5 GB storage and daily read/write quotas; R2 10 GB.** Far above expected personal use.
- **Backup and restore run in the browser.** The browser downloads the data export and each photo and assembles one zip on the device. Restore uploads data and photos in chunks. No single server request does heavy work.
- R2 may require a payment method on file before activation. The owner adds it if needed; nothing is purchased by the implementer.

### Known risks to check early (M0)

- Better Auth's OAuth provider must work with both the ChatGPT and Claude.ai connector flows (dynamic client registration, PKCE, metadata discovery).
- ChatGPT custom connectors depend on the owner's ChatGPT plan and developer-mode settings.
- Better Auth must run against D1 within free-plan CPU limits.

## Project structure

```
cookbook-site/
  app/                 Web pages and UI (routes, components, styles)
  server/
    core/              Business rules: recipes, revisions, submissions/approval,
                       scaling, duplicates, preferences. No framework or host imports.
    ai/                Claude client, prompts, structured output schemas
    auth/              Google sign-in, admin allow-list, connector OAuth
    api/               HTTP API handlers (thin layer over core)
    mcp/               MCP tools (thin layer over core; same rules as the API)
    adapters/          D1/SQLite database, S3 media (the only provider-touching code)
  db/migrations/       Schema migrations
  hosting/
    cloudflare/        Workers entry and wrangler config (D1/R2 bindings)
    node/              Node server entry and Dockerfile
  tests/               unit/, e2e/, fixtures/ (sample recipes, recorded AI replies)
  docs/                requirements/, implementation-plan.md, integration.md,
                       deployment.md, backup-restore.md, costs.md, device-checklist.md
```

An automated check fails the build if `server/core` imports Cloudflare, React Router, or provider SDKs (supports AC-038).

## Milestones

Each milestone ends with its completion criteria verified and reported against the listed acceptance criteria (AC IDs from [04-acceptance-criteria.md](requirements/04-acceptance-criteria.md)).

### M0 — Foundation and risk checks

- Project skeleton, linting, type checks, test runners, the core-isolation check.
- Local development with a local SQLite/D1 database.
- Create the D1 database and R2 bucket; deploy a health page to Cloudflare at cookbook.chrisandelissa.com and to Docker/Node.
- Connect Better Auth to D1; Google sign-in with the admin allow-list.
- MCP + OAuth check: a dummy tool connected from Claude.ai and from ChatGPT.
- Measure CPU time for a rendered page, a sign-in, and an MCP call on the free plan.
- Confirm a D1 Time Travel restore works.

**Done when:** both deployments are live and reach their databases; both AI apps connect and call the dummy tool; measured CPU times are recorded with a verdict on free-plan fit; the core-isolation check passes.
**Needs from the owner:** Cloudflare account with the domain, Google OAuth client, Anthropic API key, ChatGPT/Claude.ai connector access. No purchases by the implementer.

#### M0 status (2026-11-03; PRs #1–#4)

Verified locally:

- [x] Typecheck, lint, and 20 automated tests pass (`npm run check`).
- [x] Core-isolation lint rule rejects Cloudflare, framework, driver, and provider imports in `server/core`.
- [x] Cloudflare build runs in the local Workers runtime (workerd) with local D1 and R2: `/health` ok, pages render, noindex header and meta present.
- [x] Node build runs locally and in Docker (`hosting/node/Dockerfile`), applying migrations to a SQLite file on a volume.
- [x] MCP OAuth flow end to end in tests: client registration, PKCE authorization, consent, token exchange, and an authenticated `ping` call; tokens for another audience are rejected.
- [x] OAuth discovery metadata advertises CIMD, dynamic client registration, and PKCE S256; `/mcp` returns the RFC 9728 401 challenge.
- [x] Admin-only sign-in gate unit-tested (non-admin Google accounts rejected; matching is case-insensitive).
Verified in production (cookbook.chrisandelissa.com, Worker `cookbook-site`):

- [x] D1 database and R2 bucket created; Worker deployed; `/health` ok (database and media).
- [x] Real Google sign-in as an admin (`ADMIN_EMAILS` is a Wrangler secret; the consent screen is External, in Testing, with admin test users).
- [x] Claude.ai (via CIMD) and ChatGPT connectors connected through OAuth.
- [x] D1 Time Travel available (`wrangler d1 time-travel info` returns a restore bookmark).
- [x] Free-plan CPU measured with `wrangler tail` (54 requests, all `ok`): median `/health` 13.5 ms, home page 34 ms, `/mcp` (no token) 11 ms; ranges 5–99 ms. **This exceeds the 10 ms free-plan limit.** The earlier Node estimate (1.5–3 ms) underestimated Workers CPU by about 10×. Owner decision (D16): stay on the free plan and watch for errors.

Remaining:

- [ ] `ping` called from each connector (owner to confirm).
- [ ] A D1 Time Travel restore actually performed (owner's choice; restoring to the current bookmark loses nothing).
- [ ] Docker image deployed to a disposable alternative host (deferred to M8).

Problems found and fixed during deployment:

- PR #3: reusing one Better Auth instance across requests hung sign-in on a fresh production isolate (Workers cannot resolve a promise across requests). Services are now built per request; this is the main per-request CPU cost.
- PR #4: CIMD metadata fetch passed `redirect: "error"`, which Workers do not support, so Claude.ai could not connect. The Workers fetcher now uses `"manual"` and refuses redirects itself.

Watching for CPU errors: in the Cloudflare dashboard, Workers & Pages → cookbook-site → Metrics shows errors; `npx wrangler tail cookbook-site --format json` shows `"outcome": "exceededCpu"` for any request stopped by the limit.

Notes: React Router's Workers rendering needed a custom `app/entry.server.tsx`. `requireMcpAuth` from `@better-auth/mcp` is not used because it fetches signing keys from the Worker's own URL, which a Worker cannot do; `server/mcp/endpoint.ts` verifies tokens with in-process keys instead.

### M1 — Design direction

- Static mockups of the catalog, recipe detail (with and without photo), editor, and approval queue, at phone and desktop sizes, with representative sample recipes.

**Done when:** the owner approves a direction (AC-021). Styling is not applied app-wide before approval.

### M2 — Core catalog

- Public browsing, FTS5 search, filters by tag and collection, recipe detail with schema.org Recipe markup, noindex.
- Admin editor for recipes and ideas (title-only ideas allowed), links, tags, collections.
- Soft delete (inactive records) and a recovery view.
- Server-side authorization on every write.

**Done when:** AC-001, 003, 005 (excluding photos), 009, 022, 023, 026, 027, 037, 062–065, 068, 069 pass.

### M3 — Photos, history, backup

- Camera capture and upload with browser-side resize/re-encode; R2 storage via S3 API; multiple ordered photos with captions.
- Immutable revisions with author, restore-as-new-revision, experiment notes, version comparison.
- Browser-assembled full backup download and chunked restore.

**Done when:** AC-006, 041, 044, 050–053, 058, 061 pass, including a restore into a fresh instance; backup/restore procedure documented; no request exceeds free-plan CPU limits.

### M4 — External tools and approval

- Change-submission engine: queue, approval toggle (default on), proposed-vs-current diff, approve/reject, stale-revision conflicts, retry identifiers.
- HTTP API and MCP tools over the same core operations; connector setup docs; credential revocation.

**Done when:** AC-011–014, 024, 025, 029–032, 059, 070 pass, verified with a non-Claude test client and live from ChatGPT and Claude.ai.

### M5 — In-app AI

- Paste import from old chats, link import (JSON-LD first, Claude fallback), image import.
- Ingredient identification from photos, typed descriptions, or both, on new and existing recipes.
- Free duplicate matching on add/import; "Check with AI" button.
- Clear failure handling that preserves form content.

**Done when:** AC-007, 008, 010, 033, 036, 045–049, 057, 066, 067 pass, plus one live smoke test against Claude.

### M6 — Cooking and Lose It!

- Serving adjustment (fractions, ranges, unscalable items flagged); cooking mode with Screen Wake Lock and an explanation when unsupported.
- "Want to try", "made", and "favorite" markers.
- "Copy for Lose It!" — only if the owner's Text Importer test (D13) passed.

**Done when:** AC-054–056, 060 pass; Lose It! results from the owner's iPhone test documented (or the feature is recorded as dropped).

### M7 — Recommendations and preferences

- "Ask AI" with ranked saved recipes and web discoveries (Claude web search/fetch), labeled with sources and short reasons.
- Preference profile with evidence, on-request refresh, corrections that persist across refreshes.

**Done when:** AC-015–017, 034, 035 pass.

### M8 — Verification and handoff

- Acceptance-criteria report with plain limitations.
- Real-device checklist run by the owner on the D11 browsers (AC-043, camera and wake-lock behavior).
- Alternative host verified with Node + SQLite on a disposable deployment; data moved using the backup file.
- Documentation: deployment, connector setup and revocation, approval and preferences, backup/restore, costs, provider dependencies (D1, R2, Workers) with replacement steps.

**Done when:** AC-018–021, 038–043 are addressed and every AC has a recorded result.

## Expected running costs

- Cloudflare Workers, D1, R2: $0 within free-plan limits (R2 may need a payment method on file).
- Claude API: usage-based, estimated cents per import, identification, or recommendation; confirmed in M8.
- Domain renewal: separate, existing cost.

## Pre-M6 owner task

Run the Lose It! Text Importer test on iPhone: paste a multi-line ingredient list (for example, `2 cups jasmine rice`, `1 lb chicken thighs`, `1 tbsp fish sauce`) and note whether all lines become ingredients in one paste.
