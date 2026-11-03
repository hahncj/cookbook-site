import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

// Same-origin client. The OAuth provider plugin forwards the signed OAuth
// query during sign-in and consent so connector flows resume automatically.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [oauthProviderClient()],
});
