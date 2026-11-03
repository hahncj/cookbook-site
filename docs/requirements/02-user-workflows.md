# User workflows

The capabilities below are confirmed; detailed interaction choices are proposed unless explicitly noted.

## Primary journey — Confirmed purpose, proposed interaction

Create or refine a recipe in an AI chat → submit it through the integration or add it manually → approve it when required → find and read it later in the saved catalog. The catalog becomes the lasting home for the recipe, independent of the original chat.

**Proposed:** Open directly to the saved catalog without requiring sign-in. Make search prominent and expose recipe capture to the authenticated owner; keep AI discovery available as a secondary action. Store the recipe content itself, not only a link back to a chat.

## 1. Save something manually

1. Sign in and choose to add a recipe or food/drink idea.
2. Enter available details, notes, or a source link.
3. Optionally attach images, assign tags, and add collections.
4. Save and find the entry in the catalog on another device without requiring sign-in to read it.

**Proposed:** Require only a title for an idea. Allow incomplete recipe or idea entries without a separate draft status; saved entries are publicly browsable.

## 2. Import a link or image

1. Supply a URL, photo, or screenshot.
2. Extract available recipe information into editable fields.
3. Identify missing or uncertain information rather than inventing it.
4. Let the owner review and correct the extracted fields, then save. **Confirmed (2026-11-03):** The owner's Save is the approval; in-app imports do not go through the external approval queue.

**Proposed:** If a page cannot be read, explain the failure and offer manual entry or pasted text. Keep the source link and uploaded image available for review.

## 3. Receive a recipe from an external AI tool

1. Connect an authorized tool to the owner's account. **Confirmed (2026-11-03):** ChatGPT and Claude.ai connect as remote MCP connectors through an OAuth sign-in with an admin Google account.
2. The tool submits a new recipe or an update to an identified recipe.
3. With approval enabled, place the change in a review queue; leave the saved catalog unchanged.
4. Show the proposed addition or the differences from the saved recipe.
5. Let the owner approve or reject it.
6. With approval disabled, save valid authorized submissions immediately and report the result to the tool.

**Confirmed:** Approval defaults to on and can be toggled.

**Proposed:** Existing pending submissions stay pending when approval is turned off. The setting affects future submissions. Rejecting a submission never changes the saved recipe.

## 4. Browse and retrieve

Public visitors can browse without authentication. Editing requires an authorized admin account. **Confirmed (2026-11-03):** Public visitors can read everything readable, including notes, experiment notes, feedback markers, version history, and pasted import text; public search may match on all of it. Inactive records and pending submissions are not public.

- Search by recipe title, ingredients, or notes.
- Filter by tags and collections.
- Open a recipe to read ingredients, instructions, notes, images, and source information.
- Edit an entry and its organization.

**Proposed:** An entry can have multiple tags and belong to multiple collections.

## 5. Ask AI for suggestions

1. Sign in with an admin account and ask a question such as “What should I cook tonight?” Public visitors cannot use this feature.
2. AI uses the catalog and its learned preference profile.
3. Return relevant saved recipes and, when useful, new web recipes.
4. Label results as saved recipes or web discoveries and link to their sources.
5. Explain briefly why a suggestion fits.
6. Save a web discovery only through an explicit save action: it opens in the editor for review, and the owner's Save adds it to the catalog.

**Proposed:** Let the owner narrow an individual request, such as asking for a quick meal. Treat that instruction as temporary unless the owner chooses to save it as a preference.

## 6. Review learned preferences

1. AI identifies patterns in saved recipes.
2. Show inferred preferences as suggestions, with supporting examples.
3. Let the owner correct or reject each inference.
4. Use those corrections in later recommendations.

**Confirmed (2026-11-03):** Preferences refresh when the owner requests it and apply immediately; the owner can view and correct them at any time. They only influence the "Ask AI for suggestions" feature (workflow 5).

**Proposed:** Explicit corrections take precedence over later automatic inferences. Never infer allergies or medical restrictions from the presence or absence of recipes. If the catalog is small or varied, acknowledge uncertainty.

## Suggested screens — Proposed

