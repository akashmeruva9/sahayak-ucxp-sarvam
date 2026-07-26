/** Thin API client.
 *
 * Every call resolves to a plain object. Network and server failures are
 * normalised into { error: '<friendly sentence>' } so callers can render an
 * inline message instead of throwing into a blank screen (gate F8).
 */

const BASE = '/api';

async function request(path, options = {}) {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
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
      return { error: body?.error || 'Something went wrong. Please try again.' };
    }
    return body ?? {};
  } catch {
    return {
      error: 'Could not reach the UCXP server. Check it is running on port 8000.',
    };
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
  scrapeFaq: (url) =>
    request('/scrape-faq', { method: 'POST', body: JSON.stringify({ url }) }),

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
