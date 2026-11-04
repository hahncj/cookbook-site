import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "../../server/app";
import { callTool, connectTool } from "../helpers/oauth";
import { ADMIN_EMAIL, createTestServices } from "../helpers/services";

let services: Services;
beforeEach(() => {
  services = createTestServices();
});

describe("MCP connector OAuth flow (D1)", () => {
  it("issues an access token for /mcp that the MCP endpoint accepts", async () => {
    const { accessToken } = await connectTool(services, { email: ADMIN_EMAIL });
    const result = await callTool(services, accessToken, "search_recipes", {});
    expect(result).toMatchObject({ httpStatus: 200, isError: false, data: { total: 0, recipes: [] } });
  });

  it("rejects a token issued for a different audience", async () => {
    const { accessToken } = await connectTool(services, { email: ADMIN_EMAIL, resource: null });
    expect((await callTool(services, accessToken, "search_recipes", {})).httpStatus).toBe(401);
  });
});
