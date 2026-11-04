import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createRouterContext } from "../../app/context";
import { loader as rootLoader } from "../../app/root";
import * as schema from "../../server/db/schema";
import { ADMIN_EMAIL, BASE_URL, createTestServices, sessionCookieFor } from "../helpers/services";

const get = (cookie?: string) => new Request(`${BASE_URL}/`, { headers: cookie ? { Cookie: cookie } : {} });

describe("top-bar account (E2)", () => {
  it("gives the signed-in viewer their Google profile picture, or none", async () => {
    const services = createTestServices();
    const args = (req: Request) => ({ request: req, params: {}, context: createRouterContext(services) }) as never;
    const cookie = await sessionCookieFor(services, ADMIN_EMAIL);

    expect((await rootLoader(args(get()))).viewer).toBeNull();
    expect((await rootLoader(args(get(cookie)))).viewer).toMatchObject({ email: ADMIN_EMAIL, name: "Someone", image: null, isAdmin: true });

    // Better Auth stores Google's `picture` claim as user.image at sign-in.
    const picture = "https://lh3.googleusercontent.com/a/example=s96-c";
    await services.db.update(schema.user).set({ image: picture }).where(eq(schema.user.email, ADMIN_EMAIL));
    expect((await rootLoader(args(get(cookie)))).viewer).toMatchObject({ image: picture });
  });

  it("keeps Google's name and picture fresh on each sign-in", () => {
    const services = createTestServices();
    expect(services.auth.options.socialProviders?.google).toMatchObject({ overrideUserInfoOnSignIn: true });
  });
});
