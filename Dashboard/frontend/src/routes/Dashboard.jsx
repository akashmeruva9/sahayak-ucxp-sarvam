import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CAPABILITY_BY_KEY, LANGUAGE_BY_CODE } from '../lib/contract';
import { api } from '../lib/api';
import ManifestPane from '../components/ManifestPane';
import {
  CompletionRing, ErrorPanel, Spinner, StatusPill,
} from '../components/Primitives';

/** Post-onboarding view: what is live, and one click back into editing. */
export default function Dashboard() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [manifest, setManifest] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const [manifestResult, businessResult] = await Promise.all([
      api.getManifest(businessId),
      api.getBusiness(businessId),
    ]);
    if (manifestResult.error || businessResult.error) {
      setError(manifestResult.error || businessResult.error);
      setLoading(false);
      return;
    }
    setError('');
    setManifest(manifestResult.manifest);
    setSummary(businessResult.summary);
    setSections(businessResult.business.sections || {});
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [businessId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-ink-muted">
        <Spinner /> Loading your dashboard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-10">
        <ErrorPanel onRetry={load}>{error}</ErrorPanel>
        <Link to="/" className="ucxp-link mt-5 inline-block text-[13px]">
          ← Back to your businesses
        </Link>
      </div>
    );
  }

  const activation = sections['7'] || {};
  const ds = sections['2'] || {};
  const capabilities = manifest?.capabilities || [];
  const languages = manifest?.languages || [];

  const stats = [
    { label: 'Capabilities live', value: capabilities.length },
    { label: 'Languages', value: languages.length },
    { label: 'FAQs', value: (manifest?.faq || []).length },
    {
      label: 'Data source',
      value: ds.type === 'shopify' ? 'Shopify' : ds.type === 'custom' ? 'Custom API' : 'None',
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-line bg-canvas">
        <div className="mx-auto flex h-[58px] max-w-[1360px] items-center gap-3.5 px-6" data-testid="header-bar">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex-none text-[13px] text-ink-muted hover:text-ink"
          >
            ← Businesses
          </button>
          <span className="h-5 w-px flex-none bg-line" aria-hidden="true" />
          <span className="truncate text-sm font-semibold tracking-tight">
            {summary?.name || 'Untitled business'}
          </span>
          <StatusPill status={summary?.status} />
          <span className="flex-1" />
          <button
            type="button"
            data-testid="dashboard-edit"
            onClick={() => navigate(`/business/${businessId}`)}
            className="ucxp-btn-secondary ucxp-press px-3.5 py-1.5 text-[13px]"
          >
            Edit sections
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1360px] items-start gap-5 px-6 pb-16 pt-7
                       grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,430px)]">
        <div className="flex flex-col gap-4">
          {/* stat row */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
            data-testid="dashboard-stats"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-card border border-line bg-canvas px-4 py-3.5">
                <div className="text-[22px] font-semibold tracking-tight">{stat.value}</div>
                <div className="mt-0.5 text-xs text-ink-muted">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* completion */}
          <div className="flex items-center gap-4 rounded-card border border-line bg-canvas p-5">
            <CompletionRing pct={summary?.completion || 0} />
            <div className="flex-1">
              <div className="text-base font-semibold">{summary?.completion || 0}% complete</div>
              <div className="text-[12.5px] text-ink-muted">
                {activation.activated
                  ? `Published v${activation.version || 1} — edits republish automatically.`
                  : 'Not published yet. Finish the remaining sections to activate.'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/business/${businessId}`)}
              className="ucxp-btn-primary ucxp-press"
            >
              {activation.activated ? 'Edit' : 'Finish setup'}
            </button>
          </div>

          {/* capabilities */}
          <div className="rounded-card border border-line bg-canvas p-5">
            <h2 className="mb-3 text-sm font-semibold">Live capabilities</h2>
            {capabilities.length === 0 ? (
              <p className="rounded-input border border-dashed border-line-dashed p-4 text-center
                            text-[13px] text-ink-muted">
                No capabilities enabled yet — the assistant will answer from your knowledge base.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {capabilities.map((cap) => (
                  <div
                    key={cap.name}
                    className="flex flex-wrap items-center gap-3 rounded-input border
                               border-line px-3.5 py-2.5"
                  >
                    <span className="font-mono text-[13px] font-medium">{cap.name}</span>
                    <span className="ucxp-chip font-mono">{cap.method}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted">
                      {cap.endpoint}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {CAPABILITY_BY_KEY[cap.name]?.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* languages */}
          <div className="rounded-card border border-line bg-canvas p-5">
            <h2 className="mb-3 text-sm font-semibold">Languages served</h2>
            <div className="flex flex-wrap gap-2">
              {languages.length === 0 ? (
                <span className="text-[13px] text-ink-muted">None selected yet.</span>
              ) : (
                languages.map((code) => {
                  const lang = LANGUAGE_BY_CODE[code.split('-')[0]];
                  const primary = code === manifest?.primary_language;
                  return (
                    <span
                      key={code}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2
                                  ${primary ? 'border-ink bg-surface' : 'border-line'}`}
                    >
                      <span className="ucxp-native text-[15px] font-medium leading-[1.9]">
                        {lang?.native || code}
                      </span>
                      <span className="text-xs text-ink-muted">{lang?.english}</span>
                      {primary && <span className="ucxp-pill bg-ink text-white">Primary</span>}
                    </span>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <ManifestPane
          manifest={manifest}
          status={activation.activated ? 'active' : 'draft'}
          version={activation.version}
          maxHeight="calc(100vh - 160px)"
        />
      </main>
    </div>
  );
}
