/** Thin API client.
 *
 * Every call resolves to a plain object. Network and server failures are
 * normalised into { error: '<friendly sentence>' } so callers can render an
 * inline message instead of throwing into a blank screen (gate F8).
 */

const BASE = '/api';

async function request(path, options = {}) {
  // Reading a merchant's whole site takes tens of seconds; everything else
  // should give up long before that rather than spin forever.
  const { timeoutMs = 15000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...rest,
    });
    let body = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return { error: 'The server sent a response we could not read.' };
      }
    }
    if (!response.ok) {
      if (body?.error) return { error: body.error };
      // The API always answers with {"error": ...}, so a 5xx carrying anything
      // else did not come from the API -- it came from whatever sits in front of
      // it, which means the backend is down. Say that instead of "something
      // went wrong", which sends you looking for a bug that isn't there.
      if (response.status >= 500) {
        return { error: 'Could not reach the Sahayak server. Check that it is running.' };
      }
      return { error: 'Something went wrong. Please try again.' };
    }
    return body ?? {};
  } catch (err) {
    if (err?.name === 'AbortError') {
      return {
        error: 'That is taking longer than expected. Try again, or fill this in by hand.',
      };
    }
    return {
      error: 'Could not reach the Sahayak server. Check it is running on port 8000.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  meta: () => request('/meta'),
  health: () => request('/health'),

  listBusinesses: () => request('/businesses'),
  createBusiness: (name) =>
    request('/businesses', { method: 'POST', body: JSON.stringify({ name }) }),
  getBusiness: (id) => request(`/business/${id}`),
  deleteBusiness: (id) => request(`/business/${id}`, { method: 'DELETE' }),

  saveSection: (id, section, data, commitSlug = false) =>
    request(`/business/${id}/section/${section}`, {
      method: 'PUT',
      body: JSON.stringify({ data, commit_slug: commitSlug }),
    }),

  getManifest: (id) => request(`/business/${id}/manifest`),
  activate: (id) => request(`/business/${id}/activate`, { method: 'POST' }),

  connectShopify: (payload) =>
    request('/connect/shopify', { method: 'POST', body: JSON.stringify(payload) }),
  connectCustom: (payload) =>
    request('/connect/custom', { method: 'POST', body: JSON.stringify(payload) }),
  scrapeFaq: (url, existingQuestions = []) =>
    request('/scrape-faq', {
      method: 'POST',
      timeoutMs: 120000, // must exceed the server's own 100s budget
      body: JSON.stringify({ url, existing_questions: existingQuestions }),
    }),

  adminMerchants: () => request('/admin/merchants'),
  adminManifest: (id) => request(`/admin/merchant/${id}/manifest`),
};

export function downloadJson(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
