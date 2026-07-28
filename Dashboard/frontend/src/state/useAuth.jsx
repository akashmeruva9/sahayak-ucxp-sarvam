import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Who is signed in, resolved once at startup from GET /api/auth/me.
 *
 * `enabled` is false on a server with no Google credentials configured -- local
 * development and the Playwright suite both run that way, and in that state the
 * app behaves exactly as it did before sign-in existed. Everything downstream
 * therefore reads `enabled` before it reads `user`.
 */
const AuthContext = createContext({
  ready: false, enabled: false, user: null, isAdmin: false, signOut: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ready: false, enabled: false, user: null });

  const refresh = useCallback(async () => {
    const result = await api.me();
    if (result.error) {
      // The server is unreachable. Treat that as "sign-in unknown" rather than
      // as "signed out" -- showing a login screen for what is really a dead
      // backend sends you looking for the wrong problem.
      setState({ ready: true, enabled: false, user: null, offline: true });
      return;
    }
    setState({
      ready: true,
      enabled: Boolean(result.auth_enabled),
      user: result.user || null,
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A cookie can lapse mid-session; api.js announces the first 401 that proves it.
  useEffect(() => {
    const onSignedOut = () => setState((s) => (s.user ? { ...s, user: null } : s));
    window.addEventListener('ucxp:signed-out', onSignedOut);
    return () => window.removeEventListener('ucxp:signed-out', onSignedOut);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setState((s) => ({ ...s, user: null }));
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, isAdmin: Boolean(state.user?.is_admin), refresh, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Send the browser to Google. A full navigation, not fetch -- OAuth is a
 *  redirect dance and the callback has to set a cookie on this origin. */
export function startGoogleSignIn(nextPath) {
  const next = nextPath || window.location.pathname + window.location.search;
  window.location.assign(`/api/auth/login?next=${encodeURIComponent(next)}`);
}
