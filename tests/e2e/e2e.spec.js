import { expect, test } from '@playwright/test';
import {
  assertNoConsoleErrors, connectShopify, createBusiness, fillEscalation,
  fillKnowledge, fillProfile, gotoSection, pickLanguages, waitForSave, watchConsole,
} from './helpers';

/* Both journeys run three times, as required. */
test.describe.configure({ retries: 0 });

/* ========================================================================== */
/* E1 — full Ravi Electronics onboarding against the REAL Shopify store       */
/* ========================================================================== */
for (const run of [1, 2, 3]) {
  test(`E1 onboard Ravi Electronics end to end (run ${run})`, async ({ page }) => {
    const errors = watchConsole(page);
    await createBusiness(page);

    // 1. Profile. Naming the draft adopts the real slug, so the id settles here.
    const { id } = await fillProfile(page);
    expect(id, 'business_id should be slugged from the business name')
      .toMatch(/^ravi-electronics(-\d+)?$/);

    // 2. Real Shopify connect — the counts must come from the live store.
    await connectShopify(page, 'ravi-electronics-bmxitv46');
    const products = Number(await page.getByTestId('stat-products').locator('div').first().innerText());
    const orders = Number(await page.getByTestId('stat-orders').locator('div').first().innerText());
    const currency = await page.getByTestId('stat-currency').locator('div').first().innerText();

    expect(products, 'no real products came back from ravi-electronics-bmxitv46')
      .toBeGreaterThan(0);
    expect(orders, 'no real orders came back from ravi-electronics-bmxitv46')
      .toBeGreaterThan(0);
    expect(currency).toBe('INR');
    await expect(page.getByTestId('vault-ref')).toHaveText(`vault://${id}`);

    // 3. Capabilities — two auto-configured, plus one enabled by hand.
    await gotoSection(page, 3);
    await expect(page.getByTestId('badge-track_order')).toBeVisible();
    await expect(page.getByTestId('badge-refund')).toBeVisible();
    await page.getByTestId('cap-card-warranty').getByRole('switch').click();
    await page.getByTestId('endpoint-warranty').fill('/api/warranty/{product_id}');
    await page.getByTestId('tab-warranty-response').click();
    await page.getByTestId('response-sample-warranty').fill('{"covered": true}');
    await waitForSave(page);

    // 4-6.
    await pickLanguages(page, ['te', 'hi', 'en']);
    await fillKnowledge(page);
    await fillEscalation(page);

    // 7. Review shows no blockers, then activate.
    await gotoSection(page, 7);
    await expect(page.getByTestId('missing-panel')).toHaveCount(0);
    const activate = page.getByTestId('activate');
    await expect(activate).toBeEnabled();
    await activate.click();

    // Success screen.
    await page.waitForURL(new RegExp(`/business/${id}/success`), { timeout: 30_000 });
    await expect(page.getByTestId('success-badge')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Ravi Electronics is live on Sahayak/ }))
      .toBeVisible();
    await expect(page.getByTestId('manifest-url')).toContainText(`${id}.json`);
    await expect(page.getByText('Credentials vaulted — never exposed in exports')).toBeVisible();

    // The published manifest holds a credential_ref and no raw token.
    const manifestResponse = await page.request.get(`/api/business/${id}/manifest`);
    const body = await manifestResponse.json();
    expect(body.valid).toBe(true);
    expect(body.manifest.data_source.credential_ref).toBe(`vault://${id}`);
    expect(body.manifest.identify_by).toBe('order_number');
    expect(JSON.stringify(body.manifest)).not.toContain('shpat_');

    // Active on home, with the right completion.
    await page.goto('/');
    const card = page.getByTestId(`business-card-${id}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('status-pill')).toHaveText('Active');
    await expect(card).toContainText('100% complete');

    // Present in /admin with the same completion.
    await page.goto('/admin');
    await page.getByTestId('admin-search').fill(id);
    const row = page.getByTestId(`admin-row-${id}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('status-pill')).toHaveText('Active');
    await expect(row).toContainText('100%');

    // Row opens the read-only manifest.
    await row.click();
    await expect(page.getByText('Read-only · operator view')).toBeVisible();
    await expect(page.getByTestId('manifest-pane')).toBeVisible();

    assertNoConsoleErrors(errors);
  });
}

