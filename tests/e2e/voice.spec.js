/** Speak-to-fill: what it fills, and what it must never overwrite.
 *
 * The recording itself is stubbed. Driving a real microphone from Playwright
 * would test Chromium's audio stack rather than ours; what matters here is the
 * contract between the endpoint's response and the form.
 */
import { expect, test } from '@playwright/test';
import { createBusiness, gotoSection, waitForSave, watchConsole,
         assertNoConsoleErrors } from './helpers.js';

const HEARD = 'My name is Ravi. I have an electronics shop in Warangal.';

/** Replace MediaRecorder and getUserMedia so "hold to speak" yields a Blob. */
async function stubMicrophone(page) {
  await page.addInitScript(() => {
    navigator.mediaDevices = navigator.mediaDevices || {};
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop() {} }],
    });

    class FakeRecorder {
      constructor() {
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
      }
      static isTypeSupported() { return true; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['x'.repeat(2048)]) });
        this.onstop?.();
      }
    }
    window.MediaRecorder = FakeRecorder;
    // The level meter taps AudioContext; the stub stream has no real source.
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
  });
}

function reply(page, body) {
  return page.route('**/api/voice-onboard', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify(body) }));
}

/** Start, talk for long enough to clear MIN_MS, stop. */
async function speak(page) {
  const mic = page.getByTestId('mic-button');
  await mic.click();
  await expect(mic).toHaveAttribute('data-recording', 'true');
  await page.waitForTimeout(1100);
  await mic.click();
}

/** Start and stop straight away — no speech in the file. */
async function tap(page) {
  const mic = page.getByTestId('mic-button');
  await mic.click();
  await mic.click();
}

test('a spoken answer fills the profile and the languages', async ({ page }) => {
  const errors = watchConsole(page);
  await stubMicrophone(page);
  await reply(page, {
    ok: true,
    heard: HEARD,
    language: 'te-IN',
    error: '',
    fields: {
      name: 'Ravi Electronics',
      category: 'Electronics',
      city: 'Warangal',
      description: 'Headphones and chargers',
      languages: ['te', 'hi'],
    },
  });

  await createBusiness(page);
  await speak(page);

  await expect(page.getByTestId('field-name')).toHaveValue('Ravi Electronics');
  await expect(page.getByTestId('field-city')).toHaveValue('Warangal');
  await expect(page.getByTestId('voice-heard')).toContainText('Warangal');
  await waitForSave(page);

  // Section 4 was filled from the same sentence.
  await gotoSection(page, 4);
  await expect(page.getByTestId('lang-te')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('lang-hi')).toHaveAttribute('data-selected', 'true');

  assertNoConsoleErrors(errors);
});

test('what the merchant typed is never overwritten by what they said',
  async ({ page }) => {
    await stubMicrophone(page);
    await reply(page, {
      ok: true, heard: HEARD, language: 'te-IN', error: '',
      fields: { name: 'Ravi Electronics', city: 'Warangal' },
    });

    await createBusiness(page);
    await page.getByTestId('field-name').fill('Ravi Electronics & Sons');
    await page.getByTestId('field-name').blur();
    await waitForSave(page);

    await speak(page);

    // The typed name stands; the blank city is filled.
    await expect(page.getByTestId('field-name')).toHaveValue('Ravi Electronics & Sons');
    await expect(page.getByTestId('field-city')).toHaveValue('Warangal');
  });

test('a failure says so inline and leaves the form typeable', async ({ page }) => {
  await stubMicrophone(page);
  await reply(page, {
    ok: false, fields: {}, heard: '', language: '',
    error: "We couldn't make out any speech in that.",
  });

  await createBusiness(page);
  await speak(page);

  await expect(page.getByTestId('section-1')).toContainText("couldn't make out");
  // The point of the whole feature: the form still works by hand.
  await page.getByTestId('field-name').fill('Typed By Hand');
  await expect(page.getByTestId('field-name')).toHaveValue('Typed By Hand');
});

test('stopping straight away is caught here, not blamed on a noisy room',
  async ({ page }) => {
  await stubMicrophone(page);
  let called = false;
  await page.route('**/api/voice-onboard', (route) => {
    called = true;
    return route.fulfill({ status: 200, contentType: 'application/json',
                           body: JSON.stringify({ ok: true, fields: {}, heard: '',
                                                  language: '', error: '' }) });
  });

    await createBusiness(page);
    await tap(page);

    // Yields a container header with no speech. Saaras would answer with an empty
    // transcript and the merchant would be sent to find a quieter room.
    await expect(page.getByTestId('mic-error')).toContainText('too short');
    expect(called, 'it must not reach the server at all').toBe(false);
  });

test('Assamese and Urdu are marked text-only in Section 4', async ({ page }) => {
  await createBusiness(page);
  await gotoSection(page, 4);

  await expect(page.getByTestId('lang-textonly-as')).toBeVisible();
  await expect(page.getByTestId('lang-textonly-ur')).toBeVisible();
  // Bulbul speaks the other eleven, so nothing else carries the badge.
  await expect(page.getByTestId('lang-textonly-te')).toHaveCount(0);
  await expect(page.getByTestId('lang-textonly-or')).toHaveCount(0);

  await page.getByTestId('lang-ur').click();
  await expect(page.getByTestId('language-text-only-note')).toContainText('Urdu');
});
