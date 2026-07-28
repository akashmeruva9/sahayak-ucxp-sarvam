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

  signOut: async () => {
    if (supabase) await supabase.auth.signOut();
    setAuthToken(null);
    set({ user: null, error: null });
  },
}));
