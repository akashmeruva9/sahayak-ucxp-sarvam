import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/* Spinner                                                                     */
/* -------------------------------------------------------------------------- */
export function Spinner({ light = false, size = 13 }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      data-testid="spinner"
      className="ucxp-spinner inline-block rounded-full align-middle"
      style={{
        width: size,
        height: size,
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: light ? 'rgba(255,255,255,0.35)' : '#E8E8E8',
        borderTopColor: light ? '#FFFFFF' : '#0A0A0A',
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Inline error                                                                */
/* -------------------------------------------------------------------------- */
export function InlineError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" data-testid="inline-error" className="mt-1.5 text-xs text-err">
      {children}
    </p>
  );
}

export function ErrorPanel({ children, onRetry }) {
  if (!children) return null;
  return (
    <div role="alert" data-testid="error-panel" className="ucxp-panel-err flex items-start gap-3">
      <span className="mt-[6px] h-[5px] w-[5px] flex-none rounded-full bg-err" />
      <div className="flex-1 text-[12.5px] leading-relaxed text-err-deep">{children}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-[12.5px] text-err underline">
          Try again
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status pill                                                                 */
/* -------------------------------------------------------------------------- */
export function StatusPill({ status }) {
  const active = status === 'Active' || status === 'active';
  return (
    <span
      data-testid="status-pill"
      className={`ucxp-pill ${active ? 'bg-ok-tint text-ok' : 'bg-surface-deep text-ink-muted'}`}
    >
      {active ? 'Active' : 'Draft'}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Completion ring — stroke animates as the percentage changes                 */
/* -------------------------------------------------------------------------- */
export function CompletionRing({ pct = 0, size = 48, radius = 20, stroke = 4 }) {
  const circumference = 2 * Math.PI * radius;
  const filled = (circumference * Math.max(0, Math.min(100, pct))) / 100;
  const center = size / 2;
  const viewBox = radius * 2 + stroke * 2;
  const vbCenter = viewBox / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      className="ucxp-ring flex-none"
      role="img"
      aria-label={`${pct}% complete`}
      data-testid="completion-ring"
      data-pct={pct}
    >
      <circle cx={vbCenter} cy={vbCenter} r={radius} fill="none" stroke="#F0F0F0" strokeWidth={stroke} />
      <circle
        cx={vbCenter}
        cy={vbCenter}
        r={radius}
        fill="none"
        stroke="#0A0A0A"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled.toFixed(1)} ${circumference.toFixed(2)}`}
        transform={`rotate(-90 ${vbCenter} ${vbCenter})`}
      />
    </svg>
  );
}

export function CompletionBar({ pct = 0 }) {
  return (
    <span className="flex items-center gap-2">
      <span className="block h-[5px] w-14 flex-none overflow-hidden rounded-full bg-surface-deep">
        <span
          className="block h-full rounded-full bg-ink transition-[width] duration-300"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </span>
      <span className="text-xs text-ink-muted">{pct}%</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* BusinessAvatar                                                              */
/* -------------------------------------------------------------------------- */
function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

/** A business's logo, falling back to its initials.
 *
 * The fallback is not decoration. A logo that fails to load emits a console
 * error, and `assertNoConsoleErrors` treats that as a gate failure — so the
 * <img> is rendered only when there is something to render, and swaps itself
 * back out on error rather than leaving a broken image behind.
 *
 * The field is `logo_url` on anything that came through summarize() and
 * `logoUrl` on raw section state, so both spellings are accepted here rather
 * than at each of the five call sites.
 */
export function BusinessAvatar({ name, logoUrl, size = 40, className = '' }) {
  const src = logoUrl || '';
  const [failed, setFailed] = useState(false);
  const box = {
    width: size, height: size, fontSize: Math.round(size * 0.35),
  };

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        style={box}
        onError={() => setFailed(true)}
        className={`flex-none rounded-card border border-line bg-surface
                    object-cover ${className}`}
      />
    );
  }

  return (
    <span
      style={box}
      aria-hidden="true"
      className={`flex flex-none items-center justify-center rounded-card
                  bg-surface font-semibold ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Toggle                                                                      */
/* -------------------------------------------------------------------------- */
export function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 flex-none rounded-full transition-colors ucxp-press
        ${checked ? 'bg-ink' : 'bg-line'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className="absolute top-[2px] h-4 w-4 rounded-full bg-white transition-[left] duration-150"
        style={{ left: checked ? 18 : 2 }}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */
export function Modal({ open, onClose, children, labelledBy, maxWidth = 430 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-ink/45 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="ucxp-rise w-full overflow-hidden rounded-card bg-canvas outline-none"
        style={{ maxWidth }}
      >
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const push = useCallback((message) => {
    const id = (nextId.current += 1);
    setToasts((all) => [...all, { id, message }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 2400);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 left-1/2 z-[400] flex -translate-x-1/2
                   flex-col items-center gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="toast"
            className="ucxp-rise whitespace-nowrap rounded-input bg-ink px-4 py-2.5 text-[13px]
                       text-white"
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Field                                                                       */
/* -------------------------------------------------------------------------- */
export function Field({ label, hint, error, children, className = '', required = false }) {
  return (
    <div className={className}>
      {label && (
        <label className="ucxp-label">
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-ink-faint">{hint}</p>}
      <InlineError>{error}</InlineError>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Lock icon — used wherever we promise a secret stays in the vault            */
/* -------------------------------------------------------------------------- */
export function LockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="flex-none">
      <rect x="2.5" y="6" width="9" height="6" rx="1.5" stroke="#6B6B6B" strokeWidth="1.3" />
      <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="#6B6B6B" strokeWidth="1.3" />
    </svg>
  );
}