- Sign in.
- Catalog with search, tags, and collections.
- Recipe or idea detail and editor.
- Import form.
- Pending AI changes with review details.
- AI discovery and recommendations.
- Preferences and integration settings.

## 7. Document a recipe with photos — Confirmed capability, proposed interaction

1. While creating or editing a recipe, choose to take a picture or upload an existing photo.
2. On a supported phone browser, request camera access when the owner chooses to take a picture.
3. Preview the image and attach it to the recipe.
4. Display saved photos with the recipe across devices.

**Proposed:** Support multiple images for ingredients, preparation, and the finished dish. Allow removing an attachment or retaking a photo before saving. If camera access is unavailable or denied, keep photo upload available. Attaching a photo does not automatically request AI analysis.

## 8. Identify ingredients while creating or editing a recipe

**Confirmed:** AI helps identify ingredients from photos and typed descriptions during new recipe creation. **Confirmed (2026-11-03):** Also available when editing an existing recipe.

**Proposed interaction:**

1. Take or upload ingredient photos, type an ingredient description, or provide both in the recipe editor.
2. Explicitly request ingredient identification.
3. Claude returns suggested ingredient names and flags uncertain identifications.
4. Let the owner correct, remove, or add suggested ingredients in the editor. Suggestions never replace existing ingredients without the owner's review.
5. The owner's Save applies the result (in-app AI does not use the external approval queue). Uncertainty stays clearly marked until the owner resolves it.

Do not claim that a photo establishes exact quantities, hidden ingredients, allergens, or food safety. Leave unknown quantities blank. Ingredient identification helps build a recipe; it does not require generating a complete recipe automatically.

## Interface quality — Proposed design guidance

- Give the saved recipe collection a recognizable visual identity instead of a generic dashboard with unrelated metrics and repetitive cards.
- Use recipe photography where available, with intentional layouts for recipes without images and incomplete ideas.
- Make recipe reading comfortable on iPhone: clear ingredient quantities, ordered steps, readable text, and reachable controls.
- Make search, saving, editing, and approval easy to discover. Decorative elements must not obscure these actions.
- Provide coherent loading, empty, error, and success states. Preserve entered content when an action fails.
- Use restrained motion and responsive feedback; respect reduced-motion settings.
- Maintain accessible contrast, visible keyboard focus, and comfortable touch targets.
- Keep the interface responsive and useful on slower connections; optimize images rather than sacrificing recipe content.

## 9. Bring recipes over from old chats

Paste recipe text (one recipe at a time) into an import form, preview the extracted fields, correct omissions, and save. The owner's Save is the approval. Retain the supplied text for reference. Flag possible matches in the existing catalog. Do not require access to the original chat account.

## 10. Review history and recover changes

View earlier saved versions and their changes, including manual and applied AI edits. Restore a selected version without erasing the intervening history. Add notes about experiments and changes. Find deleted recipes in a recoverable area and restore them.

**Proposed:** Restoring an older version creates a new current version. Pending or rejected AI submissions are not saved recipe versions.

**Confirmed (2026-11-03):** Deleted recipes become inactive records kept in the database indefinitely; there is no automatic permanent deletion. Version history is kept indefinitely.

## 11. Cook from a recipe

Choose a target serving count and view scaled ingredient quantities beside readable steps. Enable a screen-awake cooking view where supported; explain when the browser cannot keep the screen awake.

**Proposed:** Scaling is a temporary view until the owner explicitly saves a change. Preserve the original recipe, avoid changing cooking times automatically, and flag ingredients without scalable quantities for manual judgment.

## 12. Record personal feedback

Mark a recipe as “want to try,” “made,” or “favorite,” and update those markers later. Use this feedback as evidence for recommendations.

**Proposed:** Favorites are independent of cooking status. Marking something “made” does not imply it was liked. Explicit preference corrections continue to override inferred tastes.

## 13. Review possible duplicates

When adding or importing a recipe, show likely matching entries with enough detail to compare them. **Confirmed (2026-11-03):** Run a free text-similarity check automatically on every add or import, and offer a "Check with AI" button for a deeper comparison. Let the owner keep a separate recipe, cancel the addition, or explicitly update an existing entry. Updates follow the normal approval and history rules. Never merge or discard recipes automatically.
