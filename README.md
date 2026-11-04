# 540 Kitchen

A personal recipe collection at cookbook.chrisandelissa.com: public to browse, with Google sign-in for admins, in-app Claude imports (paste, link, photo) and ingredient identification, and an MCP connector so ChatGPT and Claude.ai can submit recipes.

- Requirements: [docs/requirements/](docs/requirements/README.md)
- Plan and milestone status: [docs/implementation-plan.md](docs/implementation-plan.md)
- Deployment and connector setup: [docs/deployment.md](docs/deployment.md)
- Backup and restore: [docs/backup-restore.md](docs/backup-restore.md)
- Connecting AI tools (MCP, HTTP API, API keys): [docs/integration.md](docs/integration.md)

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server in the Cloudflare runtime (needs `hosting/cloudflare/.dev.vars`) |
| `npm run check` | Typecheck, lint (including the core-isolation rule), and tests |
| `npm run test:e2e` | Browser checks (Playwright): layout at phone/tablet/desktop, accessibility in both themes, admin flow |
| `npm run smoke:ai` | Live check against the real Claude API (needs `ANTHROPIC_API_KEY`; costs a few cents) |
| `npm run build` / `npm run deploy` | Build / deploy the Cloudflare Worker from your machine (does not migrate) |
| `npm run deploy:ci` | Production deploy used by Cloudflare builds: applies database migrations, then deploys |
| `npm run build:node` / `npm run start:node` | Build / run the Node alternative host |
| `npm run db:generate` | Create a migration after changing `server/db/` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations to local / production D1 |
| `npm run auth:schema` | Regenerate Better Auth tables after changing auth plugins |

## Layout

```
app/        UI routes (React Router)
server/     core/ (business rules, no host or framework code), ai/ (Claude), importers/, auth/, mcp/, adapters/, db/
hosting/    cloudflare/ (Worker entry, wrangler config) and node/ (server, Dockerfile)
db/         SQL migrations shared by both hosts
tests/      unit and integration tests
```
