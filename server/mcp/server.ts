import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Services } from "../app";
import { idempotencyKeySchema, noteSchema, toolChangesSchema, toolRecipeSchema, type Submitter } from "../core/submissions";
import { recipeForTools, summaryForTools } from "../integration";

export const MCP_SERVER_INFO = { name: "cookbook", version: "0.2.0" } as const;

const INSTRUCTIONS = `This is the owner's personal cookbook. Use it to save recipes and ideas from this conversation so they're kept in one place.
- Before adding a recipe, search to see if it already exists; if it does, send an update instead.
- Copy amounts exactly as written (e.g. "1½ tbsp"). Leave a quantity empty if it's unknown. Never invent missing quantities, times or steps.
- New recipes and updates usually wait for the owner's approval; tell the user that and share the status message you get back.
- To update, read the recipe first with get_recipe, then send only the fields you're changing along with its current revision.`;

function result(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
    isError,
  };
}

/** The cookbook's MCP server for one request, acting as `submitter`. */
export function createCookbookMcpServer(services: Services, submitter: Submitter): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { instructions: INSTRUCTIONS });
  const baseUrl = services.config.baseUrl;

  server.registerTool(
    "search_recipes",
    {
      title: "Search recipes",
      description:
        "Search the cookbook by words in titles, ingredients and notes, optionally filtered by tag. Returns 50 per page. Leave query empty to list everything (newest first).",
      inputSchema: {
        query: z.string().max(200).optional().describe("Words to search for, e.g. 'chili black beans'."),
        tag: z.string().max(60).optional().describe("Only entries with this tag."),
        page: z.number().int().min(1).max(1000).optional().describe("Page number, starting at 1."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, tag, page }) => {
      const found = await services.catalog.browse({ q: query ?? "", tag: tag ?? "", page: page ?? 1 });
      return result({
        total: found.total,
        page: found.page,
        pageCount: found.pageCount,
        recipes: found.items.map((item) => summaryForTools(item, baseUrl)),
      });
    },
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Get recipe",
      description: "Read one recipe or idea in full, including its current revision number (needed for update_recipe).",
      inputSchema: { recipe_id: z.string().max(64).describe("The recipe id from search_recipes.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ recipe_id }) => {
      const entry = await services.catalog.get(recipe_id);
      return entry ? result(recipeForTools(entry, baseUrl)) : result({ status: "not_found", message: "No recipe with that id." }, true);
    },
  );

  server.registerTool(
    "submit_recipe",
    {
      title: "Add a recipe",
      description:
        "Send a new recipe or food/drink idea to the cookbook. Usually it waits for the owner's approval. Include an idempotency_key you generate; resending with the same key never creates a duplicate.",
      inputSchema: { recipe: toolRecipeSchema, idempotency_key: idempotencyKeySchema, note: noteSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ recipe, idempotency_key, note }) => {
      const outcome = await services.submissions.submitNew(submitter, { recipe, idempotencyKey: idempotency_key, note });
      return result(outcome, outcome.status === "validation_failed");
    },
  );

  server.registerTool(
    "update_recipe",
    {
      title: "Update a recipe",
      description:
        "Send changes to an existing recipe. Include only the fields you're changing (lists such as ingredients, steps and tags replace the whole list). expected_revision must be the revision from get_recipe; if the recipe changed since, you'll get a conflict and should read it again. Usually waits for the owner's approval.",
      inputSchema: {
        recipe_id: z.string().max(64),
        expected_revision: z.number().int().min(1).describe("The revision you read with get_recipe."),
        changes: toolChangesSchema,
        idempotency_key: idempotencyKeySchema,
        note: noteSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ recipe_id, expected_revision, changes, idempotency_key, note }) => {
      const outcome = await services.submissions.submitUpdate(submitter, {
        recipeId: recipe_id,
        expectedRevision: expected_revision,
        changes,
        idempotencyKey: idempotency_key,
        note,
      });
      return result(outcome, outcome.status === "validation_failed" || outcome.status === "not_found");
    },
  );

  server.registerTool(
    "get_submission_status",
    {
      title: "Check a submission",
      description: "Check whether something you sent is still waiting, was saved, was rejected, or hit a conflict.",
      inputSchema: { submission_id: z.string().max(64) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ submission_id }) => {
      const status = await services.submissions.statusFor(submitter, submission_id);
      return status ? result(status) : result({ status: "not_found", message: "No submission with that id from this tool." }, true);
    },
  );

  return server;
}

/**
 * Web-standard MCP handler for one authenticated request. `legacy:
 * "stateless"` keeps 2025-era clients working alongside the 2026-07-28 protocol.
 */
export function createMcpRequestHandler(services: Services, submitter: Submitter) {
  return createMcpHandler(() => createCookbookMcpServer(services, submitter), { legacy: "stateless" });
}
