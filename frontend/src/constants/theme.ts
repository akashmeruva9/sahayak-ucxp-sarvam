import type { Language } from "@/types";

/**
 * JS-side color tokens. NativeWind handles most styling via `dark:` classes,
 * but icons, gradients and Reanimated interpolations need raw values — this is
 * the single source of truth for those, mirroring tailwind.config.js.
 */
export const palette = {
  accent: "#EA580C", // saffron (solid, for icons/text)
  accentSoft: "#F97316",
  accentDark: "#C2410C",

  light: {
    canvas: "#FAF6EF",
    surface: "#F2EBDF",
    elevated: "#FFFCF7",
    hairline: "#E8E0D2",
    text: "#1A1712",
    textSoft: "#4A423A",
    textMuted: "#857B6D",
    textFaint: "#B3A897",
    tabInactive: "#B3A897",
  },
  dark: {
    canvas: "#12100C",
    surface: "#1A1712",
    elevated: "#221D17",
    hairline: "#332C22",
    text: "#F7F2EA",
    textSoft: "#D9D0C3",
    textMuted: "#A99E8D",
    textFaint: "#6F6553",
    tabInactive: "#6F6553",
  },
} as const;

/**
 * Sarvam's signature blue→orange spectrum. Used for hero fills (mic, logo,
 * primary button, send) rendered with react-native-svg via <BrandGradient />.
 */
export const GRADIENT = {
  from: "#2F5DFF", // blue
  mid: "#B24BC4", // violet handoff
  to: "#FF6A2C", // orange
} as const;

export type ColorScheme = "light" | "dark";

export function colorsFor(scheme: ColorScheme) {
  return scheme === "dark" ? palette.dark : palette.light;
}

export const RADIUS = 16;

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "ta", label: "Tamil", native: "தமிழ்" },
  { code: "te", label: "Telugu", native: "తెలుగు" },
  { code: "bn", label: "Bengali", native: "বাংলা" },
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "kn", label: "Kannada", native: "ಕನ್ನಡ" },
];
