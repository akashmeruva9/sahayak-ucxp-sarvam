import { useState } from 'react';
import { api } from '../lib/api';
import { Field, InlineError, Spinner, useToast } from '../components/Primitives';
import SectionCard from './SectionCard';

const POLICIES = [
  { key: 'return', label: 'Return policy', placeholder: 'Who can return what, and within how many days?' },
  { key: 'refund', label: 'Refund policy', placeholder: 'How and when money comes back.' },
  { key: 'shipping', label: 'Shipping policy', placeholder: 'Dispatch times, couriers, charges.' },
  { key: 'warranty', label: 'Warranty policy', placeholder: "What's covered, for how long." },
];

export default function S5Knowledge({ sections, updateSection }) {
  const toast = useToast();
  const kb = sections['5'] || {};
  const faqs = kb.faqs || [];
  const policies = kb.policies || {};
  const set = (patch) => updateSection(5, patch);

  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState('');

  const setFaqs = (next) => set({ faqs: next });

  const importFromUrl = async () => {
    setImportError('');
    setBusy(true);
    const result = await api.scrapeFaq(url);
    setBusy(false);
    if (result.error || result.ok === false) {
      setImportError(result.error || 'We could not read that page.');
      return;
    }
    setFaqs([...faqs, ...result.faqs]);
    toast(`${result.faqs.length} draft FAQs imported — review and edit below`);
  };

  const move = (index, delta) => {
    const next = [...faqs];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFaqs(next);
  };

  return (
    <SectionCard
      testId="section-5"
      title="Knowledge base"
      subtitle="FAQs and policies the assistant answers from before ever touching an API."
    >
      {/* import row */}
      <div className="mb-2 flex flex-wrap items-end gap-2.5">
        <Field label="Import from help URL" className="min-w-[240px] flex-1">
          <input
            className={`ucxp-input-mono ${importError ? 'border-err' : ''}`}
            data-testid="import-url"
            placeholder="https://yourbusiness.in/help"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <button
          type="button"
          data-testid="import-faq"
          onClick={importFromUrl}
          disabled={busy || !url.trim()}
          title={!url.trim() ? 'Enter your help page URL first' : undefined}
          className="ucxp-btn-secondary ucxp-press h-[39px]"
        >
          {busy && <Spinner />}
          Import
        </button>
      </div>
      <InlineError>{importError}</InlineError>

      <p className="mb-4 mt-1.5 text-xs text-ink-faint">
        We draft FAQs from your existing help page — you review and edit before they go live.
      </p>

      {/* FAQ rows */}
      <div className="mb-3.5 flex flex-col gap-2.5" data-testid="faq-list">
        {faqs.length === 0 ? (
          <p
            className="rounded-input border border-dashed border-line-dashed p-5 text-center
                       text-[13px] text-ink-muted"
            data-testid="faq-empty"
          >
            No FAQs yet — add one below or import from your help page above.
          </p>
        ) : (
          faqs.map((faq, index) => (
            <div key={index} className="flex gap-3 rounded-input border border-line p-3.5">
              <span
                className="mt-1.5 flex h-[22px] w-[22px] flex-none items-center justify-center
                           rounded-full bg-surface text-[11.5px] font-semibold text-ink"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="ucxp-input flex-1 px-2.5 py-2 text-[13.5px] font-medium"
                    data-testid={`faq-q-${index}`}
                    placeholder="Question"
                    value={faq.q || ''}
                    onChange={(e) => {
                      const next = [...faqs];
                      next[index] = { ...next[index], q: e.target.value };
                      setFaqs(next);
                    }}
                  />
                  {faq.draft && (
                    <span className="ucxp-pill border border-line bg-surface text-ink-muted">
                      Imported draft
                    </span>
                  )}
                </div>
                <textarea
                  className="ucxp-textarea px-2.5 py-2 text-[13px]"
                  rows={2}
                  data-testid={`faq-a-${index}`}
                  placeholder="Answer in plain language"
                  value={faq.a || ''}
                  onChange={(e) => {
                    const next = [...faqs];
                    next[index] = { ...next[index], a: e.target.value };
                    setFaqs(next);
                  }}
                />
              </div>
              <div className="flex flex-none flex-col gap-1">
                <button
                  type="button"
                  title={index === 0 ? 'Already first' : 'Move up'}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="h-[26px] w-[26px] rounded-btn border border-line text-xs
                             text-ink-muted hover:bg-surface disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  title={index === faqs.length - 1 ? 'Already last' : 'Move down'}
                  disabled={index === faqs.length - 1}
                  onClick={() => move(index, 1)}
                  className="h-[26px] w-[26px] rounded-btn border border-line text-xs
                             text-ink-muted hover:bg-surface disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  title="Remove"
                  data-testid={`faq-remove-${index}`}
                  onClick={() => setFaqs(faqs.filter((_, i) => i !== index))}
                  className="h-[26px] w-[26px] rounded-btn border border-line text-xs
                             text-ink-faint hover:border-err-line hover:text-err"
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        data-testid="add-faq"
        onClick={() => setFaqs([...faqs, { q: '', a: '' }])}
        className="ucxp-btn-secondary ucxp-press mb-6"
      >
        + Add FAQ
      </button>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {POLICIES.map((policy) => (
          <Field key={policy.key} label={policy.label}>
            <textarea
              className="ucxp-textarea text-[13px]"
              rows={3}
              data-testid={`policy-${policy.key}`}
              placeholder={policy.placeholder}
              value={policies[policy.key] || ''}
              onChange={(e) =>
                set({ policies: { ...policies, [policy.key]: e.target.value } })
              }
            />
          </Field>
        ))}
      </div>
    </SectionCard>
  );
}
