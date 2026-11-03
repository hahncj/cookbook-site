# Product requirements

## Purpose — Confirmed

Provide a central home with public browsing for recipes the owner creates so they can reliably access them later. Those recipes are currently scattered across multiple AI sessions and chats. Saving and retrieving this personal collection is the primary purpose; AI discovery and recommendations are supporting features.

## Product priorities — Confirmed

1. Preserve recipes created by the owner, including recipes developed with AI across different chats.
2. Make saved recipes easy to find and read later across devices.
3. Support organizing and updating that collection.
4. Provide supporting AI recommendations, preference learning, and web discovery without making them the focus of the application.

**Proposed:** Make the saved catalog the home screen, with prominent search and add/import actions. Do not make an AI conversation or discovery feed the default starting screen.

**Confirmed:** Provide an easy way to paste and import recipes from existing chats, one recipe at a time. Automatic access to chat histories is not required. **Confirmed (2026-11-03):** Bulk migration and chat-export import are not wanted.

## Audience and access — Confirmed

- One owner manages the collection; anyone can browse without signing in.
- **Confirmed (2026-11-03):** One or two configured admin Google accounts share full owner access to the single collection. This is not multiple users with separate collections.
- **Confirmed (2026-11-03):** Public visitors can read everything readable in the catalog, including notes, experiment notes, feedback markers, sources, all photos, version history, pasted import text, and the preference profile. Credentials, settings, inactive (deleted) records, and pending or rejected submissions stay private. Editing and all AI features are admin-only.
- **Confirmed (2026-11-03):** Search engines must not index the site.
- No recipe draft state or separate publishing workflow is required. Saved catalog entries are available for public browsing immediately.
- AI submissions awaiting approval remain outside the public catalog until approved; this is an approval queue, not a recipe draft feature.
- Use Google sign-in to authenticate the owner for update mode.
- AI features require authentication because they incur usage costs. External AI integrations also require authorization.
- Access across the owner's devices.
- Online-only access is sufficient for the first version.
- Deliver a mobile-friendly website usable on phones, tablets, and computers.

## Hosting and portability

- **Confirmed (2026-11-03):** Host on the Cloudflare Workers free plan at cookbook.chrisandelissa.com. Use Cloudflare D1 for the database.
- **Confirmed:** Otherwise avoid Cloudflare-specific implementations as much as practical to minimize provider lock-in. D1 is an accepted, documented dependency, accessed only through an adapter.
- **Proposed:** Use standard web interfaces and portable application code. Keep any unavoidable host-specific configuration or adapters separate from application logic.

## Capture and organization — Confirmed

- Manually enter recipes and notes.
- Save links.
- Take pictures with the phone camera to document a recipe.
- Upload existing photos and screenshots and attach them to recipes.
- Extract recipe information from links and images.
- Support incomplete food/drink ideas as well as full recipes.
- Search the catalog.
- Organize entries with tags and collections.

## AI and external tools — Confirmed

- Most recipes originate in AI tools.
- The application backend connects to Claude for its AI features.
- AI helps identify ingredients from captured or uploaded photos and typed descriptions when building a new recipe. **Confirmed (2026-11-03):** Also available when editing an existing recipe.
- External recipe creation and updates must be available to any authorized AI tool capable of using the published integration interface, not just Claude.
- External AI tools must be able to add and update recipes through an MCP server or another supported integration. **Confirmed (2026-11-03):** The owner uses ChatGPT and Claude.ai, so provide a remote MCP server with OAuth sign-in, plus a documented HTTP API.
- AI additions and updates require owner approval by default.
- The owner can turn that approval requirement on or off.
- **Confirmed (2026-11-03):** The approval queue and toggle apply to external tool submissions. In-app AI actions the owner starts (paste import, link or image extraction, ingredient identification) fill the editor for review, and the owner's Save counts as the approval.
- AI can help select recipes from the saved catalog and find new recipes on the web.
- AI learns the owner's preferences from recipes already in the catalog.
- The owner can view and correct inferred preferences.

## Lose It! transfer — Confirmed interest, conditional feasibility

The owner uses Lose It! Premium on iPhone to track calories. Sending or exporting recipes into Lose It! is a high-value feature to investigate and implement where supported. See [integration requirements](06-lose-it-integration.md). Automatic sync and direct API access are not confirmed capabilities.

## Planning constraints — Confirmed

- Budget should not constrain the application plan or feature scope.
- This is not authorization to purchase services or incur charges.

## Suggested implementation shape — Proposed

- A centrally stored catalog so saved changes appear across devices, including public browsing sessions.
- ~~Apply the approval setting to all AI-originated catalog additions and updates, including imports and in-app AI actions.~~ Superseded 2026-11-03: the approval setting applies to external tool submissions only (see AI and external tools).
- Manual edits made directly by the owner save without an additional approval step.

## Not requested

The owner has not requested multiple editing users with separate collections (one or two admin accounts sharing owner access are confirmed), bulk migration, scheduled backups, search-engine indexing, native mobile apps, offline access, meal planning, grocery lists, nutrition calculations, or pantry tracking. Do not silently add these to the first build.

## User experience and visual design — Confirmed

- Functionality is the highest priority.
- The owner also wants a rich, distinctive UI experience, not a generic boilerplate application.
- Visual polish must support the primary purpose: saving, finding, and reading personal recipes.

**Proposed direction:** A personal cookbook with strong typography, thoughtful spacing, expressive but restrained color, and prominent recipe photography. This is a starting direction, not an approved visual style. Do not assume a specific palette, font, or theme.

**Confirmed (2026-11-03):** The owner approved **A · Kitchen Notebook** as the visual direction (paper and ink, Newsreader serif headings with Public Sans text; mockups and palettes in `design/m1/`).

**Confirmed (2026-11-03, D17):** Offer a dark mode. Viewers choose **System default** (follows the device setting, the default), **Light**, or **Dark**. **Proposed:** the choice is remembered on that device for any visitor, signed in or not.

## Collection preservation and cooking — Confirmed

- Import existing recipes by pasting content from old chats.
- Preserve recipe version history so the owner can review changes and restore an earlier version. Support notes about experiments and what changed.
- Recover accidentally deleted recipes and unwanted AI updates, and back up the collection.
- Adjust servings and ingredient amounts for cooking. Offer a cooking view that keeps the screen awake where the browser supports it.
- Let the owner mark recipes as “want to try,” “made,” and “favorite.” Use this explicit feedback to improve recommendations rather than assuming every saved recipe is liked.
- Identify possible duplicates or similar recipes from different chats. Let the owner decide what to keep; never automatically merge them.

**Confirmed (2026-11-03):** Deleting marks a recipe inactive: hidden in the app, kept in the database indefinitely, with no automatic purge. Purging may be added later on request. Backups are manual (download and restore), with no scheduled backups. Version history is kept indefinitely. Exact interaction details remain implementation decisions.
