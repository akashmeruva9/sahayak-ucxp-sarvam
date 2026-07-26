import { expect, test } from '@playwright/test';
import { assertNoConsoleErrors, createBusiness, gotoSection, watchConsole } from './helpers';

/* F9 — at 375px the sidebar collapses, the JSON pane stacks below, nothing is cut off. */
test('F9 responsive at 375px', async ({ page }) => {
  const errors = watchConsole(page);
  const id = await createBusiness(page);
  await page.goto(`/business/${id}`);

  // Sidebar is gone; the horizontal tab strip replaces it.
  await expect(page.getByTestId('sidebar')).toBeHidden();
  await expect(page.getByTestId('section-tabs')).toBeVisible();

  // JSON pane stacks below the form rather than beside it.
  const main = await page.locator('main').first().boundingBox();
  const pane = await page.getByTestId('manifest-pane').boundingBox();
  expect(pane.y).toBeGreaterThan(main.y);
  expect(pane.x).toBeLessThan(40);

  // No horizontal overflow anywhere in the app.
  const routes = ['/', '/admin', `/business/${id}`, `/business/${id}/dashboard`];
  for (const route of routes) {
    await page.goto(route);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      doc: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(overflow.body, `${route} body overflows horizontally`).toBeLessThanOrEqual(
      overflow.viewport + 1,
    );
  }

  // Wide content (the admin table) scrolls inside its own container, not the page.
  await page.goto('/admin');
  const scroller = page.locator('.overflow-x-auto').first();
  await expect(scroller).toBeAttached();

  // Section content is readable and not clipped.
  await page.goto(`/business/${id}`);
  for (const n of [1, 4, 7]) {
    await gotoSection(page, n);
    const section = page.getByTestId(`section-${n}`);
    const box = await section.boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);
    const clipped = await section.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `section ${n} content is cut off at 375px`).toBe(false);
  }

  assertNoConsoleErrors(errors);
});
