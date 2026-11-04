# Deployment

How to deploy the cookbook to Cloudflare (primary host) and to the Node/Docker alternative host. Configuration values live in the environment, never in code. Nothing here requires a paid plan; R2 may ask for a payment method on file before it can be enabled.

## Configuration reference

| Name | Kind | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | var | Public origin, e.g. `https://cookbook.chrisandelissa.com` (no trailing slash) |
| `ADMIN_EMAILS` | secret on Cloudflare (keeps emails out of this public repo); env var on Node | Comma-separated admin Google emails (one or two, D5) |
| `BETTER_AUTH_SECRET` | secret | At least 32 random characters: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | secret | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client secret |
| `ANTHROPIC_API_KEY` | secret, optional | Claude API key for in-app AI (imports, ingredient identification, "Check with AI"). Without it those features say they aren't set up; everything else works |
| `ANTHROPIC_MODEL` | var, optional | Claude model for in-app AI. Default `claude-opus-5-5` |
| `ANTHROPIC_BASE_URL` | var, optional | Only for an API gateway or proxy (the browser tests point it at a local mock). Leave unset |
| `PIXABAY_API_KEY` | secret, optional | Free stock photos for **Find a photo** (E1). Free key from pixabay.com/api/docs (shown when signed in). Without it, stock search is off |
| `BRAVE_SEARCH_API_KEY` | secret, optional | Web image search for **Find a photo** (E1), results labeled "from the web". Brave Search API key (about $5/month of free credit; card required). Without it, web search is off |
| `CLIENT_IP_HEADER` | var, optional | Trusted client-IP header for auth rate limiting. Default `cf-connecting-ip` on Cloudflare, `x-forwarded-for` on Node |
| `DATABASE_PATH`, `MEDIA_DIR`, `PORT` | var, Node only | SQLite file, photo folder, and port (defaults in the Dockerfile) |

## 1. Google sign-in (one time)

1. In Google Cloud Console, create a project, configure the OAuth consent screen (External; app name "Cookbook"), and add the admin emails as test users while the app is in testing.
2. Create an **OAuth client ID** of type **Web application** with:
   - Authorized JavaScript origin: `https://cookbook.chrisandelissa.com`
   - Authorized redirect URI: `https://cookbook.chrisandelissa.com/api/auth/callback/google`
   - For local development, also add `http://localhost:5173` and `http://localhost:5173/api/auth/callback/google`.
3. Keep the client ID and secret for step 2.

The app also enforces `ADMIN_EMAILS` on the server, so publishing the consent screen later does not open sign-in to other accounts.

## 2. Cloudflare (primary host)

Prerequisite: `chrisandelissa.com` is an active zone in your Cloudflare account.

```sh
npx wrangler login
npx wrangler d1 create cookbook          # copy the printed database_id
npx wrangler r2 bucket create cookbook-media
```

The Worker is named **`cookbook-site`** (the `name` in [wrangler.jsonc](../hosting/cloudflare/wrangler.jsonc), matching the dashboard). Commands below pass `--name cookbook-site` so they can never touch another Worker in the account.

1. In [hosting/cloudflare/wrangler.jsonc](../hosting/cloudflare/wrangler.jsonc), set `database_id`.
2. Set secrets (each `put` prompts for the value; `secret list` shows names only):
   ```sh
   npx wrangler secret put ADMIN_EMAILS --name cookbook-site
   npx wrangler secret put GOOGLE_CLIENT_ID --name cookbook-site
   npx wrangler secret put GOOGLE_CLIENT_SECRET --name cookbook-site
   openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET --name cookbook-site
   npx wrangler secret put ANTHROPIC_API_KEY --name cookbook-site   # optional: in-app AI (M5)
   npx wrangler secret put PIXABAY_API_KEY --name cookbook-site     # optional: stock photos for Find a photo (E1)
   npx wrangler secret put BRAVE_SEARCH_API_KEY --name cookbook-site  # optional: web photos for Find a photo (E1)
   npx wrangler secret list --name cookbook-site
   ```
3. Apply database migrations and deploy:
   ```sh
   npm run db:migrate:remote
   npm run deploy
   ```
4. Check `https://cookbook.chrisandelissa.com/health` — expect `{"ok":true,"host":"cloudflare",...}`.

The custom domain route in `wrangler.jsonc` creates the DNS record and certificate on first deploy.

### GitHub builds (Workers Builds)

The Worker is connected to this repository in **Workers & Pages → cookbook-site → Settings → Build**, which has two tabs:

| Tab | Field | Value |
| --- | --- | --- |
| Production | Production branch | `main` |
| Production | Build command | `npm run build` |
| Production | Deploy command | `npm run deploy:ci` |
| Previews Base | Builds for Preview branches | On |
| Previews Base | Build command | `npm run build` |
| Previews Base | Preview command | `echo "Build-only check: previews are not deployed"` |

