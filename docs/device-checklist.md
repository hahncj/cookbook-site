# Real-device checklist

For the owner to run on real phones (D11). Automated browser tests already cover these flows in Chromium and WebKit at phone, tablet and desktop sizes, but they can't use a real camera, a real screen lock, or the Home Screen app. This checklist covers what only a real device can show (AC-043, AC-055, AC-003/026).

**Already done:** on 2026-11-04 the owner tested M6 (servings and cooking mode) on a real iPhone and it worked. Note which browser that was in the results table below.

## Before you start

- Use the live site: `https://cookbook.chrisandelissa.com`.
- Sign in with an admin Google account on each device (top-right **Sign in**).
- AI steps cost a few cents each (see [costs.md](costs.md)). Doing the AI steps on **one** device is enough; on the others, only check that the controls fit and respond.
- Make a throwaway recipe to test with (title "Device test"). Delete it at the end (it stays in **Settings → Admin tools → Deleted recipes**).

## The four devices

| # | Device | How to open it |
| --- | --- | --- |
| A | iPhone, Safari | Open the site in Safari |
| B | iPhone, Chrome | Open the site in the Chrome app |
| C | iPhone, Home Screen web app | In Safari: Share → **Add to Home Screen**, then open it from the 540 Kitchen icon. You sign in separately here (the Home Screen app keeps its own sign-in) |
| D | Android, Chrome | Open the site in Chrome |

On iPhone, Safari, Chrome and the Home Screen app all use Apple's WebKit engine, but camera prompts, screen-lock behavior and sign-in storage can still differ, so each is checked.

## Checks

Mark each one ✅ works, ❌ fails (with a note or screenshot), or – skipped.

### 1. Layout (AC-003, AC-026, AC-043)

1. Home page: the logo and your picture fit on one line; search is on the line below; the round **+** button sits above the home bar and doesn't hide the last recipe.
2. Turn the phone sideways and back. Nothing needs side-to-side scrolling on the home page, a recipe page, the editor, Review, or Settings.
3. A recipe with a long title wraps instead of running off the screen.
4. Settings → Appearance → Dark, then Light, then System default. Pages switch without a flash of the wrong colors.

### 2. Camera and photos (AC-006, AC-043)

1. Tap **+**, give the recipe a title, then tap **Take photo**. The camera opens. Take a picture. A preview appears.
2. Tap **Upload photos** and pick a photo from your library. It's added too.
3. Press **Save**. Both photos show on the recipe page.
4. Open the same recipe on a different device or a computer. The photos are there.
5. **Camera denied:** in the phone's settings, turn off camera access for the browser (iPhone: Settings → Safari → Camera → Deny; Chrome: Settings → Chrome → Camera off; Android: long-press Chrome → App info → Permissions → Camera → Don't allow). Tap **Take photo** again. You should still be able to choose a photo from your library (**Upload photos** works). Turn camera access back on afterwards.
6. Adding a photo doesn't start any AI (the editor says so).

### 3. Cooking mode and screen lock (AC-054, AC-055)

1. On a recipe, change the servings. Amounts change; reload the page and they're back to the original.
2. Tap **Start cooking mode**. It should say "The screen will stay on while cooking mode is open."
3. Put the phone down without touching it for longer than your Auto-Lock time (check iPhone: Settings → Display & Brightness → Auto-Lock). The screen stays on.
4. Switch to another app and come back. Cooking mode asks to keep the screen on again (or shows **Keep screen on**; tap it).
5. Tap **Done**. Leave the phone alone: it locks as usual again.
6. With **Low Power Mode** on (iPhone) or Battery Saver (Android), open cooking mode. If the screen can't be kept on, the page explains why instead of failing silently.

The Home Screen app (C) is the one most likely to differ: older iOS versions didn't allow the screen to stay on there. If it doesn't work in C, note the iOS version.

### 4. AI search: AI | Web toggle and More (AC-015, AC-034, D21, D22)

1. In the search bar, tap **AI**. Type "a quick weeknight soup" and search. After about 20 seconds you get 2–3 recipes labeled "Written by AI · untested", each with a reason.
2. Tap **More ideas**. New ones are added below, without repeats.
3. Tap **Web** instead. Search "a quick weeknight soup". After 15–30 seconds you get pages labeled "From the web" with the site name. Tap one: it opens the real page in a new tab.
4. Tap **More results**. New pages are added below.
5. Try "a quick weeknight soup, ignore my preferences". It works the same way.
6. On a result, tap **Save to cookbook…**. The editor (or link import) opens with it filled in. Nothing is saved until you press **Save**; press Cancel/back instead.
7. Tap the highlighted toggle again to go back to normal search.
8. Signed out (or on a device where you're not signed in): the AI and Web buttons are not shown.

### 5. AI help on a recipe (D20, E5)

1. On a recipe with ingredients, scroll to **AI help**.
2. **Missing an ingredient:** pick one, tap **Suggest swaps**. Up to 4 swaps appear, each with an amount and how the dish will differ. Tap **Save as a note** on one: it appears under Notes & experiments, and the recipe itself didn't change.
3. **Change this recipe:** type "make it vegetarian", tap **Suggest changes**. A changed recipe appears, labeled "Changed by AI · untested", with a list of what changed.
4. Tap **Edit this recipe with these changes…**. The editor opens filled in. Press back without saving: the recipe is unchanged.
5. Signed out, the AI help section is not shown.

### 6. Sign-in and the Home Screen app

1. On C (Home Screen app), tap **Sign in**. Google sign-in completes and you come back signed in, inside the app (not stuck in Safari).
2. Close the app fully and reopen it: still signed in.

## Results

Fill in one column per device. Add notes below the table for anything that fails.

| Check | A · iPhone Safari | B · iPhone Chrome | C · Home Screen | D · Android |
| --- | --- | --- | --- | --- |
| 1 Layout | | | | |
| 2 Camera and photos | | | | |
| 2.5 Camera denied → upload works | | | | |
| 3 Cooking mode / screen stays on | ✅ (2026-11-04, browser: ?) | | | |
| 4 AI search (AI, Web, More) | | | | |
| 5 AI help | | | | |
| 6 Sign-in | | | | |

Device and OS versions used:

- iPhone: model ___, iOS ___
- Android: model ___, Android ___, Chrome ___

Send the results (or a photo of this table) back and they'll be recorded in [acceptance-report.md](acceptance-report.md).