/* ========================================================================== */
/* E2 — Custom REST business, contracts typed by hand                        */
/* ========================================================================== */
for (const run of [1, 2, 3]) {
  test(`E2 onboard a custom REST business end to end (run ${run})`, async ({ page }) => {
    const errors = watchConsole(page);
    await createBusiness(page);

    const { id } = await fillProfile(page, {
      name: 'Meenakshi Silks',
      tagline: 'Handwoven Kanchipuram silks since 1962',
      category: 'Apparel & Textiles',
      city: 'Chennai',
      email: 'support@meenakshisilks.in',
      website: 'https://meenakshisilks.in',
    });
    expect(id).toMatch(/^meenakshi-silks(-\d+)?$/);

    // Custom REST source, with no secret ever typed into the page.
    await gotoSection(page, 2);
    await page.getByTestId('source-custom').click();
    await page.getByTestId('custom-base').fill('https://api.meenakshisilks.in/v1');
    await page.getByTestId('custom-auth').selectOption('bearer_token');
    await expect(page.getByTestId('custom-header')).toHaveValue('Authorization');
    await page.getByTestId('send-credential-link').click();
    await expect(page.getByTestId('credential-link-sent')).toBeVisible();
    await expect(page.getByText('Secrets live in the Sahayak vault')).toBeVisible();
    await waitForSave(page);

    // Hand-type two full contracts.
    await gotoSection(page, 3);

    await page.getByTestId('cap-card-track_order').getByRole('switch').click();
    await page.getByTestId('endpoint-track_order').fill('/orders/{order_id}');
    await page.getByTestId('method-track_order').selectOption('GET');
    await page.getByTestId('description-track_order').fill('Look up a live order by its number.');

    await page.getByTestId('tab-track_order-parameters').click();
    await page.getByRole('button', { name: '+ Add path parameter' }).click();
    await page.getByTestId('param-track_order-path-0-name').fill('order_id');

    await page.getByTestId('tab-track_order-request').click();
    await page.getByRole('button', { name: '+ Add header' }).click();
    await page.getByTestId('header-track_order-0-name').fill('Authorization');

    await page.getByTestId('tab-track_order-response').click();
    await page.getByTestId('response-sample-track_order')
      .fill('{"status": "shipped", "eta": "2026-07-30"}');
    await expect(page.getByTestId('contract-track_order').getByTestId('json-chip'))
      .toHaveText('✓ Valid JSON');
    await page.getByRole('button', { name: '+ Add mapping' }).click();
    await page.getByTestId('mapping-track_order-0-field').fill('status');

    await page.getByTestId('tab-track_order-errors').click();
    await page.getByRole('button', { name: '+ Add error code' }).click();
    await page.getByTestId('error-track_order-0-code').fill('404');

    await page.getByTestId('tab-track_order-test').click();
    await expect(page.getByTestId('curl-track_order')).toContainText('curl -X GET');
    await expect(page.getByTestId('curl-track_order'))
      .toContainText('https://api.meenakshisilks.in/v1/orders/{order_id}');

    await page.getByTestId('cap-card-return_policy').getByRole('switch').click();
    await page.getByTestId('endpoint-return_policy').fill('/policies/return');
    await page.getByTestId('tab-return_policy-response').click();
    await page.getByTestId('response-sample-return_policy').fill('{"window_days": 7}');
    await waitForSave(page);

    // Invalid JSON is flagged rather than silently accepted.
    await page.getByTestId('response-sample-return_policy').fill('{not json');
    await expect(page.getByTestId('contract-return_policy').getByTestId('json-chip'))
      .toHaveText('✗ Invalid JSON');
    await page.getByTestId('response-sample-return_policy').fill('{"window_days": 7}');
    await waitForSave(page);

    await pickLanguages(page, ['ta', 'te', 'en']);
    await fillKnowledge(page);
    await fillEscalation(page);

    await gotoSection(page, 7);
    await expect(page.getByTestId('missing-panel')).toHaveCount(0);
    await page.getByTestId('activate').click();
    await page.waitForURL(new RegExp(`/business/${id}/success`), { timeout: 30_000 });
    await expect(page.getByTestId('success-badge')).toBeVisible();

    // The hand-typed contract survived into the manifest.
    const body = await (await page.request.get(`/api/business/${id}/manifest`)).json();
    expect(body.valid).toBe(true);
    expect(body.manifest.data_source.type).toBe('custom');
    expect(body.manifest.data_source.base_url).toBe('https://api.meenakshisilks.in/v1');
    expect(body.manifest.data_source.credential_ref).toBe(`vault://${id}`);
    const tracked = body.manifest.capabilities.find((c) => c.name === 'track_order');
    expect(tracked.endpoint).toBe('/orders/{order_id}');
    expect(tracked.parameters.path[0].name).toBe('order_id');
    expect(JSON.stringify(body.manifest)).not.toContain('shpat_');

    await page.goto('/admin');
    await page.getByTestId('admin-search').fill(id);
    await expect(page.getByTestId(`admin-row-${id}`).getByTestId('status-pill'))
      .toHaveText('Active');

    assertNoConsoleErrors(errors);
  });
}
