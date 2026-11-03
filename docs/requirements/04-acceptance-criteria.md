# Acceptance criteria

Each check has a stable ID for implementation reports. Section labels preserve the distinction between confirmed requirements and proposed checks. IDs do not imply that a check has been run or passed.

## Confirmed requirements

- **AC-001** Anyone can browse the saved recipes without signing in; the owner can manage the same catalog across devices after Google sign-in.
- **AC-002** The application works online; offline access is not required.
- **AC-003** The application is a mobile-friendly website usable on phones, tablets, and computers.
- **AC-004** The implementation minimizes Cloudflare dependencies and identifies any remaining provider-specific components.
- **AC-005** The owner can save a manually entered recipe, an incomplete food/drink idea, a link, a photo, and a screenshot.
- **AC-006** The owner can take a picture from a supported phone browser or upload an existing photo to document a recipe, then view the saved photo on another device.
- **AC-007** AI can help identify ingredients from photos and from typed descriptions while the owner builds a new recipe or edits an existing one.
- **AC-008** The application can extract recipe information from a supported readable link and a legible image.
- **AC-009** The owner can search entries, assign tags, and organize entries in collections.
- **AC-010** The backend uses Claude for in-app AI features.
- **AC-011** An authorized external AI tool can submit a new recipe and an update to an existing recipe through a documented interface that is not restricted to Claude. Verified live from both ChatGPT and Claude.ai.
- **AC-012** With the default approval setting, neither external submission changes the catalog before owner approval.
- **AC-013** Approving a submission applies the reviewed change; rejecting it leaves the catalog unchanged.
- **AC-014** The owner can disable approval so subsequent valid external AI submissions save automatically, and enable approval again.
- **AC-015** AI can recommend saved catalog entries and find new recipes from the web.
- **AC-016** AI can infer preferences from existing catalog recipes.
- **AC-017** The owner can view and correct those preferences, and later recommendations reflect the correction.

## Design requirement — Confirmed

Functionality takes priority, and the finished application must offer a rich, distinctive interface rather than a generic boilerplate UI.

## Proposed design review

- **AC-018** Review representative catalog, recipe detail, editor, and AI approval screens on phone and desktop.
- **AC-019** Show populated, empty, loading, and error states, including recipes with and without photos.
- **AC-020** Verify that saving, finding, reading, and editing recipes remain straightforward within the visual design.
- **AC-021** Evaluate the visual direction with the owner; passing functional tests alone does not establish that the aesthetic requirement is met.

## Proposed quality checks

- **AC-022** A recipe saved from an AI session can be found and read on another device without reopening or accessing the original chat.
- **AC-023** The saved catalog is the public starting screen, with search easy to find and add/import actions available to the authenticated owner.

- **AC-024** Verify recipe creation and updates through the public integration contract using a client independent of Claude.
- **AC-025** If both HTTP and MCP interfaces are implemented, verify that both enforce the same approval behavior.

- **AC-026** Phone, tablet, and desktop layouts allow adding, reading, searching, and reviewing recipes without horizontal page scrolling.
- **AC-027** Signed-out visitors can read recipes and their display photos but cannot edit entries or invoke AI services.
- **AC-028** Credentials, secrets, sessions, settings, inactive (deleted) records, and pending or rejected submissions are not exposed by public endpoints. Recipe content, notes, feedback markers, all photos, version history, pasted import text, and the preference profile are publicly readable (revised 2026-11-03).
- **AC-028a** Public pages send noindex and robots.txt disallows indexing.
- **AC-029** An integration cannot bypass approval or alter the approval setting.
- **AC-030** Retrying the same submission does not create duplicates.
- **AC-031** An update based on an outdated revision produces a conflict instead of overwriting newer edits.
- **AC-032** Turning approval off does not automatically apply existing pending submissions.
- **AC-033** Failed imports explain the problem and do not create fabricated recipe details.
- **AC-034** Web discoveries have source links and are distinguishable from saved entries.
- **AC-035** An explicitly rejected preference does not return automatically after profile refresh.
- **AC-036** AI failure does not prevent opening or manually editing saved recipes.
- **AC-037** Core forms have accessible labels and work with a keyboard.

