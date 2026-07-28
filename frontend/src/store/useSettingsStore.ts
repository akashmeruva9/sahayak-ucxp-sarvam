import { create } from "zustand";
import type { ThemePreference } from "@/types";
import { getApiOverride, loadApiOverride, setApiOverride } from "@/api/client";

interface SettingsState {
  theme: ThemePreference;
  languageCode: string;
  /** Backend URL set from Settings; null ⇒ use whatever was compiled in. */
  apiOverride: string | null;
  /** True once the stored override has been read from disk. */
  apiReady: boolean;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (code: string) => void;
  hydrateApi: () => Promise<void>;
  saveApiOverride: (url: string | null) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "system",
  languageCode: "en",
  apiOverride: null,
  apiReady: false,
  setTheme: (theme) => set({ theme }),
  setLanguage: (languageCode) => set({ languageCode }),

  /**
   * Read the persisted backend URL. Runs before the first request, otherwise a
   * shipped build would use the compiled placeholder for a turn.
   */
  hydrateApi: async () => {
    await loadApiOverride();
    set({ apiOverride: getApiOverride(), apiReady: true });
  },

  saveApiOverride: async (url) => {
    const stored = await setApiOverride(url);
    set({ apiOverride: stored });
  },
}));
