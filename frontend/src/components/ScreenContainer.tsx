import { View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useThemeColors } from "@/hooks/useThemeColors";

interface ScreenContainerProps {
  children: React.ReactNode;
  /** Which safe-area edges to inset. Defaults to top only (tabs handle bottom). */
  edges?: Edge[];
  className?: string;
}

/**
 * Widest the content column is allowed to get.
 *
 * The app is phone-first, so without a cap every screen stretches edge to edge
 * on a desktop browser — inputs a metre wide, a chat bubble spanning the whole
 * monitor. Below this width the cap does nothing, so phones are unaffected.
 */
const MAX_CONTENT_WIDTH = 640;

/** App-wide screen shell: themed background, safe area, correct status bar. */
export function ScreenContainer({
  children,
  edges = ["top"],
  className,
}: ScreenContainerProps) {
  const { isDark } = useThemeColors();
  return (
    <View className="flex-1 bg-canvas dark:bg-canvas-dark">
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView edges={edges} className={`flex-1 ${className ?? ""}`}>
        <View
          className="flex-1 w-full self-center"
          style={{ maxWidth: MAX_CONTENT_WIDTH }}
        >
          {children}
        </View>
      </SafeAreaView>
    </View>
  );
}
