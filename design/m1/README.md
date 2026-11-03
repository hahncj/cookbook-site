# M1 design directions — round 1

Static mockups for choosing the cookbook's visual direction (plan milestone M1, acceptance check AC-021). Nothing here is used by the app; the approved direction is turned into app styles in M2.

The files under `project/` are the sources of a private design canvas (Design artifact). They render inside that canvas (each artboard loads its runtime via `./support.js`), not as standalone pages.

## Directions

| | Look | Type | Color | Layout ideas |
| --- | --- | --- | --- | --- |
| **A · Kitchen Notebook** | Warm paper and ink, like a well-used notebook | Newsreader (serif) + Public Sans | Paper `#F7F4EC`, ink blue `#2B4C9B`, tomato and herb for markers | Ruled list; small photo thumbnails; recipes without photos show an ingredient snippet card |
| **B · Market Bold** | Bright, graphic, photo-forward | Bricolage Grotesque (heavy) + DM Sans | White, black, tomato `#D7372B`, herb green `#1E6B45` | Two-column card grid; photo-less recipes become bold color title cards; dashed card for ideas |
| **C · Night Kitchen** | Dark-first, high contrast for cooking | Manrope | Charcoal `#15161A`, saffron `#F2B13D`, mint and periwinkle for markers | Featured card plus compact rows; large ingredient quantities in the accent color |

Each direction has a phone catalog (390×844) and a phone recipe page (390 wide, shown at full scroll length). Shared content shows the required states: a recipe with a photo, without a photo, an incomplete idea, favorite / made / want-to-try markers, scaled servings with an unscalable ingredient flagged, experiment notes, source, version history link, and the admin Add and Review (pending AI submissions) actions.

Photos are labelled placeholders (no real food photography yet).

## Round 2 (after a direction is chosen)

Desktop layouts, the recipe editor, the AI approval queue, empty/loading/error states, and the connector consent page, in the chosen direction.
