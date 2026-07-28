import { useState } from 'react';
import { GREETINGS, LANGUAGES, LANGUAGE_BY_CODE } from '../lib/contract';
import SectionCard from './SectionCard';

/** Slow, low-contrast band of native-script greetings behind the chips. */
function GreetingMarquee() {
  const row = [...GREETINGS, ...GREETINGS];
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 select-none overflow-hidden"
      aria-hidden="true"
      data-testid="greeting-marquee"
    >
      <div className="ucxp-marquee-track flex w-max gap-10 whitespace-nowrap">
        {row.map((greeting, index) => (
          <span
            key={index}
            className="ucxp-native text-[42px] font-medium leading-[1.9] text-ink"
            style={{ opacity: 0.035 }}
          >
            {greeting}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function S4Languages({ sections, updateSection }) {
  const state = sections['4'] || {};
  const selected = state.selected || [];
  const [query, setQuery] = useState('');
  const set = (patch) => updateSection(4, patch);

  const visible = LANGUAGES.filter((lang) => {
    const q = query.trim();
    if (!q) return true;
    return (
      lang.english.toLowerCase().includes(q.toLowerCase()) || lang.native.includes(q)
    );
  });

  // Selected languages Bulbul cannot speak. Surfaced so a merchant never
  // promises their customer a voice reply the runtime will have to hand off.
  const textOnly = LANGUAGES.filter((lang) => selected.includes(lang.code) && !lang.voice);

  const toggle = (code) => {
    const next = selected.includes(code)
      ? selected.filter((c) => c !== code)
      : [...selected, code];
    const primary = next.includes(state.primary) ? state.primary : next[0] || '';
    set({ selected: next, primary });
  };

  return (
    <SectionCard
      testId="section-4"
      title="Languages"
      subtitle="Customers get replies in their own script. Select every language you can support."
    >
      <div className="relative">
        <GreetingMarquee />

        <div className="relative">
          <div className="mb-3.5 flex flex-wrap items-center gap-3">
            <input
              className="ucxp-input w-[220px] max-w-full"
              data-testid="language-search"
              placeholder="Search languages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="text-xs text-ink-muted" data-testid="language-count">
              {selected.length} of 13 selected
            </span>
            <span className="flex-1" />
            <button
              type="button"
              data-testid="select-all-languages"
              onClick={() =>
                set({
                  selected: LANGUAGES.map((l) => l.code),
                  primary: state.primary || 'te',
                })
              }
              className="text-[12.5px] text-ink underline underline-offset-2"
            >
              Select all
            </button>
            <span className="text-line" aria-hidden="true">·</span>
            <button
              type="button"
              data-testid="clear-all-languages"
              onClick={() => set({ selected: [], primary: '' })}
              className="text-[12.5px] text-ink-muted hover:text-err"
            >
              Clear all
            </button>
          </div>

          <div className="mb-5 flex flex-wrap gap-2.5" data-testid="language-chips">
            {visible.map((lang) => {
              const isSelected = selected.includes(lang.code);
              return (
                <button
                  key={lang.code}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  data-selected={String(isSelected)}
                  data-testid={`lang-${lang.code}`}
                  onClick={() => toggle(lang.code)}
                  className={`ucxp-chip-select flex items-center gap-2.5 rounded-full border
                              px-4 py-2.5 transition-colors hover:border-ink
                              ${isSelected ? 'border-ink bg-surface' : 'border-line bg-canvas'}`}
                >
                  <span
                    className={`text-[13px] leading-none ${isSelected ? 'text-ink' : 'text-ink-faint'}`}
                    aria-hidden="true"
                  >
                    {isSelected ? '✓' : '+'}
                  </span>
                  {/* leading-[1.9] must sit alongside the font-size utility, or
                      matras on तेलुगु/ಕನ್ನಡ/ଓଡ଼ିଆ clip against the line box. */}
                  <span className="ucxp-native text-base font-medium leading-[1.9]">{lang.native}</span>
                  <span className="text-xs text-ink-muted">{lang.english}</span>
                  {!lang.voice && (
                    <span
                      data-testid={`lang-textonly-${lang.code}`}
                      title="Understood and answered in text. Not spoken aloud yet."
                      className="rounded-full border border-line px-1.5 py-0.5 text-[10px]
                                 font-medium uppercase tracking-wide text-ink-faint"
                    >
                      Text only
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {textOnly.length > 0 && (
            <p className="ucxp-panel mb-5" data-testid="language-text-only-note">
              {textOnly.map((l) => l.english).join(' and ')}{' '}
              {textOnly.length === 1 ? 'is' : 'are'} understood and answered in text, but not
              spoken aloud yet — a call in {textOnly.length === 1 ? 'it' : 'them'} is handed to
              your team instead of being answered by voice.
            </p>
          )}

          {visible.length === 0 && (
            <p
              className="mb-5 rounded-input border border-dashed border-line-dashed p-3.5
                         text-center text-[12.5px] text-ink-muted"
              data-testid="language-empty"
            >
              No languages match “{query}” — try the English name, e.g. “Punjabi”.
            </p>
          )}

          {selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[13px] font-medium" htmlFor="primary-language">
                Primary language
              </label>
              <select
                id="primary-language"
                data-testid="primary-language"
                className="ucxp-select ucxp-native min-w-[200px] max-w-full leading-[1.9]"
                value={state.primary || ''}
                onChange={(e) => set({ primary: e.target.value })}
              >
                {selected.map((code) => {
                  const lang = LANGUAGE_BY_CODE[code];
                  return (
                    <option key={code} value={code}>
                      {lang.native} — {lang.english}
                    </option>
                  );
                })}
              </select>
              <span className="text-xs text-ink-muted">
                The assistant opens conversations in this language.
              </span>
            </div>
          ) : (
            <p className="ucxp-panel" data-testid="language-required">
              Select at least one language — it’s required before you can activate.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
