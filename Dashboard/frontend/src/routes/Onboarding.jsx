import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { STATUS_GLYPH, sectionsFor, slugify } from '../lib/contract';
import { useBusiness } from '../state/useBusiness';
import ManifestPane from '../components/ManifestPane';
import {
  BusinessAvatar, CompletionRing, ErrorPanel, Spinner, StatusPill,
} from '../components/Primitives';
import S1BusinessProfile from '../sections/S1BusinessProfile';
import S2DataSource from '../sections/S2DataSource';
import S3Capabilities from '../sections/S3Capabilities';
import S4Languages from '../sections/S4Languages';
import S5Knowledge from '../sections/S5Knowledge';
import S6Escalation from '../sections/S6Escalation';
import S7Review from '../sections/S7Review';

const SECTION_COMPONENTS = {
  1: S1BusinessProfile,
  2: S2DataSource,
  3: S3Capabilities,
  4: S4Languages,
  5: S5Knowledge,
  6: S6Escalation,
  7: S7Review,
};

export default function Onboarding() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [section, setSection] = useState(1);
  // Naming a draft adopts the real slug, so the business is re-keyed and the URL
  // has to follow it. `replace` keeps the placeholder id out of the back stack.
  const handleRename = useCallback(
    (newId) => navigate(`/business/${newId}`, { replace: true }),
    [navigate],
  );
  const state = useBusiness(businessId, handleRename);
  const {
    business, sections, statuses, completion, missing, manifest,
    loading, error, saveState, dirty, updateSection, flushAll, reload,
  } = state;

  if (loading && !business) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-ink-muted">
        <Spinner /> Loading your business…
      </div>
    );
  }

  if (error && !business) {
    return (
      <div className="mx-auto max-w-xl p-10">
        <ErrorPanel onRetry={reload}>{error}</ErrorPanel>
        <button type="button" onClick={() => navigate('/')} className="ucxp-link mt-5 text-[13px]">
          ← Back to your businesses
        </button>
      </div>
    );
  }

  const profile = sections['1'] || {};
  const activation = sections['7'] || {};
  const bizName = profile.name || 'Untitled business';
  const slug = business?.id || slugify(profile.name);
  const visible = sectionsFor(sections);
  const doneCount = visible.filter((s) => statuses[String(s.n)] === 'done').length;
  // Picking "No data source" while standing in section 3 takes that section away
  // underneath you. Fall back to the Data source step -- the one you were just
  // on -- rather than rendering a section the sidebar no longer lists.
  const current = visible.some((s) => s.n === section) ? section : 2;
  const Section = SECTION_COMPONENTS[current];

  const sectionProps = {
    sections,
    statuses,
    updateSection,
    businessId,
    slug,
    missing,
    completion,
    manifest,
    flushAll,
    goToSection: setSection,
  };

  return (
    <div className="min-h-screen">
      {/* ---- header ---- */}
      <header className="sticky top-0 z-50 border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3.5 px-6" data-testid="header-bar">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex-none whitespace-nowrap text-[13px] text-ink-muted hover:text-ink"
          >
            ← Businesses
          </button>
          <span className="h-5 w-px flex-none bg-line" aria-hidden="true" />
          {/* Raw section state here, so the camelCase spelling -- not logo_url.
              Hidden on the narrowest screens: this header is already at the
              width budget at 375px (gate F9), and you know which business you
              are in from the name beside it. */}
          <span className="hidden flex-none sm:block">
            <BusinessAvatar name={bizName} logoUrl={profile.logoUrl} size={24} />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">{bizName}</span>
          <StatusPill status={activation.activated ? 'Active' : 'Draft'} />
          <span className="flex-1" />
          <span
            className="whitespace-nowrap text-xs text-ink-muted"
            data-testid="save-state"
            data-dirty={String(dirty)}
            data-save-state={saveState}
            aria-live="polite"
          >
            {saveState === 'saving' && <>Saving…</>}
            {saveState === 'error' && <span className="text-err">Couldn’t save — retrying</span>}
            {(saveState === 'saved' || saveState === 'idle') && (
              <>
                <span className="text-ok">✓</span> All changes saved
              </>
            )}
          </span>
          <span
            className="hidden flex-none rounded-full border border-line bg-surface px-2.5 py-[3px]
                       font-mono text-[11.5px] text-ink sm:inline"
            data-testid="slug-pill"
          >
            {slug}
          </span>
        </div>
      </header>

      {/* ---- narrow tab strip (replaces the sidebar under 1200px) ---- */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto px-6 pb-1 pt-3 xl:hidden"
        data-testid="section-tabs"
      >
        <span className="flex-none rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink">
          {completion}%
        </span>
        {visible.map((s) => {
          const glyph = STATUS_GLYPH[statuses[String(s.n)] || 'empty'];
          const active = current === s.n;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setSection(s.n)}
              aria-current={active ? 'step' : undefined}
              className={`ucxp-press flex flex-none items-center gap-1.5 whitespace-nowrap
                          rounded-full border px-3 py-1.5 text-[12.5px] font-medium
                          ${active ? 'border-ink bg-ink text-white' : 'border-line bg-canvas text-ink'}`}
            >
              <span className={active ? 'text-white' : glyph.className} aria-hidden="true">
                {glyph.glyph}
              </span>
              {s.short}
            </button>
          );
        })}
      </div>

      {/* ---- grid: sidebar | main | manifest ---- */}
      <div
        className="mx-auto grid w-full max-w-[1600px] items-start gap-5 px-6 pb-16 pt-5
                   grid-cols-1 xl:grid-cols-[236px_minmax(0,1fr)_minmax(380px,450px)]"
      >
        {/* sidebar */}
        <nav
          className="sticky top-[76px] hidden flex-col gap-3 xl:flex"
          aria-label="Onboarding sections"
          data-testid="sidebar"
        >
          <div className="flex items-center gap-3 rounded-card border border-line bg-canvas p-3.5">
            <CompletionRing pct={completion} />
            <div>
              <div className="text-base font-semibold">{completion}%</div>
              <div className="text-[11.5px] text-ink-muted">
                {doneCount} of {visible.length} sections done
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-0.5 rounded-card border border-line bg-canvas p-2">
            {visible.map((s) => {
              const glyph = STATUS_GLYPH[statuses[String(s.n)] || 'empty'];
              const active = current === s.n;
              return (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => setSection(s.n)}
                  aria-current={active ? 'step' : undefined}
                  data-testid={`nav-section-${s.n}`}
                  className={`flex items-center gap-2.5 rounded-input px-2.5 py-2 text-left
                              transition-colors hover:bg-surface
                              ${active ? 'bg-surface' : 'bg-transparent'}`}
                >
                  <span
                    className={`w-4 flex-none text-center text-[12.5px] ${glyph.className}`}
                    aria-hidden="true"
                  >
                    {glyph.glyph}
                  </span>
                  <span
                    className={`text-[13.5px] ${active ? 'font-semibold text-ink' : 'text-ink'}`}
                  >
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="px-1 text-[11.5px] leading-relaxed text-ink-faint">
            Complete sections in any order. Everything autosaves.
          </p>
        </nav>

        {/* main */}
        <main className="flex min-w-0 flex-col gap-4">
          {error && business && <ErrorPanel onRetry={reload}>{error}</ErrorPanel>}
          <Section key={current} {...sectionProps} />
        </main>

        {/* manifest */}
        <ManifestPane
          manifest={manifest}
          status={activation.activated ? 'active' : 'draft'}
          version={activation.version}
        />
      </div>
    </div>
  );
}
