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
      fontFamily: {
        sans: ["Inter_400Regular"],
        medium: ["Inter_500Medium"],
        semibold: ["Inter_600SemiBold"],
        bold: ["Inter_700Bold"],
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
