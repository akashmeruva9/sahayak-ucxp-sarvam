import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LANGUAGE_BY_CODE } from '../lib/contract';
import { api } from '../lib/api';
import {
  CompletionRing, ErrorPanel, Modal, Spinner, StatusPill, useToast,
} from '../components/Primitives';
import AppHeader from '../components/AppHeader';

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export default function Home() {
  const navigate = useNavigate();
  const toast = useToast();
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await api.listBusinesses();
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setError('');
    setBusinesses(result.businesses || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const onboard = async () => {
    setCreating(true);
    const result = await api.createBusiness('');
    setCreating(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    navigate(`/business/${result.business.id}`);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    const result = await api.deleteBusiness(pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    toast('Draft deleted');
    load();
  };

  return (
    <div className="min-h-screen">
      <AppHeader />

      <main className="mx-auto max-w-[1280px] px-6 pb-16 pt-8">
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <h1 className="mb-1 text-[22px] font-semibold tracking-tight">Your businesses</h1>
            <p className="text-[13.5px] text-ink-muted">
              Each business publishes one support manifest that AI assistants read.
            </p>
          </div>
          <button
            type="button"
            data-testid="onboard-business"
            onClick={onboard}
            disabled={creating}
            className="ucxp-btn-primary ucxp-press"
          >
            {creating && <Spinner light />}
            + Onboard a business
          </button>
        </div>

        {error && (
          <div className="mb-5">
            <ErrorPanel onRetry={load}>{error}</ErrorPanel>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-3 py-16 text-ink-muted">
            <Spinner /> Loading your businesses…
          </div>
        ) : businesses.length === 0 ? (
          <div
            className="flex flex-col items-center rounded-card border border-line bg-canvas
                       px-6 py-16 text-center"
            data-testid="home-empty"
          >
            <div className="mb-6 flex w-[220px] flex-col gap-2" aria-hidden="true">
              <div className="flex h-11 items-center gap-2 rounded-input border border-line
                              bg-surface px-3">
                <span className="h-[18px] w-[18px] rounded bg-surface-deep" />
                <span className="h-[7px] w-[90px] rounded bg-surface-deep" />
              </div>
              <div className="flex h-11 items-center justify-center rounded-input border
                              border-dashed border-line-dashed text-lg text-ink-faint">
                +
              </div>
            </div>
            <h2 className="mb-1.5 text-base font-semibold">No businesses yet</h2>
            <p className="mb-5 max-w-[400px] text-[13.5px] leading-relaxed text-ink-muted">
              Onboard your first business to publish a support manifest — a single file that tells
              any AI assistant how to help your customers, in their language.
            </p>
            <button
              type="button"
              data-testid="onboard-first"
              onClick={onboard}
              disabled={creating}
              className="ucxp-btn-primary ucxp-press"
            >
              {creating && <Spinner light />}
              Onboard your first business
            </button>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}
            data-testid="business-grid"
          >
            {businesses.map((biz) => (
              <div
                key={biz.id}
                className="ucxp-rise flex flex-col gap-3.5 rounded-card border border-line
                           bg-canvas p-5"
                data-testid={`business-card-${biz.id}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-card
                               bg-surface text-sm font-semibold"
                    aria-hidden="true"
                  >
                    {initials(biz.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold tracking-tight">
                      {biz.name || 'Untitled business'}
                    </div>
                    <div className="truncate text-[12.5px] text-ink-muted">
                      {biz.tagline || 'Add a tagline in Business profile'}
                    </div>
                  </div>
                  <StatusPill status={biz.status} />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="ucxp-chip">{biz.category || 'No category yet'}</span>
                  {(biz.languages || []).slice(0, 4).map((code) => (
                    <span
                      key={code}
                      className="ucxp-native inline-flex items-center rounded-full bg-surface
                                 px-2.5 py-[3px] text-[11.5px] leading-[1.9] text-ink"
                    >
                      {LANGUAGE_BY_CODE[code]?.native || code}
                    </span>
                  ))}
                </div>

                {(biz.capabilities || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {biz.capabilities.slice(0, 4).map((key) => (
                      <span
                        key={key}
                        className="rounded-btn border border-line px-2 py-[3px] font-mono
                                   text-[11px] text-ink-muted"
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2.5 border-t border-line-soft pt-3.5">
                  <CompletionRing pct={biz.completion} size={26} radius={14} stroke={4} />
                  <span className="text-[12.5px] text-ink-muted">
                    <span className="font-semibold text-ink">{biz.completion}%</span> complete
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => navigate(`/business/${biz.id}`)}
                    className="ucxp-btn-primary ucxp-press px-3.5 py-1.5 text-[13px]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(
                        biz.status === 'Active'
                          ? `/business/${biz.id}/dashboard`
                          : `/business/${biz.id}`,
                      )
                    }
                    className="ucxp-btn-secondary ucxp-press px-3 py-1.5 text-[13px]"
                  >
                    {biz.status === 'Active' ? 'View' : 'Export'}
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    data-testid={`delete-${biz.id}`}
                    onClick={() => setPendingDelete(biz)}
                    className="ucxp-press rounded-btn border border-line px-2.5 py-1.5 text-[13px]
                               text-ink-faint hover:border-err-line hover:text-err"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={onboard}
              className="flex min-h-[180px] flex-col items-center justify-center gap-1.5
                         rounded-card border border-dashed border-line-dashed text-ink-muted
                         transition-colors hover:border-ink hover:text-ink"
            >
              <span className="text-[22px] leading-none" aria-hidden="true">+</span>
              <span className="text-[13.5px] font-medium">Onboard a business</span>
            </button>
          </div>
        )}
      </main>

      {/* delete-draft modal */}
      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(null)}
        maxWidth={380}
        labelledBy="delete-title"
      >
        <div className="p-6">
          <h3 id="delete-title" className="mb-1.5 text-base font-semibold">
            Delete this draft?
          </h3>
          <p className="mb-5 text-[13px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">
              {pendingDelete?.name || 'Untitled business'}
            </span>{' '}
            and its manifest draft will be removed. This can’t be undone.
          </p>
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
              className="ucxp-btn-secondary ucxp-press"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-delete"
              onClick={confirmDelete}
              disabled={deleting}
              className="ucxp-btn-danger ucxp-press"
            >
              {deleting && <Spinner light />}
              Delete draft
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