The build token selected under **API token** needs **D1: Edit** permission (in addition to Workers permissions) so production deploys can apply migrations.

**Production (merges to `main`):** `npm run deploy:ci` applies any new database migrations to the production `cookbook` database, then deploys the Worker. If a migration fails, the deploy stops and the previous version keeps running.

**Pull request branches:** build-only checks. They confirm the app builds and deploy nothing; Preview URLs stay disabled. The default preview command (`npx wrangler preview`) would fail, because Wrangler refuses to upload a preview unless `wrangler.jsonc` has a `previews` block naming preview-only resources, so previews never touch the production database or `cookbook-media` bucket. Google sign-in also cannot work on preview URLs, because each one is different and Google OAuth does not accept wildcard redirect URIs. If live previews become useful, add a `previews` block with a separate D1 database and R2 bucket and restore the preview command.

### Database migrations

The code and the database deploy separately: merging updates the code, and **migrations** (the SQL files in `db/migrations/`) add the tables and indexes new code needs. `npm run deploy:ci` applies them automatically before each production deploy. Migrations only add tables, columns and indexes, so the version already running keeps working on the newer schema while a deploy is in progress.

To apply them by hand (for example after deploying from your machine with `npm run deploy`):

```sh
npm run db:migrate:remote
```

Note: `wrangler d1 export` cannot export databases that contain virtual tables, and the catalog's full-text index (`recipes_fts`) is one. Use D1 Time Travel for point-in-time recovery; the app's own backup (Settings → Admin tools → Backup; see backup-restore.md) covers full exports.

### Measure CPU time on the free plan (M0)

The free plan allows about 10 ms of CPU per request (waiting on the database or network does not count). After deploying:

1. Make a few requests of each kind: load `/`, sign in, and connect an AI tool (section 4) and call `ping`.
2. In the Cloudflare dashboard, open **Workers & Pages → cookbook-site → Metrics** and read **CPU time** (median and P99). Alternatively run `npx wrangler tail cookbook-site --format json` while making requests and read each event's CPU time.
3. Record the results in [implementation-plan.md](implementation-plan.md) under M0 status. Local Node measurements are not a reliable proxy: they read about 10× lower than production. Measured production medians on 2026-11-03 were 11–34 ms.

### Confirm D1 Time Travel restore (M0)

The database is named `cookbook` (separate from the Worker name):

```sh
npx wrangler d1 time-travel info cookbook                      # note the current bookmark/timestamp
npx wrangler d1 time-travel restore cookbook --timestamp=<ISO time a few minutes ago>
```

Do this before any real recipes exist. Time Travel keeps 7 days of history on the free plan.

## 3. Alternative host: Node + SQLite (Docker)

```sh
docker build -f hosting/node/Dockerfile -t cookbook .
docker run -d -p 3000:3000 -v cookbook-data:/data \
  -e PUBLIC_BASE_URL=https://<your-alt-host> \
  -e ADMIN_EMAILS=... -e BETTER_AUTH_SECRET=... \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  -e ANTHROPIC_API_KEY=... \
  cookbook
```

The container applies database migrations on startup and stores the SQLite database and photos in the `/data` volume. Any host that runs a Docker image with a persistent volume works (for example Fly.io or Render). Behind a proxy, set `CLIENT_IP_HEADER` to the header that proxy sets. Add the alternative host's callback URL to the Google OAuth client.

Without Docker: `npm ci && npm run build:node && npm run start:node`.

