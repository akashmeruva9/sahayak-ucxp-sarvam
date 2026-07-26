import {
  CAPABILITIES, SHOPIFY_AUTO_CAPABILITIES, emptyContract, shopifyContract,
} from '../lib/contract';
import ContractEditor from '../components/ContractEditor';
import { Toggle, useToast } from '../components/Primitives';
import SectionCard from './SectionCard';

export default function S3Capabilities({ sections, updateSection, slug }) {
  const toast = useToast();
  const caps = (sections['3'] || {}).caps || {};
  const ds = sections['2'] || {};
  const shopifyConnected = ds.type === 'shopify' && ds.connected;
  const subdomain = (ds.store || '').replace('.myshopify.com', '');
  const baseUrl = ds.type === 'custom' ? ds.base : `https://${subdomain}.myshopify.com`;

  const setCaps = (mutate) =>
    updateSection(3, (current) => ({ ...current, caps: mutate({ ...(current.caps || {}) }) }));

  const toggle = (key, on) =>
    setCaps((next) => {
      if (!on) {
        // Keep the contract so re-enabling does not lose the merchant's typing.
        next[key] = { ...(next[key] || emptyContract(key)), enabled: false };
        return next;
      }
      const existing = next[key];
      if (existing) {
        next[key] = { ...existing, enabled: true };
      } else if (shopifyConnected && SHOPIFY_AUTO_CAPABILITIES.includes(key)) {
        // Only the capabilities the Shopify connector can actually serve get a
        // seeded, connector-managed contract. Shopify exposes no warranty or
        // exchange endpoint, so those must start blank and editable even when a
        // store is connected — otherwise the merchant is handed a locked
        // contract they can neither use nor fill in.
        next[key] = shopifyContract(key, slug, subdomain);
      } else {
        next[key] = emptyContract(key);
      }
      return next;
    });

  const update = (key, contract) => setCaps((next) => ({ ...next, [key]: contract }));

  const customize = (key) => {
    setCaps((next) => ({
      ...next,
      [key]: { ...next[key], locked: false, source: 'customized' },
    }));
    toast('Contract unlocked — every field is now editable');
  };

  const reset = (key) => {
    setCaps((next) => ({ ...next, [key]: shopifyContract(key, slug, subdomain) }));
    toast('Restored Shopify connector defaults');
  };

  return (
    <SectionCard
      testId="section-3"
      title="API capabilities"
      subtitle="Enable what your systems support. Each capability becomes a machine-readable contract in your manifest."
      note="Flip a toggle to open that capability's contract editor — endpoint, parameters, request and response, error codes and a test call."
    >
      <div className="flex flex-col gap-3">
        {CAPABILITIES.map((cap) => {
          const contract = caps[cap.key];
          const on = Boolean(contract?.enabled);
          return (
            <div
              key={cap.key}
              data-testid={`cap-card-${cap.key}`}
              className={`rounded-input border bg-canvas ${on ? 'border-ink/25' : 'border-line'}`}
            >
              <div className="flex items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-medium">{cap.key}</span>
                    {contract?.auto && (
                      <span
                        className="ucxp-pill border border-line bg-surface text-ink-muted"
                        data-testid={`badge-${cap.key}`}
                      >
                        {contract.locked
                          ? 'Auto-configured from Shopify'
                          : 'Customized · Shopify'}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-muted">{cap.description}</div>
                </div>
                <Toggle
                  checked={on}
                  onChange={(value) => toggle(cap.key, value)}
                  label={`Enable ${cap.key}`}
                />
              </div>

              {on && contract && (
                <ContractEditor
                  contract={contract}
                  baseUrl={baseUrl}
                  onChange={(next) => update(cap.key, next)}
                  onCustomize={() => customize(cap.key)}
                  onReset={() => reset(cap.key)}
                />
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
