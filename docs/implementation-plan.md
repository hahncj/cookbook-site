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
| D9 | Preferences refresh **on request** (button) and **apply immediately**; the owner can view and correct them at any time. They only influence the "Ask AI for suggestions" feature (now AI mode in the search bar, D19). |
| D10 | **No search-engine indexing** (noindex + robots.txt). Pages still include schema.org Recipe markup, which Lose It! uses to import recipes from their web page. |
| D11 | Test on **iPhone Safari, Chrome on iPhone, Home Screen web app, and Android**. |
| D12 | Old-chat import is **one recipe at a time**. No bulk or chat-export import. |
| D13 | Lose It!: **no in-app Lose It! feature.** Updated 2026-11-04: the owner confirmed Lose It! can import a recipe from its web page, so the owner points Lose It! at the public recipe page. The "Copy for Lose It!" feature is dropped. Keep the schema.org Recipe markup on recipe pages (D10). |
| D14 | AI ingredient identification works on **new and existing** recipes. Suggestions never overwrite existing ingredients without review. |
| D15 | Database is **Cloudflare D1** (owner choice), accessed only through an adapter. D1 is a documented Cloudflare dependency. |
| D16 | Use the **Cloudflare Workers free plan**. If measured CPU time exceeds free-plan limits, moving to the paid plan is the owner's decision. **2026-11-03:** measured production CPU exceeds the 10 ms limit (medians 11–34 ms; see M0 status) with no failures observed; the owner chose to **stay on the free plan and watch for errors** (Cloudflare error 1102 / `exceededCpu`). Revisit if failures appear. |
| D17 | **Visual direction A · Kitchen Notebook** (approved 2026-11-03) with a **viewer-selectable theme**: System default (follows the device), Light, or Dark. Proposed: the choice is remembered on the device for any visitor. Mockups and palettes: [design/m1/](../design/m1/README.md). |
| D18 | The site is named **540 Kitchen** (2026-11-03), with the owner's logo (source: `design/brand/540-kitchen-logo.png`) in the header and as the browser, Home Screen and app icon. |
| D19 | **AI mode in the search bar** (2026-11-04): admins get an "AI" toggle on the search bar. With it on, Claude finds **new** recipes only (not ones already in the cookbook), using the preference profile and favorites as extra context. Results include web recipes (with sources) and recipes Claude **writes itself**, labeled "Written by AI · untested". For these written recipes only, the AI may propose amounts (an exception to "AI never invents quantities"). Any result is saved only through the editor and the owner's Save (D2). Replaces the separate "Ask AI" page. |
| D20 | **AI help on a recipe** (2026-11-04, E5): admins can ask Claude for swaps when an ingredient is missing, or to change a saved recipe. Swap amounts and changed recipes are AI suggestions, labeled so (a second narrow exception to "AI never invents quantities"). A swap can be kept as a note; a change opens the editor (a new version) or becomes a new recipe. Nothing is saved without the owner's Save (D2). |
| D21 | **AI or Web toggle** (2026-11-04, refines D19): the search bar has a small **AI | Web** toggle for admins. **AI** has Claude write 2–3 recipes in one quick request (no web). **Web** finds real pages with sources (never mixed with AI-written recipes). Neither selected is the normal cookbook search. Preferences and favorites are sent unless the request says to leave them out (e.g. "ignore my preferences"); there is no separate switch. |
| D22 | **Faster Web search and "More"** (2026-11-04): Web searches the web only (at most 3 searches, light thinking) and picks from the search results; it no longer reads pages, because "Save to cookbook" reads the page itself. The AI is told not to mention search limits. Both AI and Web results have a **More** button ("More ideas" / "More results") that asks again, leaving out what was already shown, and adds the new results below. |

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

#### M1 status (2026-11-03, branch `feature/m1-design-direction`)

