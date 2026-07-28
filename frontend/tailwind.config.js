// Shared tail for every font stack, so a missing webfont degrades to the
// platform UI face rather than Times New Roman.
const SYSTEM_SANS = [
  "system-ui",
  "-apple-system",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // UCXP brand — Sarvam-inspired: warm paper + blue→orange spectrum.
        // Solid `accent` is the saffron end of the gradient (for text/icons);
        // hero fills use the full gradient via <BrandGradient />.
        accent: {
          DEFAULT: "#EA580C", // deep saffron
          soft: "#F97316",
          muted: "#FCE7D6",
          dark: "#C2410C",
          blue: "#2F5DFF", // gradient start
        },
        ink: {
          DEFAULT: "#1A1712", // warm near-black
          soft: "#4A423A",
          muted: "#857B6D",
          faint: "#B3A897",
        },
        // Light surfaces (warm paper)
        canvas: "#FAF6EF",
        surface: "#F2EBDF",
        elevated: "#FFFCF7",
        hairline: "#E8E0D2",
        // Dark surfaces (warm charcoal)
        "canvas-dark": "#12100C",
        "surface-dark": "#1A1712",
        "elevated-dark": "#221D17",
        "hairline-dark": "#332C22",
      },
      // Each stack ends in a real system sans. The Inter_* names are the
      // families expo-font registers on native; on web they may not resolve,
      // and without a fallback the browser drops to its default *serif* — which
      // is why headings rendered serif while unstyled body text stayed sans.
      fontFamily: {
        sans: ["Inter_400Regular", "Inter", ...SYSTEM_SANS],
        medium: ["Inter_500Medium", "Inter", ...SYSTEM_SANS],
        semibold: ["Inter_600SemiBold", "Inter", ...SYSTEM_SANS],
        bold: ["Inter_700Bold", "Inter", ...SYSTEM_SANS],
      },
      borderRadius: {
        card: "16px",
        xl2: "20px",
        xl3: "28px",
      },
    },
  },
  plugins: [],
};
