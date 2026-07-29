import { useEffect, useState } from 'react';
import Logo from '../components/Logo';
import { ErrorPanel } from '../components/Primitives';
import { startGoogleSignIn } from '../state/useAuth';

/** Google's mark, inline. The CSP on a hosted deployment blocks a remote image,
 *  and a button that says "Sign in with Google" beside a broken icon looks
 *  exactly like the phishing page a merchant should be wary of. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C3 17.1 2.1 20.4 2.1 24s.9 6.9 2.4 9.9l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
    </svg>
  );
}

export default function Login() {
  const [error, setError] = useState('');

  // The OAuth callback redirects here with ?auth_error=… when something went
  // wrong, because a human is looking at that redirect, not a fetch handler.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get('auth_error');
    if (!message) return;
    setError(message);
    // Drop it from the URL so a refresh doesn't resurrect a stale failure.
    params.delete('auth_error');
    const query = params.toString();
    window.history.replaceState(
      {}, '', window.location.pathname + (query ? `?${query}` : ''));
  }, []);

  return (
    // The page is tinted one step so the card can be the canvas colour and read
    // as raised. Everywhere else in the product the card is white on a white
    // page and only its border separates it, which works inside a populated
    // layout -- but this screen is one small panel in an otherwise empty
    // viewport, and a hairline alone leaves it looking dropped there.
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-10">
      <div className="w-full max-w-[400px]" data-testid="login-screen">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="flex items-baseline gap-1.5">
            <span className="text-[17px] font-semibold tracking-tight text-ink">Sahayak</span>
            <span
              className="font-indic text-[13px] leading-none text-ink-faint"
              aria-hidden="true"
            >
              सहायक
            </span>
          </span>
        </div>

        <div className="ucxp-rise ucxp-card p-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Sign in to continue
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
            Your businesses, their connected stores and their published manifests are
            tied to your Google account.
          </p>

          {error && (
            <div className="mt-5">
              <ErrorPanel>{error}</ErrorPanel>
            </div>
          )}

          <button
            type="button"
            onClick={() => startGoogleSignIn('/')}
            data-testid="google-signin"
            className="ucxp-btn ucxp-press mt-6 w-full justify-center gap-2.5 border
                       border-line bg-canvas text-ink hover:bg-surface"
          >
            <GoogleMark />
            Sign in with Google
          </button>

          <p className="mt-6 border-t border-line-soft pt-4 text-[12px] leading-relaxed
                        text-ink-faint">
            We only ever read your name, email address and profile picture. Sahayak
            never sees your Google password.
          </p>
        </div>
      </div>
    </main>
  );
}
