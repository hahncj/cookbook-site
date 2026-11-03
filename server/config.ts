import { z } from "zod";
import { parseAdminEmails } from "./core/admin";

// All deployment-specific values come from the environment, never from code.
const envSchema = z.object({
  PUBLIC_BASE_URL: z.url(),
  ADMIN_EMAILS: z.string().min(1, "ADMIN_EMAILS must list at least one admin Google email"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // Header carrying the real client IP (for auth rate limiting). Cloudflare
  // always sets cf-connecting-ip; Node hosts behind a proxy usually set
  // x-forwarded-for. Only set this to a header your proxy controls.
  CLIENT_IP_HEADER: z.string().optional(),
});

export interface AppConfig {
  /** Public origin without a trailing slash, e.g. https://cookbook.chrisandelissa.com */
  baseUrl: string;
  adminEmails: string[];
  authSecret: string;
  google: { clientId: string; clientSecret: string };
  /** Which host adapter is running; reported by /health. */
  host: "cloudflare" | "node";
  /** Trusted header(s) holding the client IP. */
  clientIpHeaders: string[];
}

export function loadConfig(env: Record<string, unknown>, host: AppConfig["host"]): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  const values = parsed.data;
  return {
    baseUrl: values.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    adminEmails: parseAdminEmails(values.ADMIN_EMAILS),
    authSecret: values.BETTER_AUTH_SECRET,
    google: { clientId: values.GOOGLE_CLIENT_ID, clientSecret: values.GOOGLE_CLIENT_SECRET },
    host,
    clientIpHeaders: [values.CLIENT_IP_HEADER ?? (host === "cloudflare" ? "cf-connecting-ip" : "x-forwarded-for")],
  };
}
