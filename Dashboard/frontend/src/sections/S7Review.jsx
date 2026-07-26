import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LANGUAGE_BY_CODE, SECTIONS, STATUS_GLYPH } from '../lib/contract';
import { api, copyText, downloadJson } from '../lib/api';
import { ErrorPanel, Spinner, useToast } from '../components/Primitives';
import SectionCard from './SectionCard';

/** One-line summary per section for the checklist. */
function summarize(n, sections) {
  const p = sections['1'] || {};
  const d = sections['2'] || {};
  const caps = Object.entries((sections['3'] || {}).caps || {}).filter(([, c]) => c?.enabled);
  const l = sections['4'] || {};
  const kb = sections['5'] || {};
  const e = sections['6'] || {};

  switch (n) {
    case 1:
      return [p.name, p.category, p.city].filter(Boolean).join(' · ') || 'Not started';
    case 2:
      if (d.type === 'shopify') {
        return d.connected
          ? `Shopify · OAuth · read_orders, read_products`
          : 'Shopify — not connected yet';
      }
      if (d.type === 'custom') return d.base || 'Custom API — add base URL';
      if (d.type === 'none') return 'No data source — knowledge base only';
      return 'Not chosen yet';
    case 3:
      return caps.length
        ? `${caps.length} enabled: ${caps.map(([k]) => k).join(', ')}`
        : 'None enabled (optional)';
    case 4: {
      const picked = l.selected || [];
      if (!picked.length) return 'No languages selected';
      const natives = picked.map((c) => LANGUAGE_BY_CODE[c]?.native).filter(Boolean);
      const primary = LANGUAGE_BY_CODE[l.primary]?.native || '—';
      return `${natives.join(' · ')} — primary ${primary}`;
    }
    case 5: {
      const faqs = (kb.faqs || []).filter((f) => (f.q || '').trim()).length;
      const policies = Object.values(kb.policies || {}).filter((v) => (v || '').trim()).length;
      return `${faqs} FAQs · ${policies} policies`;
    }
    case 6:
      return `${e.fr || '—'}h first response · ${e.res || '—'}d resolution · 3-rung ladder`;
    default:
      return '';
  }
}

export default function S7Review({
  sections, statuses, missing, manifest, businessId, flushAll, goToSection,
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');

  const text = manifest ? JSON.stringify(manifest, null, 2) : '';
  const blocked = (missing || []).length > 0;

  const activate = async () => {
    setActivating(true);
    setError('');
    await flushAll();
    const result = await api.activate(businessId);
    setActivating(false);

    if (result.error || result.ok === false) {
      setError(
        result.error ||
          'A few sections still need attention before you can activate.',
      );
      return;
    }
    navigate(`/business/${businessId}/success`);
  };

  return (
    <SectionCard
      testId="section-7"
      title="Review & activate"
      subtitle="One last look. Activation publishes your manifest to a stable URL that support runtimes read."
    >
      {/* checklist */}
      <div className="mb-4 overflow-hidden rounded-input border border-line" data-testid="checklist">
        {SECTIONS.slice(0, 6).map((s) => {
          const glyph = STATUS_GLYPH[statuses[String(s.n)] || 'empty'];
          return (
            <div
              key={s.n}
              className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0"
            >
              <span className={`w-[18px] flex-none text-center text-[13px] ${glyph.className}`}>
                {glyph.glyph}
              </span>
              <span className="w-[150px] flex-none text-[13.5px] font-medium">{s.label}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
                {summarize(s.n, sections)}
              </span>
              <button
                type="button"
                onClick={() => goToSection(s.n)}
                className="flex-none text-[12.5px] text-ink underline underline-offset-2"
              >
                Edit
              </button>
            </div>
          );
        })}
      </div>

      {/* blocking items */}
      {blocked && (
        <div className="ucxp-panel-err mb-4" data-testid="missing-panel">
          <div className="mb-2 text-[13px] font-semibold text-err">Before you can activate</div>
          <div className="flex flex-col gap-1.5">
            {missing.map((item) => (
              <div key={item.text} className="flex items-center gap-2">
                <span className="h-[5px] w-[5px] flex-none rounded-full bg-err" aria-hidden="true" />
                <span className="flex-1 text-[12.5px] text-err-deep">{item.text}</span>
                <button
                  type="button"
                  onClick={() => goToSection(item.section)}
                  className="text-[12.5px] text-err underline underline-offset-2"
                >
                  Fix →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorPanel>{error}</ErrorPanel>
        </div>
      )}

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          data-testid="review-download"
          disabled={!text}
          title={!text ? 'The manifest is still being assembled' : undefined}
          onClick={() => {
            downloadJson('support.manifest.json', text);
            toast('support.manifest.json downloaded');
          }}
          className="ucxp-btn-secondary ucxp-press"
        >
          Download JSON
        </button>
        <button
          type="button"
          data-testid="review-copy"
          disabled={!text}
          title={!text ? 'The manifest is still being assembled' : undefined}
          onClick={async () => {
            const ok = await copyText(text);
            toast(ok ? 'Copied to clipboard' : 'Could not copy — select the JSON manually');
          }}
          className="ucxp-btn-secondary ucxp-press"
        >
          Copy JSON
        </button>
        <span className="flex-1" />
        <button
          type="button"
          data-testid="activate"
          disabled={blocked || activating}
          title={blocked ? 'Finish the items listed above first' : undefined}
          onClick={activate}
          className="ucxp-btn-primary ucxp-press px-5 py-2.5 text-sm"
        >
          {activating && <Spinner light size={14} />}
          Activate business
        </button>
      </div>

      <p className="mt-3.5 text-xs text-ink-faint">
        You can edit any section after activation — changes republish automatically.
      </p>
    </SectionCard>
  );
}
