# AI features, approval and preferences

A short guide for the admins. All AI features are admin-only and run only when you press a button. Visitors never trigger AI. Costs are in [costs.md](costs.md).

## The one rule

**Nothing AI produces is saved until you press Save** (D2). AI fills the editor or shows suggestions; you review and save. The only exception is AI tools sending recipes with approval turned off (below).

AI never invents amounts, with three labeled exceptions:

- Recipes **written by AI** in AI search: labeled "Written by AI · untested".
- **Swaps** from AI help: the amount is the AI's suggestion.
- **Changed recipes** from AI help: labeled "Changed by AI · untested".

## Approval for AI tools (ChatGPT, Claude.ai, API)

Where: **Settings → Approval for AI tools**.

- **On (default):** anything an AI tool sends waits in **Review** (profile menu → Review; a dot on your picture means something is waiting). Approve to save it, reject to drop it. Nothing changes and nothing is public until you approve.
- **Off:** valid submissions save right away and are public at once. Turning it off doesn't apply anything already waiting.
- Either way, every applied change is a new version, so you can undo it from the recipe's history.
- AI tools can never approve, delete, or change this setting.

Connecting and disconnecting tools: [integration.md](integration.md).

## AI search (search bar)

Two small buttons sit in the search bar for admins: **AI** and **Web**. With neither on, the bar is the normal cookbook search.

- **AI:** Claude writes 2–3 new recipes for your request (about 20 seconds). Labeled "Written by AI · untested".
- **Web:** Claude searches the web (at most 3 searches) and picks up to 4 real recipe pages, each with its site name and link (15–30 seconds). Every link came from the actual search; made-up links are dropped.
- **More ideas / More results:** asks again and adds new results below, without repeats. Each press costs about the same as the first search.
- Both look only for recipes **not already** in your cookbook.
- Your preferences and favorites are used, unless you write something like "ignore my preferences" in the request.
- **Save to cookbook…** opens the editor (AI) or link import (Web) filled in. Nothing is saved until you press Save.

## AI help on a recipe

At the bottom of each recipe page (admins only):

- **Missing an ingredient:** pick it, optionally say what you have, press **Suggest swaps**. Up to 4 swaps, each with an amount and how the dish changes. **Save as a note** keeps one under Notes & experiments (the recipe itself doesn't change).
- **Change this recipe:** describe the change ("make it vegetarian", "halve it"), press **Suggest changes**. You get the whole changed recipe and a list of what changed. Then:
  - **Edit this recipe with these changes…**: opens the editor. Saving makes a new version; the old one stays in history.
  - **Save as a new recipe…**: opens a new entry with the changed recipe.

## Preferences

Where: profile menu → **Preferences**. The page is public to read (D3); only admins change it.

- **Refresh from my recipes** asks Claude for patterns in your recipes and markers (favorite, made, want to try). Each suggestion lists the recipes behind it. It never guesses allergies or medical or dietary restrictions. With fewer than 8 recipes it says the result is a rough guess.
- Nothing changes on its own: the profile changes only when you press Refresh (D9).
- For each suggestion you can mark it **right**, **correct** its wording, or say **Not true**. You can also add your own and delete them.
- A refresh replaces only suggestions you haven't reviewed. Things you marked Not true or corrected stay as you left them and never come back on their own. **Allow again** forgets a "Not true".
- AI search and AI help use the profile: confirmed items and your own as firm preferences, unreviewed ones as hints, "Not true" ones as things to avoid assuming.

## Other AI buttons

- **Import** (profile menu): paste an old chat, a link, or a photo or screenshot. Links with recipe data are read without AI (free).
- **Identify ingredients** (editor): from a photo, a description, or both. Suggests names only, never amounts; added rows have blank amounts.
- **Find a photo** (editor and Review): the source page's photo first, then free stock photos, then web images if set up. Credits are kept with the photo.
- **Check with AI** (duplicate warning): compares two recipes only when pressed.

## If AI isn't working

- Without `ANTHROPIC_API_KEY`, AI buttons say AI isn't set up. Everything else works.
- If a request fails, you get a plain message and your form stays as it was. Try again.
