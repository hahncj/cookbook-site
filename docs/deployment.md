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

The Worker is connected to this repository in **Workers & Pages → cookbook-site → Settings → Build**:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Non-production branch builds | Enabled |
| Non-production branch deploy command | `npm run build` |

Pull request branches are **build-only checks**: they confirm the app builds and deploy nothing. Preview deploys are off on purpose. Wrangler refuses to upload a preview unless `wrangler.jsonc` has a `previews` block naming preview-only resources (so previews never touch the production `cookbook` database or `cookbook-media` bucket). Google sign-in also cannot work on preview URLs, because each one is different and Google OAuth does not accept wildcard redirect URIs. If live previews become useful, add a `previews` block with a separate D1 database and R2 bucket, then set the non-production deploy command back to `npx wrangler versions upload`.

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
  cookbook
```

The container applies database migrations on startup and stores the SQLite database and photos in the `/data` volume. Any host that runs a Docker image with a persistent volume works (for example Fly.io or Render). Behind a proxy, set `CLIENT_IP_HEADER` to the header that proxy sets. Add the alternative host's callback URL to the Google OAuth client.

Without Docker: `npm ci && npm run build:node && npm run start:node`.

## 4. Connect ChatGPT and Claude.ai (M0 connector check)

The MCP server URL is `https://cookbook.chrisandelissa.com/mcp`. It uses OAuth: you sign in with an admin Google account and approve the connection. M0 exposes one tool, `ping`, which returns `pong`.

- **Claude.ai:** Settings → Connectors → Add custom connector → enter the MCP server URL → Connect, then sign in and approve. In a new chat, ask Claude to call the cookbook `ping` tool.
- **ChatGPT:** custom MCP connectors require a plan that allows them and Developer mode enabled (Settings → Apps & Connectors → Advanced). Create a connector with the MCP server URL and OAuth authentication, sign in and approve, then ask ChatGPT to call `ping`.

Menu names change over time; if they differ, look for "custom connector" or "MCP server" in each app's settings. Revoking access: remove the connector in the AI app (token revocation in the cookbook UI arrives in M4).

## Local development

```sh
npm install
cp hosting/cloudflare/.dev.vars.example hosting/cloudflare/.dev.vars   # then fill it in
npm run db:migrate:local
npm run dev                # http://localhost:5173 in the Cloudflare runtime (workerd)
npm run check              # typecheck, lint, tests
```

Use npm 11 or newer (`npx npm@11 install` works if your global npm is older).
