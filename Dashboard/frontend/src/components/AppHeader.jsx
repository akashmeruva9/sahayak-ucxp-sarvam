import { Link } from 'react-router-dom';

/** Shared header for Home and Admin. The tagline is the product's identity line. */
export default function AppHeader({ context, right, maxWidth = 1280 }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas">
      <div
        className="mx-auto flex h-[58px] items-center gap-3.5 px-6"
        data-testid="header-bar"
        style={{ maxWidth }}
      >
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-input bg-ink text-sm
                       font-semibold text-white"
            aria-hidden="true"
          >
            U
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">UCXP</span>
        </Link>
        <span className="hidden text-xs text-ink-faint sm:inline" data-testid="tagline">
          AI for all from India
        </span>
        {context && (
          <span className="ucxp-pill bg-surface text-ink-muted">{context}</span>
        )}
        <span className="flex-1" />
        {right ?? (
          <Link
            to="/admin"
            className="text-[13px] text-ink-muted no-underline hover:text-ink"
            data-testid="admin-link"
          >
            Admin console
          </Link>
        )}
      </div>
    </header>
  );
}