- [x] Round 1: three directions (Kitchen Notebook, Market Bold, Night Kitchen), each with a phone catalog and recipe page, using shared sample content with photo, no-photo, and idea entries.
- [x] Owner chose A and added a viewer-selectable dark mode (D17).
- [x] Round 2 in direction A: dark catalog and recipe; recipe editor; AI review queue; connector consent page; desktop catalog with the theme menu; empty, loading, and error states.
- [x] **Owner approved the direction (AC-021).**

Sources are committed in `design/m1/` and viewable on the private design canvas. Photos are placeholders. M2 turns the palettes and type in `design/m1/README.md` into app styles.

### M2 — Core catalog

- Design system from the approved direction (D17): light and dark color tokens, Newsreader and Public Sans, and the System / Light / Dark preference, applied server-side from a cookie so pages never flash the wrong theme (AC-071, AC-072).
- Public browsing, FTS5 search, filters by tag and collection, recipe detail with schema.org Recipe markup, noindex.
- Admin editor for recipes and ideas (title-only ideas allowed), links, tags, collections.
- Soft delete (inactive records) and a recovery view.
- Server-side authorization on every write.

**Done when:** AC-001, 003, 005 (excluding photos), 009, 022, 023, 026, 027, 037, 062–065, 068, 069, 071, 072 pass.

#### M2 status (2026-11-03, branch `feature/m2-core-catalog`)

Verified by automated tests (`npm run check`: 64 unit/integration tests; `npm run test:e2e`: 37 browser checks in Chromium and WebKit at phone 390 px, tablet 768 px and desktop 1280 px):

| Check | How it was verified |
| --- | --- |
| AC-001, AC-065, AC-027 | Signed-out browser browses, searches and reads; no Edit/Add controls; admin sees them after sign-in |
| AC-003, AC-026 | No horizontal page scroll on catalog, search, recipe (including a very long title), idea, sign-in, editor, deleted-recipes pages at all three widths |
| AC-005 (no photos) | Recipes, title-only ideas and source links saved through the editor (photos and screenshots are M3) |
| AC-009 | Full-text search over title, description, notes and ingredients (prefix matching, injection-safe); filters by tag, collection and recipe/idea |
| AC-022, AC-068, AC-069 | A saved recipe is immediately readable from a separate signed-out browser; no draft state exists |
| AC-023 | The catalog is the public home page with search in the header; Add appears for admins |
| AC-037 | axe-core finds no serious or critical violations (WCAG 2.1 AA, including contrast) on public and admin pages; search reachable by keyboard; every field labelled |
| AC-062, AC-063 | Google sign-in verified in production (M0); non-admin sessions get 403 on every admin write |
| AC-064 | Signed-out writes return 401 and non-admin writes 403 for create, edit, delete and restore; nothing changes |
| AC-071, AC-072 | System follows the device; Light/Dark choice saved in a cookie and rendered by the server (the raw HTML carries the theme, so no flash); axe passes in dark |
| AC-031 (early) | A stale edit returns a conflict and keeps the typed values; the stored recipe and its tags are unchanged |
| AC-048 (early) | Validation errors keep everything typed |

Also verified against the Cloudflare build in local workerd with D1: create, full-text search, update (D1 batch), stale-update conflict, signed-out 401, delete (404 publicly) and restore.

Production checks after merge: apply migrations first (`npm run db:migrate:remote`, see deployment.md), then confirm pages, search and editing on cookbook.chrisandelissa.com, and watch CPU (D16).

Deferred by plan: photos (M3), version history (M3), markers and serving scaling (M6). Recipes without photos show an ingredient snippet, as in the approved mockups.

### M3 — Photos, history, backup

- Camera capture and upload with browser-side resize/re-encode; R2 storage via S3 API; multiple ordered photos with captions.
- Immutable revisions with author, restore-as-new-revision, experiment notes, version comparison.
- Browser-assembled full backup download and chunked restore.

