/** Mirror of backend/constants.py.
 *
 * tests/backend/test_backend.py::test_frontend_mirrors_backend_vocabulary asserts
 * every language code, capability key and category below also exists on the
 * server, so the two cannot drift apart silently.
 */

export const LANGUAGES = [
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'hi', native: 'हिंदी', english: 'Hindi' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
  { code: 'or', native: 'ଓଡ଼ିଆ', english: 'Odia' },
  { code: 'as', native: 'অসমীয়া', english: 'Assamese' },
  { code: 'ur', native: 'اردو', english: 'Urdu' },
  { code: 'en', native: 'English', english: 'English' },
];

export const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

/** Greetings for the Section 4 marquee, one per major script. */
export const GREETINGS = [
  'नमस्ते', 'నమస్కారం', 'வணக்கம்', 'ನಮಸ್ಕಾರ', 'നമസ്കാരം',
  'নমস্কাৰ', 'નમસ્તે', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'ନମସ୍କାର', 'السلام علیکم',
];

export const CATEGORIES = [
  'Apparel & Textiles',
  'Food & Beverage',
  'Handicrafts',
  'Wellness & Ayurveda',
  'Jewellery',
  'Electronics',
  'Home & Living',
  'Books & Stationery',
  'Sports & Fitness',
];

export const AUTH_METHODS = [
  { key: 'api_key_header', label: 'API key header', header: 'X-API-Key' },
  { key: 'bearer_token', label: 'Bearer token', header: 'Authorization' },
  { key: 'basic_auth', label: 'Basic auth', header: 'Authorization' },
];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

export const CAPABILITIES = [
  {
    key: 'track_order',
    title: 'Track order',
    description: 'Live status for "Where is my order?"',
    defaultPath: '/api/orders/{order_id}',
    defaultMethod: 'GET',
    defaultRequest: '{\n  "order_id": "ORD-1042"\n}',
    defaultResponse:
      '{\n  "status": "in_transit",\n  "courier": "Delhivery",\n  "eta": "2026-07-29",\n  "tracking_url": "https://track.example.com/ORD-1042"\n}',
  },
  {
    key: 'refund',
    title: 'Refund',
    description: 'Initiate and track refunds',
    defaultPath: '/api/orders/{order_id}/refund',
    defaultMethod: 'POST',
    defaultRequest: '{\n  "order_id": "ORD-1042",\n  "reason": "damaged_on_arrival"\n}',
    defaultResponse:
      '{\n  "refund_id": "rf_88h2",\n  "status": "initiated",\n  "amount": 12499,\n  "currency": "INR",\n  "eta_days": 5\n}',
  },
  {
    key: 'return_policy',
    title: 'Return policy',
    description: 'Eligibility, windows and conditions',
    defaultPath: '/api/policies/return',
    defaultMethod: 'GET',
    defaultRequest: '{\n  "product_id": "SKU-201"\n}',
    defaultResponse:
      '{\n  "returnable": true,\n  "window_days": 7,\n  "conditions": "Unworn, tags intact"\n}',
  },
  {
    key: 'reorder',
    title: 'Reorder',
    description: 'One-tap repeat purchase',
    defaultPath: '/api/orders/{order_id}/reorder',
    defaultMethod: 'POST',
    defaultRequest: '{\n  "order_id": "ORD-0977"\n}',
    defaultResponse:
      '{\n  "new_order_id": "ORD-1105",\n  "status": "created",\n  "payment_link": "https://pay.yourbusiness.in/ORD-1105"\n}',
  },
  {
    key: 'warranty',
    title: 'Warranty',
    description: 'Coverage checks and claims',
    defaultPath: '/api/warranty/{product_id}',
    defaultMethod: 'GET',
    defaultRequest: '{\n  "product_id": "SKU-201"\n}',
    defaultResponse:
      '{\n  "covered": true,\n  "expires": "2027-01-15",\n  "claim_url": "https://yourbusiness.in/warranty"\n}',
  },
  {
    key: 'exchange',
    title: 'Exchange',
    description: 'Swap size, colour or item',
    defaultPath: '/api/orders/{order_id}/exchange',
    defaultMethod: 'POST',
    defaultRequest: '{\n  "order_id": "ORD-1042",\n  "new_variant": "SKU-201-RED"\n}',
    defaultResponse:
      '{\n  "exchange_id": "ex_31kq",\n  "status": "approved",\n  "pickup_eta": "2026-07-30"\n}',
  },
  {
    key: 'cancel_order',
    title: 'Cancel order',
    description: 'Cancel before dispatch',
    defaultPath: '/api/orders/{order_id}/cancel',
    defaultMethod: 'POST',
    defaultRequest: '{\n  "order_id": "ORD-1042"\n}',
    defaultResponse: '{\n  "status": "cancelled",\n  "refund_eta_days": 3\n}',
  },
];

