import { Platform } from "react-native";
import { create } from "zustand";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { authConfigured, supabase } from "@/lib/supabase";
import { setAuthToken } from "@/api/client";

// Lets the in-app browser hand control straight back after the redirect,
// instead of leaving the user staring at a stranded browser tab.
WebBrowser.maybeCompleteAuthSession();

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
  /** Google via Supabase OAuth — browser redirect, no native module. */
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
   * Google sign-in through Supabase OAuth.
   *
   * Deliberately the redirect flow rather than `@react-native-google-signin`:
   * that package needs a native module and an `expo prebuild`, which would
   * regenerate `android/` and wipe the hand-patched Gradle files the build
   * depends on (PLAN.md §7 #14). This is a browser hop, so the same code path
   * serves Android and web.
   */
  signInWithGoogle: async () => {
    if (!supabase) {
      set({ error: "Sign-in isn't configured in this build." });
      return false;
    }
    set({ busy: true, error: null });

    try {
      // Native returns to the app's scheme (onesupport://); web comes back to
      // the page it left, where detectSessionInUrl picks the tokens up.
      const redirectTo =
        Platform.OS === "web" ? window.location.origin : Linking.createURL("/");

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          // Native must not auto-open: we need the URL to hand to the in-app
          // browser so the result comes back to us.
          skipBrowserRedirect: Platform.OS !== "web",
        },
      });
      if (error) {
        set({ busy: false, error: friendly(error.message) });
        return false;
      }

      // Web: the browser is already navigating to Google.
      if (Platform.OS === "web") return true;

      if (!data?.url) {
        set({ busy: false, error: "Couldn't start Google sign-in. Try again." });
        return false;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success" || !result.url) {
        // Dismissed or cancelled — not an error worth alarming anyone about.
        set({ busy: false });
        return false;
      }

      // Supabase returns the tokens in the fragment; exchange them for a session.
      const parsed = Linking.parse(result.url);
      const fragment = result.url.split("#")[1] ?? "";
      const params = new URLSearchParams(fragment);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (!access_token || !refresh_token) {
        const denied = params.get("error_description") ?? (parsed.queryParams?.error as string | undefined);
        set({ busy: false, error: denied ? friendly(denied) : "Google didn't return a session. Try again." });
        return false;
      }

      const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
      if (sessionError) {
        set({ busy: false, error: friendly(sessionError.message) });
        return false;
      }
      // onAuthStateChange (wired in hydrate) sets user + the API token.
      set({ busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: friendly(err instanceof Error ? err.message : String(err)) });
      return false;
    }
  },

  signOut: async () => {
    if (supabase) await supabase.auth.signOut();
    setAuthToken(null);
    set({ user: null, error: null });
  },
}));
