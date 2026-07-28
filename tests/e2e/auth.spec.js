import { expect, test } from '@playwright/test';
import { assertNoConsoleErrors, watchConsole } from './helpers';

/* ==========================================================================
 * F12 — the sign-in gate in the React app
 *
 * The server these gates run against has sign-in switched off (see the
 * `env` block on the backend webServer in playwright.config.js), which is what
 * lets every other gate drive the dashboard directly. So the states below are
 * produced by intercepting `/api/auth/me` — the single call App.jsx's Gate
 * decides on. Nothing here contacts Google; the real exchange is covered by
 * tests/backend/test_auth.py.
 * ========================================================================== */

/** Answer /api/auth/me with `body` and let every other request through. */
async function stubWhoAmI(page, body) {
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  }));
}

const MERCHANT = {
  user: { email: 'shop@example.com', name: 'Shop', picture: '', is_admin: false },
  auth_enabled: true,
};

const ADMIN = {
  user: { email: 'boss@example.com', name: 'Boss', picture: '', is_admin: true },
  auth_enabled: true,
};

test('F12 signed out, sign-in enabled, only the login screen is reachable', async ({ page }) => {
  const errors = watchConsole(page);
  await stubWhoAmI(page, { user: null, auth_enabled: true });

  await page.goto('/');
  await expect(page.getByTestId('login-screen')).toBeVisible();
  await expect(page.getByTestId('google-signin')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toHaveCount(0);

  // A deep link is not a way around it.
  await page.goto('/admin');
  await expect(page.getByTestId('login-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Merchants' })).toHaveCount(0);

  assertNoConsoleErrors(errors);
});

test('F12 a failed sign-in comes back as a message, not a blank screen', async ({ page }) => {
  await stubWhoAmI(page, { user: null, auth_enabled: true });

  await page.goto('/?auth_error=That+Google+account+has+no+verified+email.');

  await expect(page.getByTestId('login-screen')).toBeVisible();
  await expect(page.getByText('That Google account has no verified email.')).toBeVisible();
  // The error is consumed, so a reload does not resurrect it.
  await expect(page).toHaveURL(/\/$/);
});

test('F12 a signed-in merchant gets the dashboard and no admin link', async ({ page }) => {
  const errors = watchConsole(page);
  await stubWhoAmI(page, MERCHANT);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible();
  await expect(page.getByTestId('account-chip')).toContainText('shop@example.com');
  await expect(page.getByTestId('admin-link')).toHaveCount(0);

  assertNoConsoleErrors(errors);
});

test('F12 a signed-in admin gets the admin link', async ({ page }) => {
  const errors = watchConsole(page);
  await stubWhoAmI(page, ADMIN);

  await page.goto('/');

  await expect(page.getByTestId('account-chip')).toContainText('boss@example.com');
  await expect(page.getByTestId('admin-link')).toBeVisible();

  assertNoConsoleErrors(errors);
});

test('F12 a 401 mid-session drops you back to the login screen', async ({ page }) => {
  await stubWhoAmI(page, MERCHANT);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible();

  // The session expires server-side; the next API call is the one that finds out.
  await page.route('**/api/businesses', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Please sign in to continue.' }),
  }));

  await page.reload();

  await expect(page.getByTestId('login-screen')).toBeVisible();
});

test('F12 with sign-in switched off nothing about the app changes', async ({ page }) => {
  const errors = watchConsole(page);
  // No stub — this is what the real server answers for these gates.
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible();
  await expect(page.getByTestId('account-chip')).toHaveCount(0);
  // The admin console stays reachable when there is no such thing as an admin.
  await expect(page.getByTestId('admin-link')).toBeVisible();

  assertNoConsoleErrors(errors);
});
