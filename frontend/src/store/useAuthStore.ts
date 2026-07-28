import { Platform } from "react-native";
import { create } from "zustand";
import { authConfigured, supabase } from "@/lib/supabase";
import { setAuthToken } from "@/api/client";

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  /** False until the stored session has been read — gate rendering on this. */
  ready: boolean;
  busy: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  /** Google via Supabase OAuth. **Web only** — see the implementation. */
  signInWithGoogle: () => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

/** Supabase's messages are developer-facing; these are what a customer reads. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match.";
  if (m.includes("already registered")) return "That email already has an account — try signing in.";
  if (m.includes("password")) return "Passwords need to be at least 6 characters.";
  if (m.includes("email")) return "That doesn't look like a valid email address.";
  if (m.includes("network") || m.includes("fetch")) return "Couldn't reach the server. Check your connection.";
  return message;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,
  busy: false,
  error: null,

  clearError: () => set({ error: null }),

  /**
   * Read any stored session and keep the API layer's token in sync.
   *
   * The token is handed to `client.ts` rather than read from it, so the
   * transport never has to know Supabase exists.
   */
  hydrate: async () => {
    if (!authConfigured || !supabase) {
      set({ ready: true });
      return;
    }

    // `ready` gates the entire app now that sign-in is compulsory, so it must
    // be set on every path. If this threw, the app would sit on a blank screen
    // forever with no way back — worse than showing the sign-in form.
    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      setAuthToken(session?.access_token ?? null);
      set({
        user: session?.user ? { id: session.user.id, email: session.user.email ?? "" } : null,
      });
    } catch (err) {
      if (__DEV__) console.warn(`[auth] session restore failed: ${String(err)}`);
      setAuthToken(null);
      set({ user: null });
    } finally {
      set({ ready: true });
    }

    // Token refreshes and sign-outs both land here, so the header can never
    // go stale mid-session.
    supabase.auth.onAuthStateChange((_event, next) => {
      setAuthToken(next?.access_token ?? null);
      set({
        user: next?.user ? { id: next.user.id, email: next.user.email ?? "" } : null,
      });
    });
  },

  signIn: async (email, password) => {
    if (!supabase) return false;
    set({ busy: true, error: null });
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    set({ busy: false, error: error ? friendly(error.message) : null });
    return !error;
  },

  signUp: async (email, password) => {
    if (!supabase) return false;
    set({ busy: true, error: null });
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) {
      set({ busy: false, error: friendly(error.message) });
      return false;
    }
    // With email confirmation ON, Supabase returns a user but no session —
    // say so instead of appearing to hang on a screen that never advances.
    if (!data.session) {
      set({ busy: false, error: "Check your inbox to confirm the address, then sign in." });
      return false;
    }
    set({ busy: false });
    return true;
  },

  /**
   * Google sign-in through Supabase OAuth — **web only**.
   *
   * On the web this is a plain redirect: Supabase sends the browser to Google
   * and back to `redirectTo`, where `detectSessionInUrl` (see lib/supabase.ts)
   * picks the tokens out of the URL and `onAuthStateChange` does the rest.
   * Nothing to parse by hand, and no native module.
   *
   * It returns to the app route, not the origin. Signing in is the customer
   * saying "let me in", so landing them back on the marketing page to press a
   * second button is a dead end. `detectSessionInUrl` reads the tokens on
   * whatever route it lands on, so an app route works as the return target.
   *
   * The native flow was deliberately dropped: it needed `expo-web-browser` and
   * `expo-linking` to run an in-app browser session and hand-parse the returned
   * fragment, which is a lot of surface area for a button the installed app no
   * longer shows. Restoring it means restoring that code — see git history.
   *
   * **`redirectTo` must be allow-listed in Supabase** (Auth → URL
   * Configuration → Redirect URLs). Supabase silently falls back to the
   * project's Site URL when it is not, which looks like a working sign-in that
   * lands on the wrong host (PLAN.md §7 #47).
   */
  signInWithGoogle: async () => {
    if (Platform.OS !== "web") {
      set({ error: "Google sign-in is available on the web." });
      return false;
    }
    if (!supabase) {
      set({ error: "Sign-in isn't configured in this build." });
      return false;
    }

    set({ busy: true, error: null });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/home` },
    });
    if (error) {
      set({ busy: false, error: friendly(error.message) });
      return false;
    }
    // The browser is already navigating to Google; leave `busy` set so the
    // form stays disabled for the moment the page is still on screen.
    return true;
  },

  signOut: async () => {
    if (supabase) await supabase.auth.signOut();
    setAuthToken(null);
    set({ user: null, error: null });
  },
}));
