import { defineConfig, devices } from "@playwright/test";

// Browser checks for layout, accessibility, themes and the admin flow.
// Runs the Node build against a throwaway SQLite database in .e2e/.
const PORT = 3100;
export const E2E = {
  baseURL: `http://localhost:${PORT}`,
  adminEmail: "admin@example.com",
  secret: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
  dir: ".e2e",
  /** A second, empty instance used as the restore target for backups (AC-041). */
  fresh: { baseURL: "http://localhost:3101", dir: ".e2e-fresh" },
};

const serverEnv = (baseURL: string, dir: string, port: number) => ({
  PORT: String(port),
  PUBLIC_BASE_URL: baseURL,
  ADMIN_EMAILS: E2E.adminEmail,
  BETTER_AUTH_SECRET: E2E.secret,
  GOOGLE_CLIENT_ID: "e2e",
  GOOGLE_CLIENT_SECRET: "e2e",
  DATABASE_PATH: `${dir}/cookbook.db`,
  MEDIA_DIR: `${dir}/media`,
  // The main instance talks to a local mock of the Claude API (no paid calls);
  // the fresh instance has no key, so it shows AI as not set up (AC-036).
  // The same mock stands in for the Pexels and Brave photo searches (E1).
  ...(port === PORT
    ? {
        ANTHROPIC_API_KEY: "mock-key",
        ANTHROPIC_BASE_URL: "http://localhost:3102",
        PEXELS_API_KEY: "mock-key",
        PEXELS_BASE_URL: "http://localhost:3102",
        BRAVE_SEARCH_API_KEY: "mock-key",
        BRAVE_SEARCH_BASE_URL: "http://localhost:3102",
      }
    : {}),
});

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: E2E.baseURL, trace: "retain-on-failure" },
  webServer: [
    {
      command: "node tests/e2e/mock-anthropic.mjs",
      url: "http://localhost:3102/health",
      reuseExistingServer: false,
    },
    {
      command: `rm -rf ${E2E.dir} ${E2E.fresh.dir} && npm run build:node && node hosting/node/server.js`,
      url: `${E2E.baseURL}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: serverEnv(E2E.baseURL, E2E.dir, PORT),
    },
    {
      // Waits for the first server's build, then starts an empty instance.
      command: `until [ -f build/server/index.js ] && curl -sf ${E2E.baseURL}/health > /dev/null; do sleep 1; done; node hosting/node/server.js`,
      url: `${E2E.fresh.baseURL}/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: serverEnv(E2E.fresh.baseURL, E2E.fresh.dir, 3101),
    },
  ],
  projects: [
    { name: "setup", testMatch: /seed\.setup\.ts/ },
    { name: "phone-chromium", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, dependencies: ["setup"] },
    { name: "phone-webkit", use: { ...devices["iPhone 14"] }, dependencies: ["setup"] },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } }, dependencies: ["setup"] },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, dependencies: ["setup"] },
  ],
});
