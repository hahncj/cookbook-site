# Backup and restore

The cookbook keeps three layers of protection. They cover different problems:

| Problem | What protects you | How far back |
| --- | --- | --- |
| A bad edit to one recipe (yours or an AI tool's) | **Version history** on the recipe: open *View history*, pick a version, *Restore this version* | Every saved version, forever |
| A recipe deleted by mistake | **Deleted recipes** page: *Restore* | Forever (deleted recipes are kept, D6) |
| The whole database damaged or lost | **Full backup** you downloaded, or **D1 Time Travel** | Your last downloaded backup; Time Travel covers the last 7 days on the free plan |

## Download a full backup

Signed in as an admin: **Settings → Admin tools → Backup** → **Download full backup**. Your browser downloads `cookbook-backup-YYYY-MM-DD.zip` containing:

- `backup.json`: every recipe and idea (including deleted ones), their full version history, experiment notes, tags, collections, feedback markers (favorite, want to try, and each dated "made"), the preference profile (including your corrections and rejected items) and its refresh log, and photo records (including the credit line of photos found with **Find a photo**)
- `photos/`: every photo at full size and as a thumbnail

Not included:

- Admin sign-ins, AI-app connections and API keys (on purpose: they are credentials). After a restore you sign in with Google again, reconnect ChatGPT and Claude.ai, and create new API keys.
- **Submissions waiting in Review** (and rejected ones), and the **approval setting**. Approve or reject anything waiting before you move, then set approval again on the new site (it starts on). This is a known gap against AC-041; see [acceptance-report.md](acceptance-report.md).

The browser builds the zip from the cookbook's data and photos, so the download works within the Workers free plan. Backups are only made when you press the button (D7), so download one regularly and keep it somewhere outside Cloudflare (a computer or cloud drive).

## Restore a backup

Restore only works into an **empty** cookbook, such as a fresh installation, so it can never overwrite recipes. Recipes, IDs, history, notes, feedback markers, deleted recipes and photos come back exactly as they were (backups made before markers existed simply restore without them); the search index rebuilds automatically.

1. Set up an empty cookbook: a new Cloudflare deployment with a new D1 database and R2 bucket (see [deployment.md](deployment.md)), or the Node/Docker host.
2. Sign in as an admin, open **Settings → Admin tools → Backup**, choose the zip file and press **Restore backup**.
3. If the restore stops partway (connection lost, tab closed), run it again with the same file. It skips what is already there and continues; it still refuses if the cookbook contains anything that isn't from this backup.
4. Reconnect your AI tools, create new API keys if you use any, and check the approval setting in Settings.

The same steps move the cookbook to another host: download on the old one, restore on the new one.

## Recovery limits

- **Changes after your last downloaded backup** are not in it. If the D1 database itself is lost, those changes can only come back through D1 Time Travel (up to 7 days on the free plan; see deployment.md). There is no automatic off-site backup (D7).
- **Photos** live in R2, which has no point-in-time restore. Photos are never deleted by the app, so the risk is the bucket itself being deleted or damaged; your downloaded backup is the protection.
- A backup made by a newer version of the cookbook may not restore into an older version; restore into the same or a newer version.
- `wrangler d1 export` can't export this database (the search index is a virtual table), so use the app's backup instead.

## Verified

- Automated: a backup from one instance restored into a fresh, empty instance, with the same IDs, history, notes, deleted entries, photos and search (tests/server/m3.test.ts and tests/server/m6.test.ts for feedback markers, and the browser test in tests/e2e/m3.spec.ts that downloads the zip from one running instance and restores it into a second).
- Cloudflare build in local workerd with D1 and R2: backup export, and restore refused on a non-empty cookbook.
- Node + SQLite in Docker (M8, `npm run verify:docker`): the real Docker image run as two containers; a backup made from the first with the browser's own backup code restored into the second, empty one. Every backed-up table matched row by row (including versions, notes, markers and the preference profile), the photo bytes matched, search worked, and running the restore again added nothing.
