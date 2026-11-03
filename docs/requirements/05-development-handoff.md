# Development handoff

## Instructions for the implementing agent

Read all files in this package before implementing. Preserve the distinction between confirmed requirements and proposed defaults. Do not describe proposed choices as owner-approved.

Prioritize the core problem: the owner’s recipes are scattered across AI sessions and chats. Deliver a reliable central recipe collection with convenient capture, updates, search, and cross-device reading first. External AI submission and approval directly support this purpose. Web discovery and learned recommendations remain in scope but are secondary; they must not dominate the interface or delay validating the core save-and-retrieve journey.

Ask one focused question at a time when an unresolved decision blocks implementation. Resolve routine reversible design choices with reasonable defaults and document them. Do not purchase services or publish private content without appropriate authorization.

Budget is not a planning constraint. Do not reduce the agreed scope on cost grounds or ask for a budget before planning. Document expected operating costs for visibility; this does not authorize purchases.

## Resolved decisions (2026-11-03)

The open decisions below were resolved with the owner. Full details, decision IDs, and the approved stack are in the [implementation plan](../implementation-plan.md).

1. **Integration:** ChatGPT and Claude.ai via a remote MCP server with OAuth, plus a documented HTTP API over the same operations. Not restricted to Claude.
2. **Stack:** TypeScript, React Router v7, Drizzle, Better Auth, the official MCP SDK, and the Anthropic SDK (see plan).
3. **Hosting:** Cloudflare Workers free plan at cookbook.chrisandelissa.com, with Cloudflare D1 and R2 behind adapters. The alternative host is Node with SQLite.
4. **Claude:** `claude-opus-5-5` (configurable), with Claude's server-side web search and web fetch tools.
5. **Google identity:** one or two admin accounts share owner access, enforced by a server-side allow-list. Only admins can invoke paid AI.
6. **Approval scope:** the toggle applies to external tool submissions only; for in-app AI, the owner's Save is the approval.
7. **Preferences:** refresh on request and apply immediately; correctable at any time.
8. **Retention and backups:** deleted records stay inactive indefinitely; history is kept indefinitely; backups are manual download and restore.
9. **Migration:** one recipe at a time; no bulk migration.
10. **Browsers:** iPhone Safari, Chrome on iPhone, the Home Screen web app, and Android. Image formats are browser-normalized JPEG/WebP (details in M3).
11. **Visibility:** everything readable is public; credentials, settings, inactive records, and pending or rejected submissions are private.
12. **Indexing:** no search-engine indexing.

Metric/US conversion and optional spending limits must not be silently added to scope.

Do not build recipe drafts or a publishing workflow. Saved entries are public immediately. Retain the separate AI approval queue and preserve unsaved form content on errors.

## Design expectations

Functionality comes first, but visual quality is part of the requested scope. Establish a coherent, distinctive design direction early using representative recipe content and phone/desktop mockups. Seek feedback on that direction before applying it throughout the application. A personal cookbook direction is proposed, not approved. Avoid treating an unmodified starter template or component library as the finished design. Use accessible, reliable components where useful and customize their presentation into a cohesive experience.

## Proposed development sequence

Superseded by the milestones (M0–M8) in the [implementation plan](../implementation-plan.md). The original sequence is kept below for reference.

1. Select a portable stack for the confirmed mobile-friendly website; resolve integration protocols, hosting constraints, and Claude model/web retrieval choices.
2. Build public browsing, Google-protected owner access, server-side AI authorization, persistent catalog storage, recipe/idea editing, pasted-text import, uploads, search, tags, collections, version history, deletion recovery, and backups.
3. Build the shared change-submission and approval flow, including the setting and conflict handling.
4. Add the authenticated external AI integration and verify it with a client independent of Claude.
5. Add phone-camera capture, recipe photo uploads, extraction from links and images, and AI ingredient identification using the shared change flow.
6. Add serving adjustment, cooking mode, personal feedback, and duplicate suggestions.
7. Add saved-recipe recommendations, web discovery, preference learning, and preference correction.
8. Verify acceptance criteria, cross-device layouts, access controls, and recovery procedures.

## Lose It! feasibility work

Read [Lose It! integration](06-lose-it-integration.md). Validate a supported recipe-transfer path early. Start with the documented text-import workflow; investigate direct sending without promising unsupported capabilities. Include membership requirements and actual test results in the handoff.

## Expected implementation handoff

- Working application and source code.
- Setup and deployment instructions, with required configuration documented without secrets.
- Provider-neutral integration documentation for connecting compatible AI tools and revoking access.
- Explanation of approval settings and learned preferences.
- Test results tied to acceptance criteria, with limitations stated plainly.
- Documented ongoing service costs or estimates and backup/recovery procedure.
- Cloudflare deployment instructions, a documented and tested alternative hosting path, and data/media migration instructions.
- A list of remaining provider-specific dependencies and their replacement options.
