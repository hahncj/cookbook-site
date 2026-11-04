# Enhancements after first release

Ideas the owner raised after using the deployed app (2026-11-04). They are separate from the planned milestones M6–M8 in `docs/implementation-plan.md`. No milestone has been assigned yet.

Labels follow the rest of this package: **Confirmed** means the owner asked for it. **Proposed** means a suggested default the owner has not approved yet.

## E1. Find a photo for a recipe

### Owner request — Confirmed

- When approving a new recipe in the Review queue that has no photo, offer a way to find one, using AI or other means.
- The same option is available when editing a recipe, next to taking or uploading a photo.

### Proposed behavior

- Show a **Find a photo** button beside **Take photo** and **Upload** in the photo field, and on Review items that have no photo.
- Show a few candidate photos. The admin picks one, or none. Nothing is saved until the admin chooses and saves (same approval rule as D2).
- The chosen photo goes through the same browser resize step as uploads (`app/photo-prepare.ts`) and is stored like any other recipe photo.
- Admin-only, like other AI features. Signed-out and non-admin requests are refused before any search or AI call.

### Photo sources — Confirmed 2026-11-04

1. **Primary:** the photo from the recipe's own source page, if the recipe has a link. Then free stock photo sites (for example Unsplash or Pexels).
2. **Secondary:** a general web image search, used when the primary sources find nothing or the admin asks for more choices.

### Photo sources — Proposed details

- Source page photo: read the page's schema.org recipe image or its preview image (`og:image`), using the existing SSRF-guarded page fetch.
- Web image search needs a search provider and its API key (for example Brave Search or Google Programmable Search). Provider to be chosen at build time; it may have a free tier with a monthly limit.
- Most web images are copyrighted. Label web search results as "from the web" so the admin can judge before choosing one.
- Downloading the chosen image must use the same SSRF guard as page fetching.

### Photo credit — Confirmed 2026-11-04

- Stock and web photos show a small credit line under the photo, for example "Photo: Jane Doe / Unsplash".
- The credit is saved with the photo, so it stays with the recipe and is included in backups.
- Photos the admin takes or uploads have no credit line.

## E2. Sign in from the top bar

### Owner request — Confirmed

- Rename **Admin sign-in** to **Sign in**.
- Clicking it goes straight to Google, with no in-between page.
- Once signed in, show the user's Google profile picture and name next to **Sign out**.

### Approved behavior — Confirmed 2026-11-04

- Put **Sign in** at the right end of the top bar, on the same row as the 540 Kitchen name. Owner asked whether this is the right place; recommended because people expect account controls in the top-right corner, and the footer is easy to miss.
- After sign-in, the same spot shows the profile picture (with name on wider screens). Clicking it opens a small menu: name and email, Settings, Sign out.
- If Google has no profile picture, show the first letter of the name.
- Keep the `/sign-in` page. AI tools (ChatGPT, Claude.ai) send people there when they connect to the cookbook, so it is still needed for that flow. Rename its heading to **Sign in**.
- If a non-admin signs in, keep the current message that they can browse but not edit.

### Phone top bar — Confirmed 2026-11-04

After using the first version, the owner found the phone top bar too cluttered: with the profile picture added, it wrapped onto two lines. Owner chose the "app style" layout:

- On phones, the logo and the profile picture (or **Sign in**) stay on one line. Search stays on the line below.
- **Add** moves to a round floating **+** button at the bottom right of the screen.
- **Review** and **Import** move into the profile menu. Review shows how many items are waiting.
- A small dot on the profile picture shows when reviews are waiting.
- Wider screens (tablet and desktop) keep Review, Import and Add in the top bar, as now.

### Phone top bar — Proposed details

- "Phone" means screens narrower than 600px, the same point where the name next to the picture is hidden.
- The floating **+** is hidden on pages where you are already adding or editing (new recipe, import, edit), so it never covers the editor's buttons.
- The floating **+** clears the iPhone home bar, and pages get extra space at the bottom so it never hides the last item.

## E3. Move Appearance into Settings

### Owner request — Confirmed

- The System / Dark / Light control takes up too much room.
- Owner likes the Settings page that admins see, and asked whether visitors who are not signed in should also have a Settings page holding Appearance.

### Approved behavior — Confirmed 2026-11-04

- Yes: make **Settings** open to everyone.
  - Visitors see only **Appearance**.
  - Admins see Appearance plus the current admin sections (approval, AI tools, API keys).
- Remove the Appearance control from the page footer.
- Visitors reach Settings from a small gear icon in the top bar. Signed-in users reach it from the profile menu (E2).
- The visitor's choice keeps being saved in a cookie on their device, as today. No sign-in needed.

## E4. Backup and Deleted recipes in Settings

### Owner question

Should Backup and Deleted recipes live in Settings for admins?

### Approved behavior — Confirmed 2026-11-04

- Yes: add an **Admin tools** section to Settings (admins only) with links to **Backup** and **Deleted recipes**.
- Keep those as their own pages, so existing links and tests still work. Only where you reach them from changes.
- Remove them from the footer.

## Status

| Item | Status | Notes |
| --- | --- | --- |
| E1 | In progress | Built separately. |
| E2 | Merged 2026-11-04 (PR #15); phone top bar built 2026-11-04, awaiting review | **Sign in** sits at the right of the top bar and goes straight to Google, returning to the same page. Signed in, the spot shows the Google picture (name too on screens 600px and wider, first letter if no picture) and opens a menu: name and email, Settings, Sign out. Better Auth already saves Google's picture as `user.image`; it is now refreshed on every sign-in (`overrideUserInfoOnSignIn`). `/sign-in` stays for AI tool connections, retitled **Sign in**. Phone follow-up: below 600px, Add is a floating **+** button and Review / Import are in the profile menu, with a dot on the picture when reviews wait. |
| E3 | Merged 2026-11-04 (PR #15) | `/settings` is open to everyone. Visitors see Appearance only; admins also see the admin sections, whose actions still refuse signed-out (401) and non-admin (403) requests. Visitors reach it from a gear in the top bar. The footer is gone, since nothing was left in it. |
| E4 | Merged 2026-11-04 (PR #15) | **Admin tools** section in Settings links to Backup and Deleted recipes. Both pages are unchanged. |
