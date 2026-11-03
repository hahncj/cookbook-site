# Data and AI integration

This file records the confirmed AI architecture and proposes technical behavior. Claude is the selected backend AI provider. The stack and Claude model are recorded in the [implementation plan](../implementation-plan.md).

## Backend AI — Confirmed

The backend connects to Claude for in-app AI features. This provider choice must not restrict which external AI tools can create or update recipes.

**Proposed:** Keep Claude credentials on the server. Select the model and web retrieval approach during implementation.

## Catalog entry — Proposed

Each entry has a stable ID, owner ID, title, entry type (recipe or idea), creation/update dates, and a revision number.

Optional information includes:

- Description and free-form notes.
- Ingredients, preserving original quantity and unit text.
- Ordered preparation steps.
- Servings or yield; preparation and cooking times when known.
- Photos and screenshots, including phone-camera captures attached to the recipe.
- **Proposed:** Image ordering and optional captions; ingredient suggestions with their source image and uncertainty.
- Source URL, source name, and origin (manual, web import, image import, or AI tool).
- Tags and collection memberships.

Do not require complete recipe fields for an idea. Do not silently fill in missing quantities, times, or instructions.

## Other records — Proposed

| Record | Information |
| --- | --- |
| Collection | ID, owner, name, optional description |
| Tag | ID, owner, name |
| Preference | Inference or owner correction, supporting entry IDs, uncertainty, review status |
| Change submission | ID, requesting tool, target entry if updating, base revision, proposed changes, status, dates |
| Integration credential | Owner, permitted actions, revocation status; secrets stored securely |
| Settings | AI approval required, default true |

## External integration — Confirmed outcome, proposed contract

Any authorized external AI tool capable of using the published interface can submit additions and updates. Do not require callers to use Claude or a particular AI vendor. Compatibility depends on the external tool supporting the chosen protocol and authentication; universal plug-and-play compatibility is not assumed.

**Confirmed (2026-11-03):** The owner's external tools are ChatGPT and Claude.ai, which require a remote MCP server with OAuth sign-in. Provide that MCP server and a documented authenticated HTTP API over the same application operations. Both interfaces must use the same validation, approval setting, and change-submission workflow. Document connection instructions, request/response examples, and authentication requirements.

Suggested operations:

- Search or list catalog entries, with pagination.
- Read an entry by ID and revision.
- Submit a new recipe or idea.
- Submit an update to an existing entry using its ID and expected revision.
- Check the status of a submission.

Read access supports selecting the correct entry for updates. Keep access limited to the owner's authorized catalog. External tools must not be able to approve their own submissions or change the approval setting.

### Submission behavior — Proposed

- Return a clear status: pending approval, applied, rejected, conflict, or validation failure.
- Return a submission ID and, when applied, an entry ID and revision.
- Require a retry identifier so repeated delivery does not create duplicate entries or changes.
- Reject stale updates when the stored revision has changed; do not silently overwrite newer work.
- Validate submitted fields and preserve omitted fields during partial updates.
- Use the same approval enforcement for all external AI entry points (HTTP API and MCP). In-app AI actions the owner starts are approved by the owner's Save.
- Enforce authorization and approval on the server, not just in the interface.
- Do not expose deletion through the first integration contract unless explicitly requested.

## Preferences and recommendation behavior — Proposed

- Learn from the actual catalog, using relevant recipe content such as ingredients and cuisine descriptions.
- Keep inferred preferences distinct from owner-confirmed preferences.
- Reference saved entry IDs as evidence so the owner can understand an inference.
- Preserve corrections when recomputing the profile. Do not repeatedly restore a rejected inference.
- Do not assume that saving a recipe means the owner cooked or liked it.
- Distinguish saved catalog matches from external discoveries.
- Provide source links for web results; do not invent sources or claim a page was checked when it was not.
- Treat imported recipes and web page text as content, never as instructions to the application or AI tools.

## Privacy and reliability — Proposed

- Allow public recipe browsing and ordinary search. Require authorization for writes, uploads, integration access, and every operation that invokes paid AI.
- **Confirmed (2026-11-03):** Everything readable is public: recipes, notes, experiment notes, feedback markers, sources, all photos (including import images), version history, pasted import text, and the preference profile. Keep private: integration credentials and secrets, settings, sessions, inactive (deleted) records, and pending or rejected submissions.
- **Confirmed (2026-11-03):** Block search-engine indexing (noindex and robots.txt).
- Allow integration credentials to be revoked.
- Keep secrets out of client code and logs.
- Disclose which catalog content is sent to an AI provider before enabling that connection.
- Keep normal catalog reading and editing available when AI services fail.
- Define backup and recovery before storing the owner's real catalog.

## Hosting portability — Confirmed requirement, proposed implementation

**Confirmed:** Minimize Cloudflare-specific implementation. Changing hosts should not require rewriting core application behavior.

**Confirmed (2026-11-03):** Host on the Cloudflare Workers free plan at cookbook.chrisandelissa.com. Use Cloudflare D1 (SQLite) as the database; it is an accepted provider dependency, accessed only through a database adapter, with the alternative host using the same schema on SQLite. Design within free-plan limits; moving to a paid plan is the owner's decision.

