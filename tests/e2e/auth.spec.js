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

/* ==========================================================================
 * F13 — the Teams tab in the admin console
 *
 * The record of who has signed in. The backend half is gate B9; these check
 * that an admin can actually read it, and that it stays unread until asked.
 * ========================================================================== */

const USERS = {
  users: [
    {
      email: 'boss@example.com', name: 'Boss', picture: '', is_admin: true,
      first_seen: '2026-07-01T09:00:00+00:00', last_seen: '2026-07-28T18:30:00+00:00',
      sign_in_count: 12, businesses: 0,
    },
    {
      email: 'shop@example.com', name: 'Shop', picture: '', is_admin: false,
      first_seen: '2026-07-20T11:00:00+00:00', last_seen: '2026-07-27T08:15:00+00:00',
      sign_in_count: 3, businesses: 2,
    },
  ],
  stats: { total: 2, admins: 1, merchants: 1, with_businesses: 1 },
  database: { configured: true },
};

test('F13 the Teams tab lists who has signed in', async ({ page }) => {
  const errors = watchConsole(page);
  await page.route('**/api/admin/users', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(USERS),
  }));

  await page.goto('/admin');
  await page.getByTestId('admin-tab-users').click();

  await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
  await expect(page.getByTestId('admin-user-stats')).toContainText('Admins');

  const admin = page.getByTestId('admin-user-boss@example.com');
  await expect(admin).toContainText('Admin');
  await expect(admin).toContainText('12');

  const merchant = page.getByTestId('admin-user-shop@example.com');
  // Role comes from the server's fresh answer, not from anything in a cookie.
  await expect(merchant).toContainText('Merchant');

  // And the tab is a way back, not a one-way door.
  await page.getByTestId('admin-tab-merchants').click();
  await expect(page.getByTestId('admin-stats')).toBeVisible();

  assertNoConsoleErrors(errors);
});

test('F13 nobody signed in reads as an empty table, not an error', async ({ page }) => {
  const errors = watchConsole(page);
  // No stub: with sign-in off for these gates, the real server has nobody to list.
  await page.goto('/admin');
  await page.getByTestId('admin-tab-users').click();

  await expect(page.getByTestId('admin-users-empty')).toBeVisible();
  await expect(page.getByTestId('admin-user-stats')).toBeVisible();

  assertNoConsoleErrors(errors);
});

test('F13 email addresses are not fetched until the tab is opened', async ({ page }) => {
  const asked = [];
  await page.route('**/api/admin/users', (route) => {
    asked.push(route.request().url());
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(USERS),
    });
  });

  await page.goto('/admin');
  await expect(page.getByTestId('admin-stats')).toBeVisible();
  expect(asked).toHaveLength(0);

  await page.getByTestId('admin-tab-users').click();
  await expect(page.getByTestId('admin-user-boss@example.com')).toBeVisible();
  expect(asked).toHaveLength(1);
});
