import { defineConfig, devices } from '@playwright/test';

/** Frontend gates F1-F11 plus the E1/E2 journeys.
 *
 * Servers are started automatically when they are not already running, so
 * `npx playwright test` works from a cold start as well as alongside ./run.sh.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './tests/test-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.spec\.js/,
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
      testMatch: /responsive\.spec\.js/,
    },
  ],
  webServer: [
    {
      command: './venv/bin/python -m uvicorn Dashboard.backend.main:app --host 127.0.0.1 --port 8000',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      // The backend loads the repo-root .env, so once real Google credentials
      // live there sign-in switches on and every gate below stops at a login
      // screen it cannot get past. Blanking these keeps the gates testing the
      // dashboard; the sign-in flow itself is covered by tests/backend/test_auth.py
      // and, for the React side, by the stubbed /api/auth/me gates in auth.spec.js.
      // Empty values also win over .env, which only fills names that are unset.
      env: { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', UCXP_REQUIRE_AUTH: '' },
    },
    {
      command: 'npm --prefix Dashboard/frontend run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
