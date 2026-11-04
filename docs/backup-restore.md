# Backup and restore

The cookbook keeps three layers of protection. They cover different problems:

| Problem | What protects you | How far back |
| --- | --- | --- |
| A bad edit to one recipe (yours or an AI tool's) | **Version history** on the recipe: open *View history*, pick a version, *Restore this version* | Every saved version, forever |
| A recipe deleted by mistake | **Deleted recipes** page: *Restore* | Forever (deleted recipes are kept, D6) |
| The whole database damaged or lost | **Full backup** you downloaded, or **D1 Time Travel** | Your last downloaded backup; Time Travel covers the last 7 days on the free plan |

## Download a full backup

Signed in as an admin: footer → **Backup** → **Download full backup**. Your browser downloads `cookbook-backup-YYYY-MM-DD.zip` containing:

- `backup.json`: every recipe and idea (including deleted ones), their full version history, experiment notes, tags, collections, feedback markers (favorite, want to try, and each dated "made"), and photo records (including the credit line of photos found with **Find a photo**)
- `photos/`: every photo at full size and as a thumbnail

Not included, on purpose: admin sign-ins and AI-tool connections. After a restore you sign in with Google again and reconnect ChatGPT and Claude.ai.

The browser builds the zip from the cookbook's data and photos, so the download works within the Workers free plan. Backups are only made when you press the button (D7), so download one regularly and keep it somewhere outside Cloudflare (a computer or cloud drive).

## Restore a backup

Restore only works into an **empty** cookbook, such as a fresh installation, so it can never overwrite recipes. Recipes, IDs, history, notes, feedback markers, deleted recipes and photos come back exactly as they were (backups made before markers existed simply restore without them); the search index rebuilds automatically.

1. Set up an empty cookbook: a new Cloudflare deployment with a new D1 database and R2 bucket (see [deployment.md](deployment.md)), or the Node/Docker host.
2. Sign in as an admin, open footer → **Backup**, choose the zip file and press **Restore backup**.
3. If the restore stops partway (connection lost, tab closed), run it again with the same file. It skips what is already there and continues; it still refuses if the cookbook contains anything that isn't from this backup.
4. Reconnect your AI tools.

The same steps move the cookbook to another host: download on the old one, restore on the new one.

## Recovery limits

- **Changes after your last downloaded backup** are not in it. If the D1 database itself is lost, those changes can only come back through D1 Time Travel (up to 7 days on the free plan; see deployment.md). There is no automatic off-site backup (D7).
- **Photos** live in R2, which has no point-in-time restore. Photos are never deleted by the app, so the risk is the bucket itself being deleted or damaged; your downloaded backup is the protection.
- A backup made by a newer version of the cookbook may not restore into an older version; restore into the same or a newer version.
- `wrangler d1 export` can't export this database (the search index is a virtual table), so use the app's backup instead.

## Verified

- Automated: a backup from one instance restored into a fresh, empty instance, with the same IDs, history, notes, deleted entries, photos and search (tests/server/m3.test.ts and tests/server/m6.test.ts for feedback markers, and the browser test in tests/e2e/m3.spec.ts that downloads the zip from one running instance and restores it into a second).
- Cloudflare build in local workerd with D1 and R2: backup export, and restore refused on a non-empty cookbook.
