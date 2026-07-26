import { useColorScheme } from "nativewind";
import { colorsFor, palette, type ColorScheme } from "@/constants/theme";

/**
 * Bridges NativeWind's active color scheme to raw color tokens for use in
 * places that can't take a className: icon `color`, gradients, Reanimated.
 */
export function useThemeColors() {
  const { colorScheme } = useColorScheme();
  const scheme: ColorScheme = colorScheme === "dark" ? "dark" : "light";
  return {
    scheme,
    isDark: scheme === "dark",
    colors: colorsFor(scheme),
    accent: palette.accent,
  };
}
