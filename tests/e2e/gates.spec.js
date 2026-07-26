import { expect, test } from '@playwright/test';
import {
  assertNoConsoleErrors, connectShopify, createBusiness, fillEscalation,
  fillKnowledge, fillProfile, gotoSection, pickLanguages, waitForSave, watchConsole,
} from './helpers';

/* ========================================================================== */
/* F1 — every screen renders, zero console errors                             */
/* ========================================================================== */
test('F1 every screen renders with no console errors', async ({ page }) => {
  const errors = watchConsole(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your businesses' })).toBeVisible();

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Merchants' })).toBeVisible();
  await expect(page.getByTestId('admin-stats')).toBeVisible();

  const id = await createBusiness(page);
  for (let n = 1; n <= 7; n += 1) {
    await gotoSection(page, n);
    await expect(page.getByTestId(`section-${n}`)).toBeVisible();
  }

  await page.goto(`/business/${id}/dashboard`);
  await expect(page.getByTestId('dashboard-stats')).toBeVisible();

  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F2 — all 7 sections save and reload their data                             */
/* ========================================================================== */
test('F2 every section persists across a reload', async ({ page }) => {
  const errors = watchConsole(page);
  const id = await createBusiness(page);

  const profile = await fillProfile(page);
  await connectShopify(page);

  await gotoSection(page, 3);
  await page.getByTestId('cap-card-return_policy').getByRole('switch').click();
  await waitForSave(page);

  await pickLanguages(page, ['te', 'hi', 'en']);
  await fillKnowledge(page);
  await fillEscalation(page);

  // Reload from scratch and check each section came back.
  await page.goto(`/business/${id}`);

  await gotoSection(page, 1);
  await expect(page.getByTestId('field-name')).toHaveValue(profile.name);
  await expect(page.getByTestId('field-city')).toHaveValue(profile.city);
  await expect(page.getByTestId('field-email')).toHaveValue(profile.email);

  await gotoSection(page, 2);
  await expect(page.getByTestId('shopify-connected')).toBeVisible();

  await gotoSection(page, 3);
  await expect(
    page.getByTestId('cap-card-return_policy').getByRole('switch'),
  ).toHaveAttribute('aria-checked', 'true');

  await gotoSection(page, 4);
  await expect(page.getByTestId('lang-te')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('language-count')).toContainText('3 of 13 selected');

  await gotoSection(page, 5);
  await expect(page.getByTestId('faq-q-0')).toHaveValue('Do you deliver to villages?');

  await gotoSection(page, 6);
  await expect(page.getByTestId('sla-first-response')).toHaveValue('48');
  await expect(page.getByTestId('grievance-name')).toHaveValue('R. Kumar');

  await gotoSection(page, 7);
  await expect(page.getByTestId('checklist')).toBeVisible();

  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F3 — Custom REST: every capability field editable, nothing read-only       */
/* ========================================================================== */
test('F3 custom REST contracts are fully editable', async ({ page }) => {
  const errors = watchConsole(page);
  await createBusiness(page);
  await fillProfile(page);

  await gotoSection(page, 2);
  await page.getByTestId('source-custom').click();
  await page.getByTestId('custom-base').fill('https://api.ravielectronics.in/v1');
  await waitForSave(page);

  await gotoSection(page, 3);

  const keys = ['track_order', 'refund', 'return_policy', 'reorder', 'warranty',
    'exchange', 'cancel_order'];

  for (const key of keys) {
    const card = page.getByTestId(`cap-card-${key}`);
    await card.getByRole('switch').click();
    const editor = page.getByTestId(`contract-${key}`);
    await expect(editor).toBeVisible();

    // No Shopify prefill, no lock banner.
    await expect(page.getByTestId(`badge-${key}`)).toHaveCount(0);
    await expect(page.getByTestId(`customize-${key}`)).toHaveCount(0);
    await expect(page.getByTestId(`endpoint-${key}`)).toHaveValue('');

    // Walk every tab and assert nothing is disabled or read-only.
    for (const tab of ['overview', 'parameters', 'request', 'response', 'errors', 'test']) {
      await page.getByTestId(`tab-${key}-${tab}`).click();
      const controls = editor.locator('input, textarea, select');
      const count = await controls.count();
      for (let i = 0; i < count; i += 1) {
        const control = controls.nth(i);
        await expect(control, `${key}/${tab} control ${i} is disabled`).toBeEnabled();
        const readOnly = await control.evaluate((el) => el.readOnly === true);
        expect(readOnly, `${key}/${tab} control ${i} is readOnly`).toBe(false);
      }
    }
  }

  // And a hand-typed contract actually saves.
  await page.getByTestId('tab-track_order-overview').click();
  await page.getByTestId('endpoint-track_order').fill('/orders/{order_id}');
  await page.getByTestId('method-track_order').selectOption('GET');
  await waitForSave(page);
  await page.reload();
  await gotoSection(page, 3);
  await expect(page.getByTestId('endpoint-track_order')).toHaveValue('/orders/{order_id}');

  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F4 — Shopify: Customize unlocks everything, Reset restores defaults        */
/* ========================================================================== */
test('F4 Shopify contracts unlock on Customize and restore on Reset', async ({ page }) => {
  const errors = watchConsole(page);
  await createBusiness(page);
  await fillProfile(page);
  await connectShopify(page);

  await gotoSection(page, 3);
  const editor = page.getByTestId('contract-track_order');

  // Prefilled, badged and locked.
  await expect(page.getByTestId('badge-track_order')).toHaveText('Auto-configured from Shopify');
  const seeded = await page.getByTestId('endpoint-track_order').inputValue();
  expect(seeded).toBeTruthy();
  await expect(page.getByTestId('endpoint-track_order')).toHaveJSProperty('readOnly', true);

  // Customize unlocks EVERY field on EVERY tab.
  await page.getByTestId('customize-track_order').click();
  await expect(page.getByTestId('badge-track_order')).toHaveText('Customized · Shopify');

  for (const tab of ['overview', 'parameters', 'request', 'response', 'errors', 'test']) {
    await page.getByTestId(`tab-track_order-${tab}`).click();
    const controls = editor.locator('input, textarea, select');
    const count = await controls.count();
    for (let i = 0; i < count; i += 1) {
      await expect(controls.nth(i), `${tab} control ${i} still disabled`).toBeEnabled();
      const readOnly = await controls.nth(i).evaluate((el) => el.readOnly === true);
      expect(readOnly, `${tab} control ${i} still readOnly`).toBe(false);
    }
  }

  // Edit, then Reset restores the connector defaults.
  await page.getByTestId('tab-track_order-overview').click();
  await page.getByTestId('endpoint-track_order').fill('/my/own/path');
  await waitForSave(page);
  await expect(page.getByTestId('endpoint-track_order')).toHaveValue('/my/own/path');

  await page.getByTestId('reset-track_order').click();
  await expect(page.getByTestId('endpoint-track_order')).toHaveValue(seeded);
  await expect(page.getByTestId('badge-track_order')).toHaveText('Auto-configured from Shopify');

  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F5 — all 13 languages in native script, no clipped matras                  */
/* ========================================================================== */
test('F5 all 13 languages render in native script without clipping', async ({ page }) => {
  const errors = watchConsole(page);
  await createBusiness(page);
  await gotoSection(page, 4);

  const expected = {
    te: 'తెలుగు', hi: 'हिंदी', ta: 'தமிழ்', kn: 'ಕನ್ನಡ', ml: 'മലയാളം',
    bn: 'বাংলা', mr: 'मराठी', gu: 'ગુજરાતી', pa: 'ਪੰਜਾਬੀ', or: 'ଓଡ଼ିଆ',
    as: 'অসমীয়া', ur: 'اردو', en: 'English',
  };

  await expect(page.getByTestId('language-chips').getByRole('checkbox')).toHaveCount(13);

  for (const [code, native] of Object.entries(expected)) {
    const chip = page.getByTestId(`lang-${code}`);
    await expect(chip).toContainText(native);

    // The native-script span must not be clipped by its own line box.
    const clipping = await chip.locator('.ucxp-native').evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      fontSize: parseFloat(getComputedStyle(el).fontSize),
    }));
    expect(clipping.scrollHeight, `${code} native text is clipped vertically`)
      .toBeLessThanOrEqual(clipping.clientHeight + 1);
    // Generous leading: at least 1.7x the font size.
    expect(clipping.lineHeight / clipping.fontSize,
      `${code} line-height is too tight for matras`).toBeGreaterThanOrEqual(1.7);
  }

  // Search filters, and the empty state appears for a miss.
  await page.getByTestId('language-search').fill('Punjabi');
  await expect(page.getByTestId('lang-pa')).toBeVisible();
  await page.getByTestId('language-search').fill('zzzz');
  await expect(page.getByTestId('language-empty')).toBeVisible();
  await page.getByTestId('language-search').fill('');

  // Select all / clear all / primary selector.
  await page.getByTestId('select-all-languages').click();
  await expect(page.getByTestId('language-count')).toContainText('13 of 13 selected');
  await expect(page.getByTestId('primary-language')).toBeVisible();
  await page.getByTestId('clear-all-languages').click();
  await expect(page.getByTestId('language-required')).toBeVisible();

  // The identity marquee is present.
  await expect(page.getByTestId('greeting-marquee')).toBeAttached();

  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F6 — live JSON preview matches the downloaded manifest exactly             */
/* ========================================================================== */
test('F6 preview and downloaded manifest are byte-identical', async ({ page }) => {
  const errors = watchConsole(page);
  await createBusiness(page);
  await fillProfile(page);
  await pickLanguages(page, ['te', 'en']);
  await fillKnowledge(page);

  const paneText = await page.getByTestId('manifest-code').evaluate((pane) =>
    Array.from(pane.querySelectorAll('.ucxp-json-line'))
      .map((line) => line.lastElementChild.textContent)
      .join('\n'));

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pane-download').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const fileText = Buffer.concat(chunks).toString('utf-8');

  expect(download.suggestedFilename()).toBe('support.manifest.json');
  expect(JSON.parse(fileText)).toEqual(JSON.parse(paneText));
  expect(fileText).toBe(paneText);

  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F7 — async actions show a spinner and disable their button                 */
/* ========================================================================== */
test('F7 async actions show a spinner and disable the button', async ({ page }) => {
  const errors = watchConsole(page);
  await createBusiness(page);
  await fillProfile(page);

  // Hold the connect response open so the in-flight state is observable.
  await page.route('**/api/connect/shopify', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });

  await gotoSection(page, 2);
  await page.getByTestId('source-shopify').click();
  await page.getByTestId('shopify-subdomain').fill('ravi-electronics-bmxitv46');
  await page.getByTestId('connect-shopify').click();

  const approve = page.getByTestId('oauth-approve');
  await approve.click();
  await expect(approve.getByTestId('spinner')).toBeVisible();
  await expect(approve).toBeDisabled();

  await page.unroute('**/api/connect/shopify');
  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F8 — every failure shows a friendly inline message, never a blank screen   */
/* ========================================================================== */
test('F8 failures render an inline message, not a blank screen', async ({ page }) => {
  const errors = watchConsole(page);

  // 1. The businesses list fails to load.
  await page.route('**/api/businesses', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByTestId('error-panel')).toBeVisible();
  await expect(page.locator('body')).not.toBeEmpty();
  await page.unroute('**/api/businesses');

  // 2. A Shopify connect failure.
  const id = await createBusiness(page);
  await fillProfile(page);
  await page.route('**/api/connect/shopify', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'Shopify refused that access token.' }),
    }));
  await gotoSection(page, 2);
  await page.getByTestId('source-shopify').click();
  await page.getByTestId('shopify-subdomain').fill('nope');
  await page.getByTestId('connect-shopify').click();
  await page.getByTestId('oauth-approve').click();
  // The message shows inside the consent dialog and again on the section behind it.
  await expect(page.getByRole('dialog').getByTestId('error-panel'))
    .toContainText('Shopify refused');
  await page.unroute('**/api/connect/shopify');

  // 3. A bad FAQ import URL.
  await page.keyboard.press('Escape');
  await gotoSection(page, 5);
  await page.getByTestId('import-url').fill('not-a-url');
  await page.getByTestId('import-faq').click();
  await expect(page.getByTestId('inline-error')).toBeVisible();

  // 4. An unknown business id still renders a message and a way out.
  await page.goto('/business/does-not-exist-at-all');
  await expect(page.getByTestId('error-panel')).toBeVisible();
  await expect(page.getByText('Back to your businesses')).toBeVisible();

  expect(id).toBeTruthy();
  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F10 — no dead buttons                                                      */
/* ========================================================================== */
test('F10 every control acts or is disabled with a stated reason', async ({ page }) => {
  const errors = watchConsole(page);
  const id = await createBusiness(page);

  const routes = ['/', '/admin', `/business/${id}`, `/business/${id}/dashboard`];
  for (const route of routes) {
    await page.goto(route);
    await page.waitForTimeout(400);

    const buttons = page.locator('button:visible');
    const count = await buttons.count();
    expect(count, `${route} rendered no buttons`).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const info = await button.evaluate((el) => ({
        disabled: el.disabled,
        title: el.getAttribute('title') || '',
        aria: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').trim(),
        type: el.getAttribute('type'),
        handler: el.onclick !== null,
      }));
      if (info.disabled) {
        // A disabled control must explain itself.
        expect(
          Boolean(info.title || info.aria),
          `${route}: disabled button "${info.text}" gives no reason`,
        ).toBe(true);
      } else {
        // An enabled control must be labelled, so it is never a mystery target.
        expect(
          Boolean(info.text || info.aria || info.title),
          `${route}: enabled button #${i} has no accessible label`,
        ).toBe(true);
      }
    }
  }

  assertNoConsoleErrors(errors);
});

/* ========================================================================== */
/* F11 — layout matches the design reference                                  */
/* ========================================================================== */
test('F11 layout matches the design reference', async ({ page }) => {
  const errors = watchConsole(page);
  const id = await createBusiness(page);

  // Onboarding shell: sidebar, main, sticky JSON pane, in that order.
  await page.goto(`/business/${id}`);
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toBeVisible();
  const sidebarBox = await sidebar.boundingBox();
  expect(Math.round(sidebarBox.width)).toBe(236);

  const pane = page.getByTestId('manifest-pane');
  await expect(pane).toBeVisible();
  const paneBox = await pane.boundingBox();
  expect(paneBox.width).toBeGreaterThanOrEqual(380);
  expect(paneBox.width).toBeLessThanOrEqual(450);
  expect(paneBox.x).toBeGreaterThan(sidebarBox.x + sidebarBox.width);

  // Seven sidebar items, in the design's order.
  const labels = await sidebar.getByRole('button').allInnerTexts();
  expect(labels.map((t) => t.replace(/^[✓●○]\s*/, '').trim())).toEqual([
    'Business profile', 'Data source', 'API capabilities', 'Languages',
    'Knowledge base', 'Escalation & SLA', 'Review & activate',
  ]);

  // Completion ring present in the sidebar.
  await expect(page.getByTestId('completion-ring').first()).toBeVisible();

  // Header bar heights match the design: 56px on the onboarding shell, 58px on
  // home and admin. Measured on the inner bar, since the design's number is the
  // content height and the hairline border sits outside it.
  const onboardingHeader = await page.getByTestId('header-bar').boundingBox();
  expect(Math.round(onboardingHeader.height)).toBe(56);

  await page.goto('/');
  const homeHeader = await page.getByTestId('header-bar').boundingBox();
  expect(Math.round(homeHeader.height)).toBe(58);
  await expect(page.getByTestId('tagline')).toHaveText('AI for all from India');

  // The JSON pane is the dark one.
  await page.goto(`/business/${id}`);
  const paneBg = await page
    .getByTestId('manifest-pane')
    .locator('> div')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(paneBg).toBe('rgb(10, 10, 10)');

  // Primary action is solid black, not indigo.
  await page.goto('/');
  const primaryBg = await page
    .getByTestId('onboard-business')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(primaryBg).toBe('rgb(10, 10, 10)');

  assertNoConsoleErrors(errors);
});
