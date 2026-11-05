import { Platform } from "react-native";
import { create } from "zustand";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, googleProvider, authConfigured } from "@/lib/firebase";
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
  /** Google via GCP Identity Platform / Firebase. **Web only**. */
  signInWithGoogle: () => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

/** GCP / Firebase messages mapped to customer-friendly copy. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes("invalid-credential") ||
    m.includes("wrong-password") ||
    m.includes("user-not-found") ||
    m.includes("invalid login")
  ) {
    return "That email and password don't match.";
  }
  if (m.includes("email-already-in-use") || m.includes("already registered")) {
    return "That email already has an account — try signing in.";
  }
  if (m.includes("weak-password") || m.includes("password")) {
    return "Passwords need to be at least 6 characters.";
  }
  if (m.includes("invalid-email") || m.includes("email")) {
    return "That doesn't look like a valid email address.";
  }
  if (m.includes("network") || m.includes("fetch")) {
    return "Couldn't reach the server. Check your connection.";
  }
  return message;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,
  busy: false,
  error: null,

  clearError: () => set({ error: null }),

  hydrate: async () => {
    if (!authConfigured || !auth) {
      set({ ready: true });
      return;
    }

    try {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, 3000);

        onAuthStateChanged(auth, async (fbUser) => {
          if (fbUser) {
            try {
              const token = await fbUser.getIdToken();
              setAuthToken(token);
              set({
                user: { id: fbUser.uid, email: fbUser.email ?? "" },
              });
            } catch {
              setAuthToken(null);
              set({ user: null });
            }
          } else {
            setAuthToken(null);
            set({ user: null });
          }

          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve();
          }
        });
      });
    } catch (err) {
      if (__DEV__) console.warn(`[auth] session restore failed: ${String(err)}`);
      setAuthToken(null);
      set({ user: null });
    } finally {
      set({ ready: true });
    }
  },

  signIn: async (email, password) => {
    if (!auth) return false;
    set({ busy: true, error: null });
    try {
      const res = await signInWithEmailAndPassword(auth, email.trim(), password);
      const token = await res.user.getIdToken();
      setAuthToken(token);
      set({
        busy: false,
        user: { id: res.user.uid, email: res.user.email ?? "" },
      });
      return true;
    } catch (err: any) {
      set({ busy: false, error: friendly(err?.message ?? String(err)) });
      return false;
    }
  },

  signUp: async (email, password) => {
    if (!auth) return false;
    set({ busy: true, error: null });
    try {
      const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const token = await res.user.getIdToken();
      setAuthToken(token);
      set({
        busy: false,
        user: { id: res.user.uid, email: res.user.email ?? "" },
      });
      return true;
    } catch (err: any) {
      set({ busy: false, error: friendly(err?.message ?? String(err)) });
      return false;
    }
  },

  signInWithGoogle: async () => {
    if (Platform.OS !== "web") {
      set({ error: "Google sign-in is available on the web." });
      return false;
    }
    if (!auth) {
      set({ error: "Sign-in isn't configured in this build." });
      return false;
    }

    set({ busy: true, error: null });
    try {
      const res = await signInWithPopup(auth, googleProvider);
      const token = await res.user.getIdToken();
      setAuthToken(token);
      set({
        busy: false,
        user: { id: res.user.uid, email: res.user.email ?? "" },
      });
      return true;
    } catch (err: any) {
      if (err?.code === "auth/popup-closed-by-user") {
        set({ busy: false });
        return false;
      }
      set({ busy: false, error: friendly(err?.message ?? String(err)) });
      return false;
    }
  },

  signOut: async () => {
    if (auth) {
      try {
        await fbSignOut(auth);
      } catch {}
    }
    setAuthToken(null);
    set({ user: null, error: null });
  },
}));
