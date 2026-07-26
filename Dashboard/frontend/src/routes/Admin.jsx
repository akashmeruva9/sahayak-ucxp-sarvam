import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import AppHeader from '../components/AppHeader';
import ManifestPane from '../components/ManifestPane';
import {
  CompletionBar, ErrorPanel, Spinner, StatusPill,
} from '../components/Primitives';

const SOURCE_LABEL = { shopify: 'Shopify', custom: 'Custom API', none: '—', '': '—' };
const STATUS_FILTERS = ['All', 'Active', 'Draft'];
const SOURCE_FILTERS = [
  { label: 'All', value: 'All' },
  { label: 'Shopify', value: 'shopify' },
  { label: 'Custom API', value: 'custom' },
  { label: 'None', value: 'none' },
];

const GRID = '180px 1.3fr 1.5fr 1fr 110px 150px 90px 110px';

function Chip({ selected, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`ucxp-press rounded-full border px-3 py-1 text-xs font-medium transition-colors
                  ${selected ? 'border-ink bg-ink text-white' : 'border-line bg-canvas text-ink-muted'}`}
    >
      {children}
    </button>
  );
}

export default function Admin() {
  const [merchants, setMerchants] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, drafts: 0, shopify: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sort, setSort] = useState({ key: 'created_at', dir: -1 });

  const [detail, setDetail] = useState(null);
  const [detailManifest, setDetailManifest] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await api.adminMerchants();
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setError('');
    setMerchants(result.merchants || []);
    setStats(result.stats || {});
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(merchants.map((m) => m.category).filter(Boolean))).sort()],
    [merchants],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = merchants.filter((m) => {
      if (statusFilter !== 'All' && m.status !== statusFilter) return false;
      if (sourceFilter !== 'All' && (m.data_source || 'none') !== sourceFilter) return false;
      if (categoryFilter !== 'All' && m.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        (m.name || '').toLowerCase().includes(q) ||
        (m.id || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q)
      );
    });
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = key === 'completion' ? a.completion : (a[key] || '');
      const bv = key === 'completion' ? b.completion : (b[key] || '');
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [merchants, query, statusFilter, sourceFilter, categoryFilter, sort]);

  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir * -1 }
        : { key, dir: key === 'name' ? 1 : -1 },
    );

  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : '');

  const openDetail = async (merchant) => {
    setDetail(merchant);
    setDetailLoading(true);
    setDetailManifest(null);
    const result = await api.adminManifest(merchant.id);
    setDetailLoading(false);
    if (!result.error) setDetailManifest(result.manifest);
  };

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('All');
    setSourceFilter('All');
    setCategoryFilter('All');
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /* ------------------------- detail view ------------------------- */
  if (detail) {
    return (
      <div className="min-h-screen">
        <AppHeader
          context="Admin console"
          maxWidth={1360}
          right={
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-[13px] text-ink-muted hover:text-ink"
            >
              Exit
            </button>
          }
        />
        <main className="mx-auto max-w-[1360px] px-6 pb-16 pt-7">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="mb-4 inline-block text-[13px] text-ink-muted hover:text-ink"
          >
            ← All merchants
          </button>

          <div className="mb-4 rounded-card border border-line bg-canvas px-5 py-4.5">
            <div className="mb-3.5 flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-semibold tracking-tight">{detail.name}</h1>
              <span className="rounded-full border border-line bg-surface px-2.5 py-[3px]
                               font-mono text-xs">
                {detail.id}
              </span>
              <StatusPill status={detail.status} />
              <span className="flex-1" />
              <span className="ucxp-chip">Read-only · operator view</span>
            </div>
            <div
              className="grid gap-3.5"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
            >
              {[
                ['Email', detail.email || '—'],
                ['Category', detail.category || '—'],
                ['Data source', SOURCE_LABEL[detail.data_source] || '—'],
                ['Joined', formatDate(detail.created_at)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="mb-0.5 text-[11px] text-ink-muted">{label}</div>
                  <div className="text-[13px]">{value}</div>
                </div>
              ))}
              <div>
                <div className="mb-0.5 text-[11px] text-ink-muted">Completion</div>
                <CompletionBar pct={detail.completion} />
              </div>
            </div>
          </div>

          <ManifestPane
            manifest={detailManifest}
            status={detail.status === 'Active' ? 'active' : 'draft'}
            readOnly
            sticky={false}
            loading={detailLoading}
            maxHeight="560px"
          />
        </main>
      </div>
    );
  }

  /* ------------------------- list view ------------------------- */
  return (
    <div className="min-h-screen">
      <AppHeader
        context="Admin console"
        maxWidth={1360}
        right={
          <Link to="/" className="text-[13px] text-ink-muted no-underline hover:text-ink">
            Exit
          </Link>
        }
      />

      <main className="mx-auto max-w-[1360px] px-6 pb-16 pt-7">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Merchants</h1>
        <p className="mb-5 text-[13px] text-ink-muted">
          Every business onboarding or live on UCXP.
        </p>

        {error && (
          <div className="mb-5">
            <ErrorPanel onRetry={load}>{error}</ErrorPanel>
          </div>
        )}

        <div
          className="mb-5 grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
          data-testid="admin-stats"
        >
          {[
            ['Total merchants', stats.total],
            ['Active', stats.active],
            ['Drafts', stats.drafts],
            ['Shopify-connected', stats.shopify],
          ].map(([label, value]) => (
            <div key={label} className="rounded-card border border-line bg-canvas px-4 py-3.5">
              <div className="text-[22px] font-semibold tracking-tight">{value ?? 0}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{label}</div>
            </div>
          ))}
        </div>

        <div className="mb-3.5 flex flex-wrap items-start gap-4">
          <input
            className="ucxp-input w-[270px] max-w-full"
            data-testid="admin-search"
            placeholder="Search name, id, or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3.5 pt-0.5">
            {[
              ['Status', STATUS_FILTERS.map((s) => ({ label: s, value: s })), statusFilter, setStatusFilter],
              ['Source', SOURCE_FILTERS, sourceFilter, setSourceFilter],
              ['Category', categories.map((c) => ({ label: c, value: c })), categoryFilter, setCategoryFilter],
            ].map(([label, options, value, setter]) => (
              <div key={label} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-[11px] uppercase tracking-[0.05em] text-ink-faint">
                  {label}
                </span>
                {options.map((option) => (
                  <Chip
                    key={option.value}
                    selected={value === option.value}
                    onClick={() => setter(option.value)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-card border border-line bg-canvas">
          <div style={{ minWidth: 1020 }}>
            <div className="grid border-b border-line" style={{ gridTemplateColumns: GRID }}>
              {[
                ['business_id', null],
                ['Business', 'name'],
                ['Email', null],
                ['Category', null],
                ['Source', null],
                ['Completion', 'completion'],
                ['Status', null],
                ['Joined', 'created_at'],
              ].map(([label, key]) =>
                key ? (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleSort(key)}
                    className="px-3.5 py-2.5 text-left text-[10.5px] font-semibold uppercase
                               tracking-[0.05em] text-ink-muted hover:text-ink"
                  >
                    {label}
                    {arrow(key)}
                  </button>
                ) : (
                  <div
                    key={label}
                    className="px-3.5 py-2.5 text-[10.5px] font-semibold uppercase
                               tracking-[0.05em] text-ink-muted"
                  >
                    {label}
                  </div>
                ),
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-3 px-3.5 py-12 text-ink-muted">
                <Spinner /> Loading merchants…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-6 py-12 text-center" data-testid="admin-empty">
                <div className="mb-1 text-sm font-semibold">No merchants match</div>
                <div className="mb-3.5 text-[12.5px] text-ink-muted">
                  Try a different search, or clear the filters.
                </div>
                <button type="button" onClick={clearFilters} className="ucxp-btn-secondary ucxp-press">
                  Clear filters
                </button>
              </div>
            ) : (
              rows.map((merchant) => (
                <div
                  key={merchant.id}
                  role="button"
                  tabIndex={0}
                  data-testid={`admin-row-${merchant.id}`}
                  onClick={() => openDetail(merchant)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openDetail(merchant);
                  }}
                  className="grid cursor-pointer items-center border-b border-line-soft
                             transition-colors hover:bg-surface"
                  style={{ gridTemplateColumns: GRID }}
                >
                  <div className="truncate px-3.5 py-3 font-mono text-xs text-ink">{merchant.id}</div>
                  <div className="truncate px-3.5 py-3 text-[13px] font-medium">
                    {merchant.name || 'Untitled business'}
                  </div>
                  <div className="truncate px-3.5 py-3 text-[12.5px] text-ink-muted">
                    {merchant.email || '—'}
                  </div>
                  <div className="truncate px-3.5 py-3 text-[12.5px] text-ink-muted">
                    {merchant.category || '—'}
                  </div>
                  <div className="px-3.5 py-3 text-xs text-ink-muted">
                    {SOURCE_LABEL[merchant.data_source] ?? '—'}
                  </div>
                  <div className="px-3.5 py-3">
                    <CompletionBar pct={merchant.completion} />
                  </div>
                  <div className="px-3.5 py-3">
                    <StatusPill status={merchant.status} />
                  </div>
                  <div className="whitespace-nowrap px-3.5 py-3 text-xs text-ink-muted">
                    {formatDate(merchant.created_at)}
                  </div>
                </div>
              ))
            )}

            <div className="border-t border-line-soft px-3.5 py-2.5 text-xs text-ink-muted">
              {rows.length} {rows.length === 1 ? 'merchant' : 'merchants'} · click a row for the
              read-only manifest
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
