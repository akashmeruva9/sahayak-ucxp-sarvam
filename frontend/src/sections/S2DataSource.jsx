import { useEffect, useState } from 'react';
import { AUTH_METHODS, SHOPIFY_AUTO_CAPABILITIES, SHOPIFY_SCOPES, shopifyContract } from '../lib/contract';
import { api } from '../lib/api';
import {
  ErrorPanel, Field, LockIcon, Modal, Spinner, useToast,
} from '../components/Primitives';
import SectionCard from './SectionCard';

const SOURCES = [
  { value: 'shopify', title: 'Shopify', desc: 'Connect in one click via OAuth. No keys to paste.' },
  { value: 'custom', title: 'Custom REST API', desc: 'Describe your endpoints. Secrets go to the vault.' },
  { value: 'none', title: 'No data source', desc: 'Answer from knowledge base and policies only.' },
];

export default function S2DataSource({ sections, updateSection, businessId, slug }) {
  const toast = useToast();
  const d = sections['2'] || {};
  const profile = sections['1'] || {};
  const set = (patch) => updateSection(2, patch);

  const [seeded, setSeeded] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [subdomain, setSubdomain] = useState(d.store?.replace('.myshopify.com', '') || '');
  const [linkBusy, setLinkBusy] = useState(false);
  const [reachBusy, setReachBusy] = useState(false);
  const [reachMessage, setReachMessage] = useState('');

  useEffect(() => {
    api.meta().then((result) => {
      if (!result.error) setSeeded(result.seeded_stores || []);
    });
  }, []);

  const credEmail = profile.email || 'your support email';

  /* ---- Shopify ---------------------------------------------------------- */
  const approve = async () => {
    setConnecting(true);
    setConnectError('');
    const result = await api.connectShopify({ subdomain, business_id: businessId });
    setConnecting(false);

    if (result.error || result.ok === false) {
      setConnectError(result.error || 'We could not connect that store.');
      return;
    }

    setModalOpen(false);
    set({
      type: 'shopify',
      connected: true,
      store: result.store,
      productCount: result.product_count,
      orderCount: result.order_count,
      currency: result.currency,
      credentialRef: result.credential_ref,
    });

    // Seed the two contracts the connector can configure from a live store.
    updateSection(3, (current) => {
      const caps = { ...(current.caps || {}) };
      SHOPIFY_AUTO_CAPABILITIES.forEach((key) => {
        caps[key] = shopifyContract(key, slug, result.subdomain);
      });
      return { ...current, caps };
    });
    toast('Shopify connected — 2 capabilities auto-configured');
  };

  const disconnect = () => {
    set({ type: 'shopify', connected: false, store: '', productCount: 0, orderCount: 0,
          currency: '', credentialRef: '' });
    updateSection(3, (current) => {
      const caps = { ...(current.caps || {}) };
      SHOPIFY_AUTO_CAPABILITIES.forEach((key) => {
        if (caps[key]) caps[key] = { ...caps[key], auto: false, locked: false, source: 'customized' };
      });
      return { ...current, caps };
    });
    toast('Shopify disconnected — credentials removed from vault');
  };

  /* ---- Custom REST ------------------------------------------------------ */
  const sendLink = async () => {
    setLinkBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    setLinkBusy(false);
    set({ linkSent: true });
    toast(`Secure credential link sent to ${credEmail}`);
  };

  const checkReachable = async () => {
    setReachBusy(true);
    setReachMessage('');
    const result = await api.connectCustom({
      base_url: d.base || '',
      auth_method: d.auth || 'api_key_header',
      header_name: d.header || 'X-API-Key',
      business_id: businessId,
    });
    setReachBusy(false);
    if (result.error) {
      setReachMessage(result.error);
      return;
    }
    setReachMessage(
      result.reachable
        ? `Reachable. ${result.message || ''}`.trim()
        : result.message || 'Not reachable yet.',
    );
  };

  const baseValid = /^https?:\/\/.+/.test(d.base || '');

  return (
    <>
      <SectionCard
        testId="section-2"
        title="Data source"
        subtitle="How UCXP reads live order data. You approve access — we never see passwords or ask you to paste raw keys."
      >
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SOURCES.map((source) => {
            const selected = d.type === source.value;
            return (
              <button
                key={source.value}
                type="button"
                data-testid={`source-${source.value}`}
                aria-pressed={selected}
                onClick={() => set({ type: source.value })}
                className={`flex items-start gap-2.5 rounded-input border p-3.5 text-left
                            transition-colors hover:border-ink
                            ${selected ? 'border-ink bg-surface' : 'border-line bg-canvas'}`}
              >
                <span
                  className={`mt-px flex h-4 w-4 flex-none items-center justify-center rounded-full
                              border-[1.5px] ${selected ? 'border-ink' : 'border-line'}`}
                  aria-hidden="true"
                >
                  <span className={`h-2 w-2 rounded-full ${selected ? 'bg-ink' : ''}`} />
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold">{source.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-muted">
                    {source.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {!d.type && (
          <p className="ucxp-panel">
            Pick one to continue — you can change this anytime without losing your other sections.
          </p>
        )}

        {/* ---------------- Shopify ---------------- */}
        {d.type === 'shopify' && !d.connected && (
          <div className="flex flex-col items-start gap-3 rounded-input border border-line p-5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-input bg-ok-tint
                         text-base font-semibold text-ok"
              aria-hidden="true"
            >
              S
            </span>
            <div>
              <div className="text-sm font-semibold">Connect your Shopify store</div>
              <div className="mt-0.5 text-[12.5px] text-ink-muted">
                One click. Orders and products sync automatically.
              </div>
            </div>

            <Field label="Store subdomain" className="w-full max-w-md">
              <input
                className="ucxp-input-mono"
                list="seeded-stores"
                data-testid="shopify-subdomain"
                placeholder="your-store"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.trim())}
              />
              <datalist id="seeded-stores">
                {seeded.map((store) => (
                  <option key={store.subdomain} value={store.subdomain}>
                    {store.name}
                  </option>
                ))}
              </datalist>
            </Field>

            <button
              type="button"
              data-testid="connect-shopify"
              disabled={!subdomain}
              title={!subdomain ? 'Enter your store subdomain first' : undefined}
              onClick={() => {
                setConnectError('');
                setModalOpen(true);
              }}
              className="ucxp-btn-primary ucxp-press"
            >
              Connect Shopify
            </button>

            {connectError && <ErrorPanel>{connectError}</ErrorPanel>}

            <p className="text-xs leading-relaxed text-ink-muted">
              You approve access on Shopify’s own page. We never see or store your password.
              Access is scoped to reading orders and products, and revocable anytime.
            </p>
          </div>
        )}

        {d.type === 'shopify' && d.connected && (
          <div className="flex flex-col gap-3" data-testid="shopify-connected">
            <div className="ucxp-panel-ok flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] font-semibold text-ok" aria-hidden="true">✓</span>
              <span className="text-[13px] font-medium">Connected via Shopify OAuth</span>
              <span className="font-mono text-xs">{d.store}</span>
              <span className="flex-1" />
              <button
                type="button"
                data-testid="shopify-disconnect"
                onClick={disconnect}
                className="text-[12.5px] text-ink-muted hover:text-err"
              >
                Disconnect
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-muted">Scopes</span>
              {SHOPIFY_SCOPES.map((scope) => (
                <span
                  key={scope}
                  className="rounded-full border border-line bg-surface px-2.5 py-[3px]
                             font-mono text-[11.5px] text-ink"
                >
                  {scope}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-2.5">
              {[
                { value: d.productCount ?? 0, label: 'Products' },
                { value: d.orderCount ?? 0, label: 'Orders' },
                { value: d.currency || '—', label: 'Currency' },
              ].map((tile) => (
                <div
                  key={tile.label}
                  className="min-w-[96px] rounded-input border border-line px-4 py-2.5"
                  data-testid={`stat-${tile.label.toLowerCase()}`}
                >
                  <div className="text-base font-semibold">{tile.value}</div>
                  <div className="text-[11.5px] text-ink-muted">{tile.label}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 rounded-input border border-line
                            bg-surface px-3.5 py-3">
              <LockIcon />
              <span className="font-mono text-xs" data-testid="vault-ref">
                {d.credentialRef || `vault://${slug}`}
              </span>
              <span className="text-xs text-ink-muted">
                — secret held in the UCXP vault, never in your manifest
              </span>
            </div>
          </div>
        )}

        {/* ---------------- Custom REST ---------------- */}
        {d.type === 'custom' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field
                label="Base URL"
                className="sm:col-span-2"
                error={d.base && !baseValid ? 'Include https:// at the start' : ''}
              >
                <input
                  className="ucxp-input-mono"
                  data-testid="custom-base"
                  placeholder="https://api.yourbusiness.in/v1"
                  value={d.base || ''}
                  onChange={(e) => set({ base: e.target.value })}
                />
              </Field>

              <Field label="Auth method">
                <select
                  className="ucxp-select"
                  data-testid="custom-auth"
                  value={d.auth || 'api_key_header'}
                  onChange={(e) => {
                    const method = AUTH_METHODS.find((a) => a.key === e.target.value);
                    set({ auth: e.target.value, header: method?.header || '' });
                  }}
                >
                  {AUTH_METHODS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Header name">
                <input
                  className="ucxp-input-mono"
                  data-testid="custom-header"
                  placeholder="X-API-Key"
                  value={d.header || ''}
                  onChange={(e) => set({ header: e.target.value })}
                />
              </Field>
            </div>

            <div className="flex items-start gap-2.5 rounded-input border border-line bg-surface
                            px-3.5 py-3">
              <span className="mt-0.5">
                <LockIcon />
              </span>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                Secrets live in the UCXP vault, referenced by{' '}
                <span className="font-mono text-[11.5px] text-ink">credential_ref</span>. They never
                appear in your manifest, exports, or this screen.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="check-reachable"
                onClick={checkReachable}
                disabled={!baseValid || reachBusy}
                title={!baseValid ? 'Add a valid https:// base URL first' : undefined}
                className="ucxp-btn-secondary ucxp-press"
              >
                {reachBusy && <Spinner />}
                Test connection
              </button>
              {reachMessage && (
                <span className="text-[12.5px] text-ink-muted" data-testid="reach-message">
                  {reachMessage}
                </span>
              )}
            </div>

            {!d.linkSent ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="send-credential-link"
                  onClick={sendLink}
                  disabled={linkBusy}
                  className="ucxp-btn-secondary ucxp-press"
                >
                  {linkBusy && <Spinner />}
                  Send secure credential link
                </button>
                <span className="text-xs text-ink-muted">
                  You’ll add the secret via a secure one-time link sent to {credEmail}.
                </span>
              </div>
            ) : (
              <div className="ucxp-panel-ok flex flex-wrap items-center gap-2.5"
                   data-testid="credential-link-sent">
                <span aria-hidden="true">✓</span>
                <span className="text-[12.5px]">
                  Secure link sent to {credEmail} — it expires in 15 minutes.
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={sendLink}
                  className="text-[12.5px] text-ink-muted underline underline-offset-2"
                >
                  Send again
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------------- None ---------------- */}
        {d.type === 'none' && (
          <p className="ucxp-panel" data-testid="no-source-note">
            UCXP will answer from your knowledge base and policies only. Order-specific questions
            get a polite handoff to {credEmail}. You can connect a data source anytime.
          </p>
        )}
      </SectionCard>

      {/* ---------------- OAuth consent modal ---------------- */}
      <Modal open={modalOpen} onClose={() => !connecting && setModalOpen(false)} labelledBy="oauth-title">
        <div className="flex items-center border-b border-line bg-surface px-3.5 py-2.5">
          <span className="mx-auto flex items-center gap-2 rounded-full border border-line
                           bg-canvas px-4 py-1">
            <LockIcon size={11} />
            <span className="font-mono text-[11px] text-ink-muted">
              accounts.shopify.com/oauth/authorize
            </span>
          </span>
        </div>

        <div className="px-6 pb-5 pt-6">
          <div className="mb-4 flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-input bg-ok-tint
                         text-[17px] font-semibold text-ok"
              aria-hidden="true"
            >
              S
            </span>
            <div>
              <div id="oauth-title" className="text-[14.5px] font-semibold">
                {subdomain}.myshopify.com
              </div>
              <div className="text-xs text-ink-muted">Signed in as owner</div>
            </div>
          </div>

          <p className="mb-2.5 text-[13.5px] font-medium">UCXP wants to:</p>
          <div className="mb-4 rounded-input border border-line">
            {[
              ['Read orders', 'Status, fulfilment and tracking — read-only'],
              ['Read products', 'Titles, variants and availability — read-only'],
            ].map(([title, sub], index) => (
              <div
                key={title}
                className={`flex gap-2.5 px-3.5 py-3 ${index === 0 ? 'border-b border-line-soft' : ''}`}
              >
                <span className="text-[13px] text-ok" aria-hidden="true">✓</span>
                <div>
                  <div className="text-[13px] font-medium">{title}</div>
                  <div className="text-[11.5px] text-ink-muted">{sub}</div>
                </div>
              </div>
            ))}
          </div>

          <p className="mb-4 text-[11.5px] leading-relaxed text-ink-muted">
            UCXP never sees your password. You can revoke this access in Shopify at any time.
          </p>

          {connectError && (
            <div className="mb-4">
              <ErrorPanel>{connectError}</ErrorPanel>
            </div>
          )}

          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={connecting}
              className="ucxp-btn-secondary ucxp-press"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="oauth-approve"
              onClick={approve}
              disabled={connecting}
              className="ucxp-btn ucxp-press border-ok bg-ok text-white hover:bg-ok-deep"
            >
              {connecting && <Spinner light />}
              Approve
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