export const CAPABILITY_BY_KEY = Object.fromEntries(CAPABILITIES.map((c) => [c.key, c]));
export const CAPABILITY_KEYS = CAPABILITIES.map((c) => c.key);

export const SHOPIFY_SCOPES = ['read_orders', 'read_products'];

export const DEFAULT_ERRORS = [
  { code: '404', meaning: 'Order not found', customer_message: "Sorry, we couldn't find that order number" },
  { code: '401', meaning: 'Authentication failed', customer_message: "I'm having trouble reaching the store right now" },
  { code: '500', meaning: 'Server error', customer_message: 'Something went wrong on our side. Please try again shortly' },
];

export const SECTIONS = [
  { n: 1, label: 'Business profile', short: 'Profile' },
  { n: 2, label: 'Data source', short: 'Data' },
  { n: 3, label: 'API capabilities', short: 'Capabilities' },
  { n: 4, label: 'Languages', short: 'Languages' },
  { n: 5, label: 'Knowledge base', short: 'Knowledge' },
  { n: 6, label: 'Escalation & SLA', short: 'SLA' },
  { n: 7, label: 'Review & activate', short: 'Review' },
];

/** ○ empty · ● in progress · ✓ done — the design's status glyph set. */
export const STATUS_GLYPH = {
  done: { glyph: '✓', className: 'text-ok' },
  part: { glyph: '●', className: 'text-ink-muted' },
  empty: { glyph: '○', className: 'text-ink-faint' },
};

/** Mirror of backend slugify(). */
export function slugify(name) {
  const text = (name || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || 'your-business';
}

export function isValidJson(text) {
  if (!(text || '').trim()) return null; // empty is neither valid nor invalid
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function emptyContract(key) {
  return {
    name: key,
    enabled: true,
    source: 'custom',
    auto: false,
    locked: false,
    endpoint: '',
    method: CAPABILITY_BY_KEY[key].defaultMethod,
    description: '',
    parameters: { path: [], query: [] },
    request: { headers: [], body: '' },
    response: { sample: '', mapping: [] },
    errors: [],
    notes: '',
  };
}

export function shopifyContract(key, slug, subdomain) {
  const cap = CAPABILITY_BY_KEY[key];
  let path = cap.defaultPath;
  if (key === 'track_order') path = '/connectors/shopify/orders/{order_id}';
  if (key === 'refund') path = '/connectors/shopify/orders/{order_id}/refund';
  return {
    name: key,
    enabled: true,
    source: 'shopify_default',
    auto: true,
    locked: true,
    endpoint: path,
    method: cap.defaultMethod,
    description: cap.description,
    parameters: {
      path: [
        {
          name: 'order_id',
          type: 'string',
          required: true,
          example: '1001',
          description:
            'Shopify order number. Customers are identified by order number, never by name.',
        },
      ],
      query: [],
    },
    request: {
      headers: [{ name: 'X-Shopify-Access-Token', value: '{{credential_ref}}' }],
      body: cap.defaultMethod === 'GET' ? '' : cap.defaultRequest,
    },
    response: {
      sample: cap.defaultResponse,
      mapping: [
        { field: 'status', path: '$.displayFulfillmentStatus' },
        { field: 'amount', path: '$.totalPriceSet.shopMoney.amount' },
        { field: 'currency', path: '$.totalPriceSet.shopMoney.currencyCode' },
      ],
    },
    errors: DEFAULT_ERRORS.map((e) => ({ ...e })),
    notes: `Auto-configured from Shopify store ${subdomain || slug}.`,
  };
}

/** Capabilities the Shopify connector pre-fills on approve. */
export const SHOPIFY_AUTO_CAPABILITIES = ['track_order', 'refund'];

export function buildCurl(contract, baseUrl) {
  const base = (baseUrl || 'https://api.yourbusiness.in').replace(/\/+$/, '');
  const method = contract.method || 'GET';
  const path = contract.endpoint || '/';
  const lines = [`curl -X ${method} '${base}${path}'`];
  (contract.request?.headers || [])
    .filter((h) => (h.name || '').trim())
    .forEach((h) => lines.push(`  -H '${h.name}: ${h.value || ''}'`));
  const body = (contract.request?.body || '').trim();
  if (body && method !== 'GET') {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d '${body.replace(/\s*\n\s*/g, ' ')}'`);
  }
  return lines.join(' \\\n');
}
