import { create } from "zustand";
import type { ThemePreference } from "@/types";

interface SettingsState {
  theme: ThemePreference;
  languageCode: string;
  setTheme: (theme: ThemePreference) => void;
  setLanguage: (code: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "system",
  languageCode: "en",
  setTheme: (theme) => set({ theme }),
  setLanguage: (languageCode) => set({ languageCode }),
}));
