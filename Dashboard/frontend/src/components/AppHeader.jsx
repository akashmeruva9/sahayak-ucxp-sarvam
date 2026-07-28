import { Link } from 'react-router-dom';
import Logo from './Logo';
import { useAuth } from '../state/useAuth';

function initial(user) {
  const source = (user?.name || user?.email || '?').trim();
  return source ? source[0].toUpperCase() : '?';
}

/** The signed-in account, with the way back out.
 *
 * Renders nothing at all when sign-in is not configured, which keeps the header
 * byte-identical to the approved design on a server without it.
 */
function AccountChip() {
  const { enabled, user, isAdmin, signOut } = useAuth();
  if (!enabled || !user) return null;
  return (
    <span className="flex items-center gap-2.5" data-testid="account-chip">
      {user.picture ? (
        <img
          src={user.picture}
          alt=""
          referrerPolicy="no-referrer"
          className="h-6 w-6 rounded-full border border-line object-cover"
        />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full
                         border border-line bg-surface text-[11px] font-semibold text-ink-muted">
          {initial(user)}
        </span>
      )}
      <span className="hidden text-[13px] text-ink-muted sm:inline" title={user.email}>
        {user.email}
      </span>
      {isAdmin && <span className="ucxp-pill bg-surface text-ink-muted">Admin</span>}
      <button
        type="button"
        onClick={signOut}
        data-testid="sign-out"
        className="text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        Sign out
      </button>
    </span>
  );
}

/** Shared header for Home and Admin. */
export default function AppHeader({ context, right, maxWidth = 1280 }) {
  const { enabled, isAdmin } = useAuth();
  // Without sign-in there is no one to distinguish, so the link stays as the
  // design has it. With sign-in, a merchant would only get a 403 from it.
  const showAdminLink = !enabled || isAdmin;
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
        {right ?? (showAdminLink && (
          <Link
            to="/admin"
            className="text-[13px] text-ink-muted no-underline hover:text-ink"
            data-testid="admin-link"
          >
            Admin console
          </Link>
        ))}
        <AccountChip />
      </div>
    </header>
  );
}
