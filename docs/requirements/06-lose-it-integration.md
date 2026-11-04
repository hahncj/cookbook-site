# Lose It! recipe transfer

> **Resolved 2026-11-04:** The owner confirmed that Lose It! can import a recipe from its web page. The owner will point Lose It! at the cookbook's public recipe pages. The "Copy ingredients for Lose It!" feature and the Text Importer test are dropped. The only remaining requirement: public recipe pages keep their schema.org Recipe markup. The sections below are kept as background.

## Owner requirement — Confirmed

The owner tracks calories in Lose It! on an iPhone and has a Premium subscription. Moving saved recipes into Lose It! would be a high-value feature. Investigate direct sending or supported export/import workflows. Feasibility is conditional; do not promise automatic synchronization.

## Research findings — checked November 2, 2026

- Lose It! support describes a recipe importer for Premium members: [official tutorial](https://loseit.zendesk.com/hc/en-us/p/tutorial).
- Official troubleshooting documents website recipe imports and a Text Importer that accepts a pasted ingredients list: [recipe importer troubleshooting](https://loseit.zendesk.com/hc/en-us/articles/51197596722836-Troubleshooting-Recipe-Importer-Error-Messages).
- All users can manually create recipes and specify servings: [using recipes](https://loseit.zendesk.com/hc/en-us/articles/47345201948052-Using-Recipes-in-Lose-It).

These findings confirm documented import paths, not successful testing with this application or the owner's account. A supported public recipe-write API, file import format, and automatic update mechanism have not been verified. Do not assume that CSV/JSON files can be imported into Lose It!.

## Proposed first approach

Provide a “Copy ingredients for Lose It!” action that copies one ingredient per line with saved quantities and units. Show the title and recipe yield separately for reference and explain how to paste into the Lose It! Text Importer. Let the owner review ingredient matches and servings in Lose It! before saving. Do not claim that copying text completes an import.

Missing quantities or yield should be flagged for review, not guessed. This transfer feature does not require this application to calculate calories or replace Lose It! as the calorie tracker.

## Additional options to investigate

1. Verify whether an official authenticated API or supported direct-send mechanism is available.
2. Test URL import from the public recipe detail page. Public browsing is now authorized, but compatibility with Lose It! must still be verified. Exclude administrative data and owner-only records from the page.
3. Investigate supported file import only if official documentation establishes a compatible format.

Choose the simplest supported path after testing. Keep Lose It! integration separate from the catalog and independent of Cloudflare. Do not depend on undocumented private endpoints or store the owner's Lose It! password.

## Proposed acceptance checks

- Copying a recipe preserves ingredient names, quantities, and units, with title and yield available for reference.
- Test transferring a sample recipe into Lose It! on iPhone with the owner’s Premium account; document the actual result and any manual steps.
- The owner reviews ingredient matching and servings in Lose It!; no calorie accuracy is implied by transfer alone.
- Public recipe pages expose recipe content and display photos, not credentials, pending changes, or other owner-only records.
- A change to a previously transferred recipe does not claim to update Lose It! automatically. Show that another transfer or manual update is needed unless update support is verified.

## Resolved decision (2026-11-03)

**Confirmed:** Copy/paste is acceptable only if the full ingredient list transfers in one paste. If the Lose It! Text Importer accepts only one ingredient at a time, drop the feature.

**Gate before building (milestone M6):** The owner pastes a multi-line ingredient list into the Lose It! Text Importer on iPhone and records whether every line becomes an ingredient. The URL importer test against the public recipe page (which carries schema.org Recipe markup) runs in the same milestone.
