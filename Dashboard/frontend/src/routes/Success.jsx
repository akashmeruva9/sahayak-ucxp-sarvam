import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LANGUAGE_BY_CODE } from '../lib/contract';
import { api, copyText, downloadJson } from '../lib/api';
import { ErrorPanel, Spinner, useToast } from '../components/Primitives';

export default function Success() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [manifest, setManifest] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [manifestResult, businessResult] = await Promise.all([
        api.getManifest(businessId),
        api.getBusiness(businessId),
      ]);
      if (!alive) return;
      if (manifestResult.error || businessResult.error) {
        setError(manifestResult.error || businessResult.error);
        setLoading(false);
        return;
      }
      setManifest(manifestResult.manifest);
      setSummary(businessResult.summary);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [businessId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-ink-muted">
        <Spinner /> Publishing your manifest…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-10">
        <ErrorPanel>{error}</ErrorPanel>
        <Link to="/" className="ucxp-link mt-5 inline-block text-[13px]">
          ← Back to your businesses
        </Link>
      </div>
    );
  }

  const text = JSON.stringify(manifest, null, 2);
  const slug = manifest?.business_id || businessId;
  const manifestUrl = `https://api.ucxp.in/manifests/${slug}.json`;
  const embed = `<script async src="https://cdn.ucxp.in/badge.js" data-business="${slug}"></script>`;
  const version = manifest?.published?.version || 1;

  const languages = manifest?.languages || [];
  const badgeLangs = languages
    .slice(0, 3)
    .map((code) => LANGUAGE_BY_CODE[code.split('-')[0]]?.native)
    .filter(Boolean)
    .join(' ') || 'English';

  const activatedAt = manifest?.published?.at
    ? new Date(manifest.published.at).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '—';

  return (
    <div className="flex min-h-screen flex-col items-center px-6 pb-24 pt-14">
      <div
        className="ucxp-rise mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-ok-tint"
        data-testid="success-badge"
      >
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <path
            d="M7 15.5l5.5 5.5L23 10"
            stroke="#14A05A"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1 className="mb-1.5 text-center text-[26px] font-semibold tracking-tight">
        {manifest?.business || 'Your business'} is live on Sahayak
      </h1>
      <p className="mb-7 max-w-[520px] text-center text-sm leading-relaxed text-ink-muted">
        Any UCXP-compatible assistant can now support your customers — in their own language.
      </p>

      <div className="flex w-full max-w-[720px] flex-col gap-4">
        {/* summary */}
        <div
          className="grid gap-3.5 rounded-card border border-line bg-canvas px-5 py-4.5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
          data-testid="success-summary"
        >
          <div>
            <div className="mb-0.5 text-[11px] text-ink-muted">Business</div>
            <div className="text-[13.5px] font-semibold">{manifest?.business}</div>
          </div>
          <div>
            <div className="mb-0.5 text-[11px] text-ink-muted">business_id</div>
            <div className="font-mono text-[12.5px]">{slug}</div>
          </div>
          <div>
            <div className="mb-0.5 text-[11px] text-ink-muted">Status</div>
            <span className="ucxp-pill bg-ok-tint text-ok">Active</span>
          </div>
          <div>
            <div className="mb-0.5 text-[11px] text-ink-muted">Activated</div>
            <div className="text-[13.5px]">{activatedAt}</div>
          </div>
        </div>

        {/* integration package */}
        <div className="overflow-hidden rounded-card border border-line bg-canvas">
          <div className="flex items-center gap-2.5 border-b border-line-soft px-5 py-3.5">
            <h2 className="flex-1 text-sm font-semibold">Your integration package</h2>
            <span className="flex items-center gap-1.5 text-[11.5px] text-ok">
              <span className="h-[7px] w-[7px] rounded-full bg-ok" aria-hidden="true" />
              Published · v{version} · just now
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3.5 border-b border-line-soft px-5 py-4">
            <div className="min-w-[200px] flex-1">
              <div className="mb-0.5 font-mono text-[13px]">support.manifest.json</div>
              <div className="text-xs text-ink-muted">
                The complete support contract for your business.
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(text);
                toast(ok ? 'Copied to clipboard' : 'Could not copy — open the file instead');
              }}
              className="ucxp-btn-secondary ucxp-press px-3.5 py-1.5 text-[12.5px]"
            >
              Copy
            </button>
            <button
              type="button"
              data-testid="success-download"
              onClick={() => {
                downloadJson('support.manifest.json', text);
                toast('support.manifest.json downloaded');
              }}
              className="ucxp-btn-primary ucxp-press px-3.5 py-1.5 text-[12.5px]"
            >
              Download
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3.5 border-b border-line-soft px-5 py-4">
            <div className="min-w-[200px] flex-1">
              <div className="mb-0.5 break-all font-mono text-[12.5px]" data-testid="manifest-url">
                {manifestUrl}
              </div>
              <div className="text-xs text-ink-muted">
                Your support runtime reads this URL. Edits republish instantly.
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(manifestUrl);
                toast(ok ? 'Copied to clipboard' : 'Could not copy — select the URL manually');
              }}
              className="ucxp-btn-secondary ucxp-press px-3.5 py-1.5 text-[12.5px]"
            >
              Copy
            </button>
          </div>

          <div className="px-5 py-4">
            <div className="mb-2.5 flex flex-wrap items-center gap-3.5">
              <div className="min-w-[200px] flex-1">
                <div className="mb-0.5 text-[13px] font-medium">Verification badge</div>
                <div className="text-xs text-ink-muted">
                  Embed on your site so customers know support is guaranteed.
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyText(embed);
                  toast(ok ? 'Copied to clipboard' : 'Could not copy — select the snippet manually');
                }}
                className="ucxp-btn-secondary ucxp-press px-3.5 py-1.5 text-[12.5px]"
              >
                Copy embed code
              </button>
            </div>

            <div className="mb-2.5 inline-flex items-center gap-2 rounded-full border border-line
                            px-4 py-1.5">
              <span className="text-[13px] text-ok" aria-hidden="true">✓</span>
              <span className="text-[12.5px] font-medium">Supported by UCXP</span>
              <span className="ucxp-native text-[12.5px] leading-[1.9] text-ink-muted">· {badgeLangs}</span>
            </div>

            <pre
              className="ucxp-pane-scroll overflow-x-auto whitespace-nowrap rounded-input
                         bg-pane-bg px-3.5 py-2.5 font-mono text-[11.5px] text-pane-text"
            >
              {embed}
            </pre>
          </div>
        </div>

        {/* what happens next */}
        <div className="rounded-card border border-line bg-canvas px-5 py-4.5">
          <h2 className="mb-3 text-sm font-semibold">What happens next</h2>
          <div className="flex flex-col gap-2.5">
            {[
              ['✓', 'ok', 'Manifest published to your hosted URL', false],
              ['✓', 'ok', 'Credentials vaulted — never exposed in exports', false],
              ['○', 'faint', 'Runtime begins answering customers in your languages', true],
              ['○', 'faint', 'Edit any section anytime — changes republish automatically', true],
            ].map(([glyph, tone, label, muted]) => (
              <div key={label} className="flex items-baseline gap-2.5">
                <span
                  className={`w-4 flex-none text-center text-[13px] ${
                    tone === 'ok' ? 'text-ok' : 'text-ink-faint'
                  }`}
                  aria-hidden="true"
                >
                  {glyph}
                </span>
                <span className={`text-[13px] ${muted ? 'text-ink-muted' : ''}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap justify-center gap-2.5">
          <button
            type="button"
            data-testid="view-dashboard"
            onClick={() => navigate(`/business/${businessId}/dashboard`)}
            className="ucxp-btn-secondary ucxp-press px-4.5 py-2.5 text-sm"
          >
            View my dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="ucxp-btn-primary ucxp-press px-4.5 py-2.5 text-sm"
          >
            Back to my businesses
          </button>
        </div>
      </div>
    </div>
  );
}