Back up the `/data` volume (or download the app's backup) regularly: on this host there is no D1 Time Travel.

### Move the cookbook to the alternative host

1. Deploy the container as above on the new host, with a persistent volume and a public HTTPS address.
2. In Google Cloud Console, add the new address to the OAuth client: JavaScript origin `https://<new-host>` and redirect URI `https://<new-host>/api/auth/callback/google`.
3. On the old site: approve or reject anything waiting in **Review** (waiting items are not in the backup), then **Settings → Admin tools → Backup → Download full backup**.
4. On the new site: sign in, open **Settings → Admin tools → Backup**, and restore the zip.
5. Set the approval setting in Settings, create new API keys if you use any, and reconnect ChatGPT and Claude.ai to `https://<new-host>/mcp`.
6. To keep the same address, point the `cookbook.chrisandelissa.com` DNS record at the new host, set `PUBLIC_BASE_URL` to it, and remove the custom domain route from the Worker.

### What was verified (M8)

`npm run verify:docker` builds the Docker image and runs it twice on this machine (ports 3200 and 3201). It checks health, public pages with noindex, `robots.txt`, search and signed-out refusals, then moves a sample cookbook (recipes, versions, notes, a deleted idea, tags, a collection, a photo, markers and a preference) from the first container to the second, empty one using the app's own backup and restore code. Every backed-up table and the photo bytes match. It removes its containers and files afterwards.

Not verified: a deployment to a real cloud host such as Fly.io or Render. That needs an account (and possibly a card) and is left for the owner to approve. Google sign-in on the alternative host also needs the step 2 callback, so it can only be checked on a real address.

## Provider dependencies

What each outside service does, what breaks without it, and how to replace it. App logic in `server/core/` depends on none of them directly (a lint rule enforces this, AC-038).

| Provider | Used for | Where in the code | If it goes away | Replacement steps |
| --- | --- | --- | --- | --- |
| **Cloudflare Workers** | Runs the site | `hosting/cloudflare/worker.ts`, `wrangler.jsonc` | Site is down | Run the Node/Docker host (section 3) on any container host. Same app code; only the entry file differs |
| **Cloudflare D1** | Database (SQLite) | `server/adapters/` through Drizzle; `db/migrations/` | Data unreachable | Restore your backup into the Node host, which uses a SQLite file with the same schema and migrations. Any SQLite-compatible store works with a new Drizzle driver in a host entry file |
| **Cloudflare R2** | Photo files | `MediaStore` interface; R2 binding in the Worker | Photos missing | The Node host stores photos on disk (`hosting/node/fs-media.ts`). For S3-compatible storage (S3, Backblaze B2, MinIO), write a small `MediaStore` adapter (put, get, delete, ping); nothing else changes. The backup zip carries every photo |
| **Cloudflare DNS** | `chrisandelissa.com` zone and the custom-domain route | Cloudflare dashboard | Address stops resolving | Move the zone to another DNS provider and point the record at the new host |
| **Workers Builds** | Deploys on merge to `main` and applies migrations | Cloudflare dashboard (`npm run deploy:ci`) | No automatic deploys | Deploy by hand (`npm run db:migrate:remote && npm run deploy`) or from any CI with a Cloudflare API token |
| **Google sign-in** | Admin sign-in | Better Auth (`server/auth/`) | Admins can't sign in; public browsing still works | Better Auth supports other sign-in providers (for example GitHub or a magic link); add one in `server/auth/` and keep the `ADMIN_EMAILS` check |
| **Anthropic (Claude API)** | All in-app AI | `server/ai/anthropic.ts`, behind the `RecipeAi` interface in `server/core/ai.ts` | AI buttons say AI isn't set up; everything else works (AC-036) | Another model provider needs a new `RecipeAi` adapter. AI search's Web mode also needs a web-search tool from that provider |
| **Pixabay**, **Brave Search** | Find a photo (optional) | `server/importers/` | Those photo sources switch off | Leave unset, or replace with another image API in the photo finder |
| **ChatGPT, Claude.ai** | Send recipes in through MCP | `server/mcp/`, `server/api-v1.ts` | Nothing in the site breaks | Any MCP client or plain HTTP client works (see [integration.md](integration.md)) |

D1 Time Travel is the one Cloudflare-only safety net: on another host, your downloaded backups (and volume snapshots, if the host offers them) replace it.

## 4. Connect ChatGPT and Claude.ai

The MCP server URL is `https://cookbook.chrisandelissa.com/mcp`. Connecting, the available tools, the HTTP API, API keys and revoking access are covered in [integration.md](integration.md).

Note: the M0 `ping` tool was replaced in M4 by the real tools (`search_recipes`, `get_recipe`, `submit_recipe`, `update_recipe`, `get_submission_status`). Existing connections keep working; the AI app picks up the new tool list automatically, or after you refresh the connector.

## Local development

```sh
npm install
cp hosting/cloudflare/.dev.vars.example hosting/cloudflare/.dev.vars   # then fill it in
npm run db:migrate:local
npm run dev                # http://localhost:5173 in the Cloudflare runtime (workerd)
npm run check              # typecheck, lint, unit and integration tests
npm run test:e2e           # browser checks: layout at phone/tablet/desktop, accessibility, themes, admin flow
ANTHROPIC_API_KEY=sk-ant-... npm run smoke:ai   # live Claude check (a few cents); not part of check or test:e2e
```

Automated tests never call Claude: server tests use a fake, and browser tests run the real adapter against a local mock of the API (`tests/e2e/mock-anthropic.mjs`).

### In-app AI (M5)

- Admin-only. The admin check runs before any page fetch or Claude call, so visitors, search and public pages never cost anything.
- Model: `claude-opus-5-5` by default (`ANTHROPIC_MODEL` to change). Refusal fallbacks are on (`fallbacks: "default"`): if the model declines a request, the API retries it once on its default fallback model.
- Link import reads the page's own schema.org recipe data first (free). Claude is used only when a page has none.
- Link fetching refuses private and local addresses, re-checks every redirect, and stops at 3 MB or 15 seconds.
- Photos sent for identification or import are resized in the browser first. They're only kept if you choose "Also add this photo to the recipe".

`test:e2e` builds the Node host and runs it on port 3100 against a throwaway database in `.e2e/`. The first run needs browsers: `npx playwright install chromium webkit`.

Use npm 11 or newer (`npx npm@11 install` works if your global npm is older).