Use sample recipes and mocked AI responses for repeatable automated checks. Verify the chosen AI client connection and web/image import with a small end-to-end smoke test before handoff.

## Proposed portability checks

- **AC-038** Core recipe, approval, and AI workflows do not directly depend on Cloudflare-specific APIs. D1 and R2 are reached only through adapters.
- **AC-039** Deployment documentation covers the likely Cloudflare setup, custom domain configuration, and one alternative hosting path.
- **AC-040** Verify the alternative hosting path using a disposable environment or an appropriate deployment test; record what was actually verified.
- **AC-041** Export and restore a sample catalog and its media into a fresh instance, checking IDs, relationships, preferences, and pending submissions.
- **AC-042** Record unavoidable provider dependencies and replacement steps in the handoff.

## Proposed photo and ingredient identification checks

- **AC-043** Test camera capture on iPhone Safari, Chrome on iPhone, the Home Screen web app, and Android; verify an upload fallback when camera access is denied or unavailable.
- **AC-044** Saving a documentation photo does not initiate AI analysis without an explicit request.
- **AC-045** Test ingredient identification with a photo alone, a typed description alone, and both together. Suggestions are editable and uncertain results are marked clearly.
- **AC-046** Unknown quantities remain blank rather than being invented from an image.
- **AC-047** AI ingredient suggestions are applied only through the editor and the owner's Save, and do not silently overwrite existing or newer manual edits.
- **AC-048** A failed upload or AI analysis preserves the owner's unsaved form content.

## Additional confirmed feature checks

- **AC-049** Paste a recipe from an old chat, review it, save it, and retrieve it without reopening the chat.
- **AC-050** Manual and applied AI edits preserve earlier versions; the owner can review and restore an earlier recipe.
- **AC-051** The owner can save notes about experiments and changes.
- **AC-052** An accidentally deleted recipe can be restored, and an unwanted applied AI update can be reversed through history. Deleted recipes remain in the database as inactive records.
- **AC-053** Demonstrate restoring a manually downloaded backup with sample recipes and their media; document recovery limits.
- **AC-054** Changing serving count updates scalable ingredient amounts without silently changing the original recipe.
- **AC-055** Cooking mode offers screen-awake behavior on supported browsers and explains unavailability on unsupported browsers.
- **AC-056** “Want to try,” “made,” and “favorite” feedback persists and is available to recommendation logic.
- **AC-057** Similar recipes trigger reviewable duplicate suggestions from free text matching without automatic merges or deletions; an AI comparison runs only when explicitly requested.

## Proposed edge-case checks

- **AC-058** Restoring an earlier revision preserves all previous history and does not overwrite newer edits without a conflict check.
- **AC-059** Rejected AI submissions do not appear as applied recipe revisions.
- **AC-060** Scaling handles fractions, ranges, unknown quantities, and missing yield without inventing values or automatically scaling cooking times.
- **AC-061** A backup restore preserves recipe IDs, history, media relationships, feedback, and preference corrections.

## Update-mode authentication

- **AC-062** Google sign-in authenticates the owner for interactive update mode.
- **AC-063** A Google account not on the configured admin allow-list cannot gain owner privileges, even if it completes Google sign-in. Each configured admin account (one or two) has full owner access.
- **AC-064** **Proposed check:** Hiding edit controls is insufficient: unauthorized write requests are rejected by the server.
- **AC-065** Public browsing requires no sign-in.
- **AC-066** Unauthenticated AI requests are rejected before paid provider calls or jobs are initiated.
- **AC-067** A Google account not on the admin allow-list cannot invoke paid AI. Public browsing and ordinary search do not trigger paid AI calls.

## No draft or publishing workflow — Confirmed

- **AC-068** Saving a catalog entry makes it available for public browsing without a separate publish action.
- **AC-069** No recipe draft status or draft-management interface is required.
- **AC-070** Pending AI submissions remain nonpublic until approved; with approval disabled, successfully applied submissions become publicly browsable immediately.

## Appearance — Confirmed 2026-11-03

- **AC-071** Viewers can choose System default, Light, or Dark. System default follows the device setting and is used until a choice is made.
- **AC-072** Both themes meet the contrast and focus requirements (AC-037) on every screen, and pages do not flash the wrong theme while loading.
