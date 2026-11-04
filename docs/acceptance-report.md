# Acceptance report (M8)

A recorded result for every acceptance criterion in [04-acceptance-criteria.md](requirements/04-acceptance-criteria.md), as of 2026-11-04 (code on `main` through PR #26, plus this M8 branch).

## How to read it

| Result | Meaning |
| --- | --- |
| **Pass** | Checked, and it works. The "How checked" column says how. |
| **Partial** | Part is checked; the rest is named under "Not yet". |
| **Owner check** | Can only be done by the owner (a real phone, a real AI app, or a paid call). Steps are in [device-checklist.md](device-checklist.md) or listed below. |

Kinds of evidence:

- **Unit/server**: `npm run check` (Vitest, in-memory SQLite, a fake AI that records every call; no network).
- **Browser**: `npm run test:e2e` (Playwright on the Node build: Chromium and WebKit at phone 390 px, tablet 768 px and desktop 1280 px; a local mock stands in for the Claude API).
- **Workers**: the Cloudflare build run locally in workerd with local D1 and R2.
- **Production**: checked on cookbook.chrisandelissa.com.
- **Docker**: `npm run verify:docker` (new in M8): the real Docker image, two containers, data moved with the backup file.

**Big limitation:** no real Claude call has been recorded for AI search (AI and Web) or AI help. All of their tests use a fake or a mock. Their behavior with the real model, their cost and their timing are not yet verified (see [costs.md](costs.md)).

## Results

### Confirmed requirements

| AC | Result | How checked | Not yet |
| --- | --- | --- | --- |
| AC-001 | Pass | Browser: signed-out browsing, search, reading. Production: Google sign-in (M0) | |
| AC-002 | Pass | Online-only by design. No offline mode was built; none is required | |
| AC-003 | Pass | Browser: every main page at 390, 768 and 1280 px, Chromium and WebKit. Owner used the live site on iPhone (2026-11-04) | Android not yet tried by the owner (device checklist §1) |
| AC-004 | Pass | Lint rule keeps `server/core` free of Cloudflare and provider code; D1/R2 only behind adapters; same app runs on Node + SQLite (Docker). Remaining dependencies listed in [deployment.md § Provider dependencies](deployment.md#provider-dependencies) | |
| AC-005 | Pass | Browser + server: manual recipe, title-only idea, link, photo and screenshot saved through the editor | |
| AC-006 | Partial | Browser: uploaded photo shown on the recipe, in the catalog and to a separate signed-out browser | Taking a picture with a real phone camera: owner check (§2) |
| AC-007 | Pass | Server + browser (mock): ingredient identification from a photo, a description, and both, on new and existing recipes | Real Claude: part of M5 smoke test (see AC-010) |
| AC-008 | Pass | Server + browser: schema.org link import without AI; Claude fallback (mock) for pages without recipe data; photo/screenshot import (mock) | Real Claude: see AC-010 |
| AC-009 | Pass | Server + browser: full-text search, tags, collections, filters | |
| AC-010 | Pass | Server + Workers: in-app AI runs through the Anthropic SDK with `claude-opus-5-5`. `tests/live` covers paste import, "no recipe", ingredient identification and comparison | Whether the M5 live smoke test was run is not recorded. Owner check: `npm run smoke:ai` (costs money) |
| AC-011 | Partial | Server: new recipes and updates over MCP (real OAuth token) and the HTTP API (API key), with plain HTTP, no Claude client. Production: Claude.ai and ChatGPT connected through OAuth (M0) | Owner check: ask ChatGPT and Claude.ai each to save one recipe and propose one change, then approve in Review |
| AC-012 | Pass | Server + browser: with approval on, nothing changes until approved | |
| AC-013 | Pass | Server + browser: approve applies; reject changes nothing | |
| AC-014 | Pass | Server + browser: approval off saves immediately; on again queues | |
| AC-015 | Pass (as changed by D19/D21/D22) | Server + browser (mock): AI writes new recipes; Web finds new pages with sources; More adds results. Saved-recipe matching is the normal search, by owner decision (D19) | Real Claude with web search: owner check (paid; see [costs.md](costs.md)) |
| AC-016 | Pass | Server + browser (mock): refresh infers preferences with the recipes behind each | Real Claude: not run |
| AC-017 | Pass | Server + browser: confirm, correct, reject, add; the next AI search sends the corrections | |

### Design review (AC-018–021)

| AC | Result | How checked | Not yet |
| --- | --- | --- | --- |
| AC-018 | Pass | M1: mockups of the catalog, recipe (with and without photo), editor, Review queue and connector consent, at phone and desktop sizes (`design/m1/`), reviewed by the owner. Built screens checked at three widths in the browser tests, with no horizontal scroll and no serious accessibility issues | Owner's own look on Android (device checklist §1) |
| AC-019 | Pass | M1 mockups show populated, empty, loading and error states, with and without photos. Built app: empty catalog message, "Writing new recipes…" / "Searching the web…" progress text, a site-wide error page, and recipes with and without photos (browser tests) | |
| AC-020 | Pass | Browser tests walk the main jobs through the real UI: add, import, search, read, edit, review. Owner has used the live site daily since 2026-11-03 and asked for layout changes (E2–E4), which were built | |
| AC-021 | Pass | Owner approved direction A · Kitchen Notebook with dark mode (M1, D17) | |

### Quality checks

| AC | Result | How checked |
| --- | --- | --- |
| AC-022 | Pass | Browser: a saved recipe is readable from a separate signed-out browser; MCP/API submissions are readable once applied |
| AC-023 | Pass | Browser: catalog is the home page; search in the header; Add (floating +) and Import for admins |
| AC-024 | Pass | Browser: plain HTTP client with an API key submits; admin approves |
| AC-025 | Pass | Server: every submission scenario runs over both MCP and HTTP |
| AC-026 | Pass | Browser: no horizontal page scroll on add, read, search and review pages at three widths |
| AC-027 | Pass | Browser + server: signed-out visitors read recipes and photos; no edit or AI controls; AI routes refuse with 401 |
| AC-028 | Pass | Server tests, by area: deleted entries 404 publicly; pending/rejected submissions not public (AC-070); Settings actions and API keys admin-only; unsaved photos admin-only; backups admin-only (also Docker: signed-out `/api/backup` is 401). No single sweep of every endpoint exists |
| AC-028a | Pass | Server: every response has `X-Robots-Tag: noindex, nofollow`. Docker: `robots.txt` disallows everything |
| AC-029 | Pass | Server: no tool route approves or changes settings; tool credentials never count as an admin |
| AC-030 | Pass | Server: same idempotency key returns the original result |
| AC-031 | Pass | Server + browser: stale revision gives a conflict; approval after an owner edit gives a conflict |
| AC-032 | Pass | Server: turning approval off leaves waiting items waiting |
| AC-033 | Pass | Server + browser (mock): each failure has a plain message; nothing is filled in or saved |
| AC-034 | Pass | Server + browser (mock): web results labeled "From the web" with source link; links not returned by the search are dropped; AI-written ones labeled "Written by AI · untested" |
| AC-035 | Pass | Server: rejected inferences never come back on refresh |
| AC-036 | Pass | Server + browser: without an API key, AI says it isn't set up; everything else works (the second browser-test instance runs with no key) |
| AC-037 | Pass | Browser: axe-core finds no serious or critical issues (WCAG 2.1 AA) on public and admin pages, light and dark; keyboard reachable; labelled fields |

### Portability (AC-038–042)

| AC | Result | How checked | Not yet |
| --- | --- | --- | --- |
| AC-038 | Pass | ESLint fails the build if `server/core` imports Cloudflare, React Router, Drizzle/SQLite, Better Auth, the Anthropic or MCP SDKs, `node:*`, adapters or hosting. D1 and R2 are reached only through `server/adapters/` and `MediaStore`. The same code runs on Workers and on Node (Docker) | |
| AC-039 | Pass | [deployment.md](deployment.md): Cloudflare setup, custom domain, Workers Builds, and the Node/Docker path | |
| AC-040 | Partial | M0 + M8: Docker image builds and runs. M8 `npm run verify:docker`: two containers from the real image, health, public pages with noindex, search, signed-out refusals, and a full backup move (below) | A **disposable cloud deployment** (e.g. Fly.io or Render) was not created: it needs an account and possibly a card, so it waits for the owner's OK |
| AC-041 | Partial | Server, browser and Docker: backup from one instance restored into a fresh one with identical data: IDs, versions, notes, deleted entries, tags, collections, photo files and records (with credits), markers and the preference profile with corrections. Docker compares every backed-up table row by row and the photo bytes; a repeated restore resumes without duplicates | **Pending submissions are not in the backup**, nor the approval setting, API keys or AI-app connections. After a restore, re-submit anything that was waiting and set approval again. See [backup-restore.md](backup-restore.md) |
| AC-042 | Pass | [deployment.md § Provider dependencies](deployment.md#provider-dependencies): each provider, what depends on it, and how to replace it | |

### Photos and ingredient identification

| AC | Result | How checked | Not yet |
| --- | --- | --- | --- |
| AC-043 | Partial | Browser: "Take photo" input opens the camera (`capture="environment"`); "Upload photos" works without a camera; unreadable files get a message | Owner check on all four D11 browsers, including camera denied (device checklist §2) |
| AC-044 | Pass | Browser + server: adding a photo makes no AI call | |
| AC-045 | Pass | Server + browser (mock): photo alone, description alone, both; unsure suggestions marked and unchecked | |
| AC-046 | Pass | Server: suggestions are names only; added rows have blank amounts | |
| AC-047 | Pass | Browser: suggestions only append rows in the editor; nothing saves until Save | |
| AC-048 | Pass | Browser: failed uploads, imports and identification keep the form as it was | |

### Additional features

| AC | Result | How checked | Not yet |
| --- | --- | --- | --- |
| AC-049 | Pass | Browser (mock): pasted chat recipe reviewed, saved, found by search | |
| AC-050 | Pass | Server + browser: every save is a version; restore earlier versions | |
| AC-051 | Pass | Browser: dated experiment notes | |
| AC-052 | Pass | Browser + server: deleted recipes restore; an applied AI update is reversed through history; deleted rows stay in the database | |
| AC-053 | Pass | Browser + Docker: downloaded backup restored into a fresh instance. Limits in [backup-restore.md](backup-restore.md) | |
| AC-054 | Pass | Browser: servings change amounts; reload shows originals; stored recipe unchanged | |
| AC-055 | Partial | Browser: Wake Lock requested, released, re-requested; explanation when unsupported or refused. Owner tested M6 on a real iPhone on 2026-11-04 and it worked | Chrome on iPhone, the Home Screen app and Android (device checklist §3) |
| AC-056 | Pass | Server + browser: favorite, want to try and made persist and feed AI search and preferences | |
| AC-057 | Pass | Server + browser: free duplicate matching; "Check with AI" only when pressed; no automatic merges | |

### Edge cases, sign-in, publishing, appearance

| AC | Result | How checked |
| --- | --- | --- |
| AC-058 | Pass | Server + browser: restore makes a new version, keeps history, conflicts on stale page |
| AC-059 | Pass | Server: rejected submissions leave no version |
| AC-060 | Pass | Unit + browser: fractions, ranges, words, missing yield; steps and times unchanged |
| AC-061 | Pass | Server + Docker: IDs, history, photo links, markers and preference corrections survive a restore |
| AC-062 | Pass | Production: real Google sign-in as an admin (M0) |
| AC-063 | Pass | Unit: accounts outside `ADMIN_EMAILS` get no owner rights (case-insensitive); server: non-admin writes get 403 |
| AC-064 | Pass | Server: signed-out writes 401, non-admin 403, nothing changes |
| AC-065 | Pass | Browser: browsing needs no sign-in |
| AC-066 | Pass | Server: every AI route refuses signed-out requests before any fetch or Claude call (the fake records zero calls), including AI search, AI help and Find a photo |
| AC-067 | Pass | Server: non-admins get 403 before any AI call; public browsing and search make no AI calls |
| AC-068 | Pass | Browser: saved entries are public at once |
| AC-069 | Pass | No draft state exists |
| AC-070 | Pass | Server + browser: pending submissions are not public; applied ones are |
| AC-071 | Pass | Browser: System / Light / Dark, saved in a cookie |
| AC-072 | Pass | Browser: axe passes in both themes; server renders the theme, so no flash |

## Summary

- **Pass:** 67 of 73 (AC-001 to AC-072, plus AC-028a). AC-015 counts as Pass because the built behavior matches the owner's changed decision (D19/D21/D22), but its real-Claude check is still open.
- **Partial:** 6: AC-006, AC-011, AC-040, AC-041, AC-043, AC-055.
- **Owner checks still open:** real phones (AC-006, AC-043, AC-055 and layout), live ChatGPT and Claude.ai submissions (AC-011), a paid live AI test (AC-010, AC-015, AC-016, E5), and a disposable cloud host (AC-040).

## Open items carried from earlier milestones

| From | Item | Who |
| --- | --- | --- |
| M0 | Call a tool from each connector (now the M4 tools, not `ping`) | Owner (same as AC-011) |
| M0 | Actually perform a D1 Time Travel restore (optional; restoring to the current bookmark loses nothing) | Owner |
| M0 | Deploy the Docker image to a disposable alternative host | Needs owner OK (AC-040) |
| M5 | Run the live smoke test and one real paste, link and photo import | Owner (costs a few cents) |
| M7/E5 | Confirm AI search and AI help cost and timing with real calls | Owner OK needed; `npm run smoke:ai` now measures them |

## Enhancements after first release (E1–E5)

Not part of the acceptance criteria, but checked the same way:

| Item | Result | How checked |
| --- | --- | --- |
| E1 Find a photo | Pass (mocked searches) | `tests/server/e1.test.ts`, `tests/e2e/e1.spec.ts`. Real Pixabay/Brave keys: depends on the owner setting them |
| E2 Sign in from the top bar | Pass | Browser tests; in production |
| E3 Appearance in Settings | Pass | Browser tests; in production |
| E4 Backup and Deleted in Settings | Pass | Browser tests; in production |
| E5 AI help on a recipe | Pass (mock) | `tests/server/recipe-help.test.ts`, `tests/e2e/recipe-help.spec.ts`. Real Claude not yet run |

The status table in [07-enhancements.md](requirements/07-enhancements.md) still lists E1 as "In progress" and E2/E5 as "awaiting review"; all are merged on `main`.