**Done when:** AC-006, 041, 044, 050–053, 058, 061 pass, including a restore into a fresh instance; backup/restore procedure documented; no request exceeds free-plan CPU limits.

#### M3 status (2026-11-03, branch `feature/m3-photos-history-backup`)

Verified by automated tests (`npm run check`: 89 unit/integration tests; `npm run test:e2e`: 58 browser checks in Chromium and WebKit at 390, 768 and 1280 px, plus the backup test on desktop):

| Check | How it was verified |
| --- | --- |
| AC-006 | Admin uploads a photo in the editor; it shows on the recipe page, in the catalog thumbnail, and to a separate signed-out browser |
| AC-043 (partial) | The editor has a "Take photo" input that opens the phone camera (`capture="environment"`) and a separate "Upload photos" input that works without a camera. **Real-device camera checks on iPhone Safari, Chrome on iPhone, the Home Screen app and Android remain for the owner's device checklist (M8).** |
| AC-044 | Adding a photo triggers no AI; the editor says so |
| Location data | A JPEG carrying GPS/EXIF uploaded through the browser is stored with no EXIF or GPS; the server also strips EXIF/XMP/IPTC/comments from JPEG, PNG and WebP itself (unit-tested with handcrafted files) |
| AC-050, AC-051 | Every save creates a full version with author, time and optional "what changed" note; dated experiment notes on the recipe page (they don't create versions) |
| AC-052 | Deleted recipes restore (M2); an unwanted edit is reversed by restoring the earlier version |
| AC-058 | Restoring creates a new version, keeps every version in between, and refuses with a conflict if the recipe changed since the page loaded |
| AC-041, AC-053, AC-061 | A downloaded backup zip from one running instance restores into a second, empty instance: same IDs, history, notes, deleted entries, tags, collections, photos and search; restore refuses on a non-empty cookbook and resumes safely if interrupted |
| AC-048 | A file the browser can't read shows a clear message; the form keeps its content |

Also verified against the Cloudflare build in local workerd with D1 and R2: the new migrations and history backfill, photo upload and serving (unsaved photos admin-only, saved photos public, GPS stripped), versions inside D1 batches, a stale edit adding no version, restore, backup export, and restore refusal on a non-empty cookbook.

Procedure and limits: [backup-restore.md](backup-restore.md). Photos are resized in the browser and the backup zip is built in the browser, so no request does image or archive work on the server. The free-plan CPU limit was already exceeded by normal pages (D16); photo serving adds one small database lookup per image.

Production after merge: `npm run deploy:ci` applies migrations 0003 and 0004 automatically (existing recipes get a first history version).

### M4 — External tools and approval

- Change-submission engine: queue, approval toggle (default on), proposed-vs-current diff, approve/reject, stale-revision conflicts, retry identifiers.
- HTTP API and MCP tools over the same core operations; connector setup docs; credential revocation.

**Done when:** AC-011–014, 024, 025, 029–032, 059, 070 pass, verified with a non-Claude test client and live from ChatGPT and Claude.ai.

#### M4 status (2026-11-03, branch `feature/m4-connector-submissions`)

Verified by automated tests (`npm run check`: 116 unit/integration tests; `npm run test:e2e`: 67 browser checks). Every submission rule runs twice: over MCP with a real OAuth connector token and over the HTTP API with an API key.

| Check | How it was verified |
| --- | --- |
| AC-011 | New recipes and partial updates submitted over MCP and over the HTTP API; reads return the current revision for round-tripping |
| AC-012, AC-070 | With approval on (default), nothing changes in the catalog, search or public pages until approval; the waiting count is shown to admins only |
| AC-013, AC-059 | Approve applies the reviewed change (history shows "Changed by an AI tool" with the tool's note); reject changes nothing and records no version |
| AC-014, AC-032 | Approval off saves valid submissions immediately (HTTP 201); waiting items stay waiting; turning it back on queues again |
| AC-024 | Browser test submits with a plain HTTP client using an API key created on the Settings page, then approves in Review |
| AC-025 | The same scenarios pass identically over MCP and HTTP |
| AC-029 | No tool or API route can approve or change settings; tool credentials never count as an admin sign-in; tools only see their own submissions |
| AC-030 | Retrying with the same idempotency key returns the original result; one recipe |
| AC-031 | An update against an old revision returns a conflict with the current revision and stores nothing; an update approved after the owner edited becomes a conflict, not an overwrite |
| Revocation | Disconnected apps' tokens, revoked API keys and keys belonging to former admins are refused |

Also verified against the Cloudflare build in local workerd with D1: migration 0005, MCP tool list and submission, idempotent retry, HTTP submission, pending not public, approval from Review, applied status, stale-update 409, API key revocation.

**Remaining for the owner after deploying:** reconnect or refresh the Claude.ai and ChatGPT connectors so they load the new tools, then ask each to save a recipe from a conversation and approve it in Review (the "live from ChatGPT and Claude.ai" part of the completion criteria).

### M5 — In-app AI

- Paste import from old chats, link import (JSON-LD first, Claude fallback), image import.
- Ingredient identification from photos, typed descriptions, or both, on new and existing recipes.
- Free duplicate matching on add/import; "Check with AI" button.
- Clear failure handling that preserves form content.

**Done when:** AC-007, 008, 010, 033, 036, 045–049, 057, 066, 067 pass, plus one live smoke test against Claude.

#### M5 status (2026-11-03, branch `feature/m5-in-app-ai`)

Verified by automated tests (`npm run check`: 148 unit/integration tests; `npm run test:e2e`: 95 browser checks across phone, tablet and desktop). Server tests use a fake AI that records every call. Browser tests run the real Claude adapter against a local mock of the Messages API.

| Check | How it was verified |
| --- | --- |
| AC-007, AC-045 | Ingredient identification works with a description alone, a photo alone (upload or a saved photo), and both, on new and existing recipes |
| AC-046 | Suggestions are names only. Added rows have blank amounts. Imports keep amounts as written and leave missing ones blank |
| AC-047 | Suggestions are editable and unsure ones are marked and unchecked. "Add chosen" only appends rows; other fields and existing rows are untouched. Nothing is saved until the owner presses Save |
| AC-008 | Link import reads schema.org recipe data without AI and falls back to Claude on the page text. Photo import reads a recipe card or screenshot |
| AC-010 | In-app AI uses Claude (`claude-opus-5-5`, structured output, refusal fallbacks on) through the Anthropic SDK |
| AC-033 | "No recipe found", unreachable pages, blocked sites, non-images and AI errors each get a plain message; nothing is filled in or saved |
| AC-036 | Without an API key, AI features say they aren't set up. Saved recipes, manual editing and link import with recipe data still work |
| AC-048 | Failed imports keep the pasted text or link. Failed identification leaves the form exactly as it was |
| AC-049 | A pasted chat recipe is reviewed in the editor, saved with origin "paste", and found by search |
| AC-057 | Free word-overlap matching flags possible duplicates on new recipes, imports and AI-tool submissions in Review. "Check with AI" runs only when pressed. Nothing is merged or deleted |
| AC-066, AC-067 | Signed-out (401) and non-admin (403) requests to every AI route are refused before any fetch or Claude call (the fake records zero calls). Public browsing and search make no AI calls |

Also verified against the Cloudflare build in local workerd: the Anthropic SDK loads and runs in the Worker, an admin paste import and ingredient identification complete against the mock, and AI routes refuse signed-out requests.

Link fetching is SSRF-safe: http(s) only, standard ports, no private, local or credentialed addresses, every redirect re-checked, 3 MB and 15-second limits.

**Remaining for the owner:** set `ANTHROPIC_API_KEY` (production secret, plus `hosting/cloudflare/.dev.vars` locally), then run the live smoke test (`ANTHROPIC_API_KEY=... npm run smoke:ai`) and try one real paste, link and photo import on the site.

### M6 — Cooking

- Serving adjustment (fractions, ranges, unscalable items flagged); cooking mode with Screen Wake Lock and an explanation when unsupported.
- "Want to try", "made", and "favorite" markers.

**Done when:** AC-054–056, 060 pass.

#### M6 status (2026-11-04, branch `feature/m6-cooking-mode`)

Verified by automated tests (`npm run check`: 199 unit/integration tests; `npm run test:e2e`: 179 browser checks across phone (Chromium and WebKit), tablet and desktop). Lose It! work was dropped from M6 (D13); the schema.org Recipe markup is unchanged and still carries the original amounts.

| Check | How it was verified |
| --- | --- |
| AC-054 | A servings stepper (from the recipe's yield) scales ingredient amounts in the browser. Reloading shows the original amounts, the stored recipe and its schema.org markup never change, and the page says so |
| AC-060 | Unit tests and browser checks: fractions (1/2, 1 1/2, ½, 1⅓), decimals and ranges (2-3, 1 to 2) scale, keeping units and words as written. Blank amounts, words ("to taste", "a pinch") and amounts with more than one number ("1 cup plus 2 tbsp", "2 (14 oz) cans") stay as written and are flagged. A missing, ranged or wordy yield is never guessed: the page offers ×½ to ×3 instead. Times, temperatures and amounts in the steps are not changed, and a note says so |
| AC-055 | Cooking mode asks for a Screen Wake Lock when opened, releases it when closed (Done or Escape), and asks again after the page comes back into view. When the browser has no Wake Lock it explains that the screen may dim and how to raise Auto-Lock; when the request is refused it says so and offers "Keep screen on". Browser tests replace the Wake Lock API to check each case. **Real-device checks on iPhone Safari, the Home Screen app, Chrome on iPhone and Android remain for the owner's device checklist (M8).** |
| AC-056 | "Favorite", "Want to try" and "Made" persist (new tables `recipe_markers` and `recipe_made`, migration 0007). Favorite is independent of cooking status; recording "made" clears "want to try" but never sets favorite. Each "made" is dated, so counts and recency are kept. `services.markers.signals()` returns this evidence for active recipes for M7's recommendations. Markers are public to read (D3); only admins change them (401 signed out, 403 non-admin). Changing one never creates a recipe version |
| AC-061 (feedback) | Backups include both marker tables; a backup restores them into a fresh cookbook, and older backups without them still restore |

Proposed defaults (not owner decisions): recording "made" clears "want to try"; the cooking-mode button sits above the ingredients instead of in a sticky bottom bar (that bar would cover the floating Add button from E2); the chosen servings are kept only while the page is open.

Also verified: the Cloudflare build compiles, and all migrations through 0007 apply in order to a local D1 database.

Production after merge: `npm run deploy:ci` applies migration 0007. Then check it with the read-only command in AGENTS.md (it should say "No migrations to apply").

**Real device (2026-11-04):** the owner tested M6 successfully on a real iPhone.

### M7 — Recommendations and preferences

- "Ask AI" with ranked saved recipes and web discoveries (Claude web search/fetch), labeled with sources and short reasons. **Changed by D19:** AI mode in the search bar finds new recipes only (web and AI-written).
- Preference profile with evidence, on-request refresh, corrections that persist across refreshes.

**Done when:** AC-015–017, 034, 035 pass.

#### M7 status (2026-11-04, branch `feature/m7-recommendations`)

Verified by automated tests (`npm run check`: 216 unit/integration tests; `npm run test:e2e`: 191 browser checks across phone (Chromium and WebKit), tablet and desktop). Server tests use a fake AI that records every call. Browser tests run the real Claude adapter against the local mock of the Messages API, including web search results, a fetched page and a paused turn.

| Check | How it was verified |
| --- | --- |
| AC-015 | **AI mode in the search bar** (admins only, D19, D21): with "AI" on, the owner picks **AI** (Claude writes up to 3 recipes in one request) or **Web** (up to 4 web recipes picked from web search results, at most 3 searches, D22). **More** adds further results, leaving out what was shown. The profile and favorite or often-made titles are added as context unless the request says "ignore my preferences" (or similar). The cookbook's titles are always sent so results are new. Each result has a one-sentence reason. Saved-recipe matching is left to the normal search (AI off) |
| AC-034 | Web results are labeled "From the web", link to their source page (new tab) and name the site. A link must be one the web search actually returned in that request; made-up links are dropped and the page says how many. A page already saved shows "Already in your cookbook". AI-written recipes are labeled "Written by AI · untested" and have no source link |
| D2 | Nothing is saved from the results. "Save to cookbook…" opens link import with the address filled in (web) or the editor filled with the recipe (written, origin "ai", source "Written by AI (Claude)"); the owner reviews and presses Save |
| AC-016 | "Refresh from my recipes" on Preferences (`/preferences`) asks Claude for patterns in the catalog and markers. Each suggestion lists the recipes behind it (links). Suggestions without real evidence, and any about allergies, intolerances or medical or dietary restrictions, are dropped. With fewer than 8 recipes the profile says it is a rough guess. The profile changes only when refreshed (D9) |
| AC-017 | The owner can mark a suggestion right, correct its wording, reject it ("Not true"), delete their own, or add their own. Corrections are used by the next AI-mode search: confirmed and own items as firm preferences, unreviewed suggestions as hints, rejected ones as "not true" |
| AC-035 | A refresh replaces only unreviewed suggestions. Rejected and corrected inferences are kept with the AI's original wording, sent to Claude as "don't suggest", and any new inference that says the same thing is dropped. "Allow again" forgets a rejection |
| AC-066, AC-067 | Signed-out (401) and non-admin (403) requests to AI mode (`/discover`), to opening an AI-written recipe in the editor, and to every Preferences change are refused before any Claude call (the fake records zero calls). Visitors and non-admins don't see the AI toggle. The profile itself is public to read (D3) |
| AC-036 | Without an API key AI mode and Preferences say AI isn't set up; normal search is unchanged |
| AC-061 (preferences) | Backups include the new `preferences` and `preference_refreshes` tables (migration 0008) and restore them; older backups without them still restore |

Proposed defaults (not owner decisions): a Web search uses at most 3 searches and suggests up to 4 pages; an AI search asks for 2–3 recipes; "More" sends at most 40 already-shown results; the request is temporary (anything permanent goes on Preferences); AI mode turns off when you leave the results page; the profile page shows rejected items under "Not true" (the profile is public, D3); for a profile refresh, recipes sent to Claude are capped at 300 (marked ones first, then newest), with ingredient names but no amounts, notes or photos; AI mode sends only titles, not recipe contents.

Expected cost per request (Claude Opus 5.5 at $4 / $20 per million input / output tokens, web search $10 per 1,000 searches): for a catalog of around 100 recipes (about 7,000 input tokens), a profile refresh is estimated at 5–10 cents, mostly output and thinking tokens. An **AI** search is one request, estimated at 5–10 cents. A **Web** search is estimated at 10–20 cents (at most 3 searches at 1 cent each, plus reading the results); each **More** costs about the same again. These are estimates, not measurements; confirm them against real usage in M8 (the Anthropic Console shows the cost per request).

Also verified: the Cloudflare build compiles, and all migrations through 0008 apply in order to a local D1 database. Not verified: a real Claude request with web search (the live smoke test costs money and was not run).

Production after merge: `npm run deploy:ci` applies migration 0008. Then check it from an up-to-date `main` with the read-only command in AGENTS.md.

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