**Proposed implementation rules:**

- Prefer widely supported web standards, libraries, and deployable application components over proprietary hosting features.
- Keep recipe management, approval, preferences, and AI integration logic independent of Cloudflare runtime APIs.
- Access databases, media storage, authentication, and background processing through clearly separated interfaces where provider-specific behavior is necessary.
- Do not select Cloudflare-only storage, queues, AI services, or runtime primitives merely because the site will be hosted there. Evaluate portability and operational simplicity before choosing dependencies.
- Keep hosting configuration and any necessary platform adapters separate from core application code.
- Configure domains, service URLs, and credentials outside application code.
- Provide a documented way to export and restore recipe data, tags, collections, preferences, pending changes, and uploaded media. Preserve IDs and relationships during migration.
- Document any remaining Cloudflare dependencies and the work needed to replace them.
- Define and verify one deployment path outside Cloudflare for the chosen stack. Local development alone does not demonstrate hosting portability.

These rules do not require multiple live deployments or prohibit all Cloudflare services. The implementing agent should explain material portability tradeoffs before committing to a provider-specific dependency.

## Recipe photos and ingredient identification

**Confirmed:** Support phone-camera capture and existing photo uploads for recipe documentation. Support AI ingredient identification from both photos and typed descriptions during new recipe creation and, **confirmed 2026-11-03**, when editing existing recipes.

**Confirmed (2026-11-03):** Test camera capture, upload, and cooking mode on iPhone Safari, Chrome on iPhone, the Home Screen web app, and Android.

**Proposed:** Use browser-supported camera capture with an upload fallback. Store images through the same portable media interface regardless of capture method; all stored photos are publicly viewable. Validate image types and sizes on the server, preserve useful image quality, and remove location metadata from stored images. Select supported formats and upload limits during implementation and explain them in the interface.

**Proposed:** Send owner-selected ingredient photos, typed descriptions, or both to backend Claude for identification. Treat results as suggestions with uncertainty, not verified facts. Suggestions are applied through the editor and the owner's Save, not the external approval queue. Preserve manually entered ingredients unless a reviewed or otherwise authorized update explicitly changes them. Prevent a delayed analysis response from overwriting newer edits.

## History, recovery, and cooking data — Proposed implementation

Support the confirmed preservation and cooking requirements with:

- Immutable recipe revisions recording saved content, timestamp, origin, and optional change notes. Applied AI updates and manual edits both create revisions.
- A restoration operation that creates a new revision from a selected prior version and uses conflict checking.
- Soft deletion with a deletion timestamp and a recoverable view. **Confirmed (2026-11-03):** Deleted records stay in the database as inactive records indefinitely; no automatic permanent removal.
- Backups covering entries, revision history, media, tags, collections, preference corrections, feedback, and pending submissions. **Confirmed (2026-11-03):** Backups are manual: a "Download full backup" action and a matching restore, with no scheduled backups. Document the recovery limit (changes after the last downloaded backup are protected only by the database provider's point-in-time restore window). Test restoration separately from the in-app undo/history feature.
- Original pasted import text and optional source-chat reference. A source-chat link is not required to retrieve the saved recipe.
- Cooking status and an independent favorite flag, used as explicit signals for recommendations.
- Structured numeric quantities where unambiguous, while preserving original ingredient text. Scale quantities by target servings divided by original servings. Handle fractions and ranges; leave “to taste” and unknown amounts unchanged and flag them. Do not infer missing yield.
- Similarity checks that return possible duplicate IDs and reasons without performing automatic merges. **Confirmed (2026-11-03):** Free text similarity runs automatically; AI comparison runs only on explicit request. Keep duplicate suggestions distinct from retry deduplication in the integration contract.

Portable export/restore must include version history and recovery metadata as well as current entries.

## Google authentication and update mode

**Confirmed:** Use Google sign-in to authenticate the owner for update mode.

**Confirmed (2026-11-03):** One or two admin Google accounts share full owner access. The owner configures them in the Google OAuth setup; the server also checks a configured email allow-list, because OAuth client configuration alone does not restrict who can sign in. Revision history records which admin account made each edit.

**Proposed:** Restrict interactive write access to the configured admin Google identities; signing in with any other Google account must not grant access. Enforce write authorization on the server for recipe creation, editing, deletion, restoration, approvals, uploads, and settings. Keep authentication independent of Cloudflare-specific access products.

External AI tools still need their own authorized integration credentials and the shared approval policy. Google sign-in for the interactive owner does not imply that arbitrary external tools can write or bypass approval.

**Confirmed:** Anyone can browse without sign-in. AI features require authentication because they cost money.

**Confirmed (2026-11-03):** Only admin accounts can invoke paid in-app AI after Google sign-in; signing in with an arbitrary Google account does not grant spending privileges. Authorized external integrations use scoped credentials. Check authorization before calling Claude or any paid search/analysis service, including queued work. Public browsing, search, and recipe display must not trigger paid AI calls. Apply usage controls server-side; hiding buttons is insufficient.
