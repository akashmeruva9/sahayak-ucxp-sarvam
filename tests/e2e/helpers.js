import { expect } from '@playwright/test';

/** Fail a test the moment the app logs a console error (gate F1, continuously). */
export function watchConsole(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

/** Browser noise that is never an application defect. */
const IGNORED = /favicon|Download the React DevTools/i;

/** Chromium logs a console entry for every failed request, including ones a test
 *  induced on purpose. Only a test that deliberately breaks the network may opt
 *  into ignoring these — the default stays strict so a genuinely broken request
 *  still fails F1. */
const INDUCED_NETWORK_FAILURE = /Failed to load resource/i;

export function assertNoConsoleErrors(errors, { allowInducedNetworkFailures = false } = {}) {
  const real = errors.filter((text) => {
    if (IGNORED.test(text)) return false;
    if (allowInducedNetworkFailures && INDUCED_NETWORK_FAILURE.test(text)) return false;
    return true;
  });
  expect(real, `console errors: ${real.join(' | ')}`).toHaveLength(0);
}

/** Create a business through the UI and return its id from the URL. */
export async function createBusiness(page) {
  await page.goto('/');
  const empty = page.getByTestId('home-empty');
  const button = (await empty.isVisible().catch(() => false))
    ? page.getByTestId('onboard-first')
    : page.getByTestId('onboard-business');
  await button.click();
  await page.waitForURL(/\/business\/[^/]+$/);
  return page.url().split('/business/')[1].split('/')[0];
}

export async function gotoSection(page, n) {
  // Wait for the shell to finish loading before deciding which nav is on screen,
  // otherwise a slow first paint looks like the narrow layout.
  await page.getByTestId('section-tabs').waitFor({ state: 'attached' });
  const wide = await page.getByTestId(`nav-section-${n}`).isVisible().catch(() => false);
  if (wide) {
    await page.getByTestId(`nav-section-${n}`).click();
  } else {
    // Match on the tab's own label rather than its position. "No data source"
    // drops section 3 from the strip, and an index would then quietly click the
    // section next door instead of failing.
    const short = { 1: 'Profile', 2: 'Data', 3: 'Capabilities', 4: 'Languages',
      5: 'Knowledge', 6: 'SLA', 7: 'Review' }[n];
    await page.getByTestId('section-tabs')
      .getByRole('button', { name: short, exact: true }).click();
  }
  await expect(page.getByTestId(`section-${n}`)).toBeVisible();
}

/** Wait for the autosave round-trip to settle.
 *
 * The visible label reads "All changes saved" while idle too, so waiting on the
 * text alone would return before anything had been queued. Wait past the 600ms
 * debounce, then wait for data-dirty to clear, which only happens once every
 * queued section has come back from the server.
 */
export async function waitForSave(page) {
  await page.waitForTimeout(750);
  await expect(page.getByTestId('save-state')).toHaveAttribute('data-dirty', 'false', {
    timeout: 20_000,
  });
}

export async function fillProfile(page, profile = {}) {
  const data = {
    name: 'Ravi Electronics',
    tagline: 'Electronics you can trust',
    desc: 'Consumer electronics retailer serving Telangana and Andhra Pradesh.',
    category: 'Electronics',
    city: 'Hyderabad',
    email: 'support@ravielectronics.in',
    phone: '+91 40 2222 3333',
    website: 'https://ravielectronics.in',
    hours: 'Mon–Sat · 10:00–20:00 IST',
    ...profile,
  };
  await gotoSection(page, 1);
  await page.getByTestId('field-name').fill(data.name);
  await page.getByTestId('field-tagline').fill(data.tagline);
  await page.getByTestId('field-desc').fill(data.desc);
  await page.getByTestId('field-category').selectOption(data.category);
  await page.getByTestId('field-city').fill(data.city);
  await page.getByTestId('field-email').fill(data.email);
  await page.getByTestId('field-phone').fill(data.phone);
  await page.getByTestId('field-website').fill(data.website);
  await page.getByTestId('field-hours').fill(data.hours);
  await waitForSave(page);
  // Naming a draft adopts the real slug and re-keys the business, so the URL the
  // caller started with is stale. Hand back the id now in effect.
  await expect(page).toHaveURL(/\/business\/[^/]+$/);
  const id = page.url().split('/business/')[1].split('/')[0];
  return { ...data, id };
}

export async function connectShopify(page, subdomain = 'ravi-electronics-bmxitv46') {
  await gotoSection(page, 2);
  await page.getByTestId('source-shopify').click();
  await page.getByTestId('shopify-subdomain').fill(subdomain);
  await page.getByTestId('connect-shopify').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('oauth-approve').click();
  await expect(page.getByTestId('shopify-connected')).toBeVisible({ timeout: 30_000 });
  await waitForSave(page);
}

export async function pickLanguages(page, codes = ['te', 'hi', 'en']) {
  await gotoSection(page, 4);
  for (const code of codes) {
    const chip = page.getByTestId(`lang-${code}`);
    if ((await chip.getAttribute('data-selected')) !== 'true') await chip.click();
  }
  await waitForSave(page);
}

export async function fillKnowledge(page) {
  await gotoSection(page, 5);
  await page.getByTestId('add-faq').click();
  await page.getByTestId('faq-q-0').fill('Do you deliver to villages?');
  await page.getByTestId('faq-a-0').fill('Yes — 5 to 7 days across the state.');
  await page.getByTestId('policy-return').fill('Unopened electronics can be returned within 10 days.');
  await page.getByTestId('policy-warranty').fill('All products carry a 1 year manufacturer warranty.');
  await waitForSave(page);
}

export async function fillEscalation(page) {
  await gotoSection(page, 6);
  await page.getByTestId('sla-first-response').fill('48');
  await page.getByTestId('sla-resolution').fill('30');
  await page.getByTestId('grievance-name').fill('R. Kumar');
  await page.getByTestId('grievance-email').fill('grievance@ravielectronics.in');
  await waitForSave(page);
}
