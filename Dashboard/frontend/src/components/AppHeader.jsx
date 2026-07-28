import { Link } from 'react-router-dom';
import Logo from './Logo';

/** Shared header for Home and Admin. */
export default function AppHeader({ context, right, maxWidth = 1280 }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-canvas">
      <div
        className="mx-auto flex h-[58px] items-center gap-3.5 px-6"
        data-testid="header-bar"
        style={{ maxWidth }}
      >
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <Logo className="h-7 w-7" />
          <span className="flex items-baseline gap-1.5">
            <span className="text-[15px] font-semibold tracking-tight text-ink">Sahayak</span>
            {/* The name in its own script. The Noto families are already loaded
                for the language picker, so this costs nothing to render. */}
            <span
              className="hidden font-indic text-[12px] leading-none text-ink-faint sm:inline"
              aria-hidden="true"
            >
              सहायक
            </span>
          </span>
        </Link>
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
