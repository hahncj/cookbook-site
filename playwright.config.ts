import { defineConfig, devices } from "@playwright/test";

// Browser checks for layout, accessibility, themes and the admin flow.
// Runs the Node build against a throwaway SQLite database in .e2e/.
const PORT = 3100;
export const E2E = {
  baseURL: `http://localhost:${PORT}`,
  adminEmail: "admin@example.com",
  secret: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
  dir: ".e2e",
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: E2E.baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `rm -rf ${E2E.dir} && npm run build:node && node hosting/node/server.js`,
    url: `${E2E.baseURL}/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      PUBLIC_BASE_URL: E2E.baseURL,
      ADMIN_EMAILS: E2E.adminEmail,
      BETTER_AUTH_SECRET: E2E.secret,
      GOOGLE_CLIENT_ID: "e2e",
      GOOGLE_CLIENT_SECRET: "e2e",
      DATABASE_PATH: `${E2E.dir}/cookbook.db`,
      MEDIA_DIR: `${E2E.dir}/media`,
    },
  },
  projects: [
    { name: "setup", testMatch: /seed\.setup\.ts/ },
    { name: "phone-chromium", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, dependencies: ["setup"] },
    { name: "phone-webkit", use: { ...devices["iPhone 14"] }, dependencies: ["setup"] },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } }, dependencies: ["setup"] },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, dependencies: ["setup"] },
  ],
});
