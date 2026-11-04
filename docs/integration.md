# Connecting AI tools

Any AI tool that speaks **MCP** (Model Context Protocol) or plain **HTTP** can add recipes to the cookbook and propose changes. Nothing is specific to Claude. By default everything a tool sends waits for an admin's approval in **Review**; tools can never approve their own submissions, delete recipes, or change settings.

| | URL |
| --- | --- |
| MCP server | `https://cookbook.chrisandelissa.com/mcp` |
| HTTP API | `https://cookbook.chrisandelissa.com/api/v1` |

## Connecting

### ChatGPT and Claude.ai (OAuth)

Add a custom connector with the MCP server URL. The app opens the cookbook's sign-in: sign in with an admin Google account and press **Allow**. The connection acts on behalf of that admin.

- **Claude.ai:** Settings → Connectors → Add custom connector.
- **ChatGPT:** needs a plan that allows custom connectors and Developer mode (Settings → Apps & Connectors → Advanced); create a connector with the URL and OAuth authentication.

Menu names change over time; look for "custom connector" or "MCP server".

### Claude Code, scripts and other tools (API key)

Create a key in **Settings → API keys** (it's shown once; store it in the tool's secret settings). Send it as `Authorization: Bearer ck_…`. Keys work with both the MCP server and the HTTP API.

Claude Code example:

```sh
claude mcp add --transport http cookbook https://cookbook.chrisandelissa.com/mcp \
  --header "Authorization: Bearer ck_your_key_here"
```

### Revoking access

- **Settings → Connected AI apps → Disconnect**: the app stops working immediately (its existing tokens are refused). It can be connected again later through the normal sign-in and Allow screen.
- **Settings → API keys → Revoke**: the key stops working immediately.
- Removing someone from `ADMIN_EMAILS` also cuts off every tool connected under their account.

## How submissions work

1. The tool sends a new recipe, or an update to an existing one.
2. With **approval on** (the default), it waits in **Review**. The catalog doesn't change and the submission isn't public.
3. The admin approves (it's saved, and appears in the recipe's history as "Changed by an AI tool") or rejects (nothing changes).
4. With **approval off** (**Settings → Approval for AI tools**), valid submissions save immediately. Turning approval off doesn't apply anything already waiting.

Rules both interfaces enforce:

- **Validation:** the same rules as the editor. A title is required; everything else is optional. Ideas can be just a title.
- **Never invented:** amounts are stored exactly as sent; tools should leave unknown amounts empty.
- **Retries are safe:** every submission carries an idempotency key (a unique id the tool generates, such as a UUID). Sending the same key again returns the original result instead of creating a duplicate.
- **Updates are partial and revision-checked:** send only the fields you're changing, plus the revision you read. Lists you send (ingredients, steps, tags) replace the whole list; fields you leave out are kept, as are photos and collections. If the recipe has changed since that revision, you get a **conflict** and nothing is stored; read it again and resend.
- **Approval-time conflicts:** if the owner edits a recipe after an update was submitted, approving it reports a conflict instead of overwriting the edit.

Statuses a tool can see: `pending`, `applied`, `rejected`, `conflict`, `validation_failed`, `not_found`.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `search_recipes` | `{ query?, tag?, page? }`: matching recipes, 50 per page |
| `get_recipe` | `{ recipe_id }`: one recipe in full, including `revision` |
| `submit_recipe` | `{ recipe, idempotency_key, note? }`: add a recipe or idea |
| `update_recipe` | `{ recipe_id, expected_revision, changes, idempotency_key, note? }`: propose changes |
| `get_submission_status` | `{ submission_id }`: what happened to a submission (only your own) |

The server also sends instructions telling the AI to search before adding, to copy amounts exactly, and to tell the user when something is waiting for approval.

## Recipe fields

Used for submitting and returned when reading (reads add `id`, `revision`, `url`, `collections`, `photoCount` and `updatedAt`):

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `"recipe"` or `"idea"` | Default `"recipe"` |
| `title` | string | Required |
| `description`, `notes` | string or null | |
| `servings` | string or null | As written, e.g. `"Serves 4"` |
| `prepTime`, `cookTime` | string or null | e.g. `"10 min"` |
| `ingredients` | `[{ "quantity": string, "item": string }]` | `quantity` exactly as written, `""` if unknown |
| `steps` | `[string]` | In order |
| `sourceUrl`, `sourceName` | string or null | |
| `tags` | `[string]` | |

## HTTP API

All requests need `Authorization: Bearer <API key or OAuth access token>`. Responses are JSON.

| Request | Purpose | Success status |
| --- | --- | --- |
| `GET /api/v1/recipes?query=&tag=&page=` | Search or list | 200 |
| `GET /api/v1/recipes/{id}` | Read one | 200 |
| `POST /api/v1/recipes` | Submit a new recipe: body `{ "recipe": {…}, "note"?: "…" }` | 202 pending, 201 applied |
| `POST /api/v1/recipes/{id}/updates` | Submit changes: body `{ "expectedRevision": 3, "changes": {…}, "note"?: "…" }` | 202 pending, 201 applied |
| `GET /api/v1/submissions/{id}` | Check a submission | 200 |

`POST` requests need an `Idempotency-Key` header (8–100 letters, digits, `.`, `_`, `:` or `-`; a UUID works). Errors: 401 bad credentials, 404 unknown recipe/submission/route, 409 conflict (body includes `currentRevision`), 413 body over 256 KB, 422 validation failed (body includes `message` and field `errors`).

Example: submit a recipe.

```sh
curl https://cookbook.chrisandelissa.com/api/v1/recipes \
  -H "Authorization: Bearer ck_your_key_here" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6f1c2a9e-1b7d-4c2e-9a51-0d7c3f2b8e44" \
  -d '{
        "recipe": {
          "title": "Weeknight Black Bean Chili",
          "servings": "Serves 6",
          "ingredients": [{ "quantity": "2 cans", "item": "black beans" }, { "quantity": "", "item": "salt, to taste" }],
          "steps": ["Simmer everything for 30 minutes."],
          "tags": ["Weeknight"]
        },
        "note": "From today's ChatGPT conversation"
      }'
```

Response (`202`):

```json
{
  "status": "pending",
  "submissionId": "2a6f…",
  "recipeId": null,
  "revision": null,
  "message": "Waiting for the cookbook owner to approve it. Nothing changes until they do."
}
```

Example: propose a change to one field.

```sh
curl https://cookbook.chrisandelissa.com/api/v1/recipes/RECIPE_ID/updates \
  -H "Authorization: Bearer ck_your_key_here" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 0c3e5d1a-honey-less" \
  -d '{ "expectedRevision": 3, "changes": { "notes": "Halve the honey next time." } }'
```

If the recipe is no longer at revision 3, the response is `409` with `"status": "conflict"` and the `currentRevision`.

More on approval and the in-app AI features: [ai-and-approval.md](ai-and-approval.md).

## Verified

- Every submission rule above runs in automated tests twice: over MCP with a real OAuth connector token and over the HTTP API with an API key, using plain HTTP requests rather than any Claude client (tests/server/m4.test.ts).
- Tools have no way to approve or change settings; tool credentials never count as an admin sign-in; revoked keys, disconnected apps and former admins are refused.
