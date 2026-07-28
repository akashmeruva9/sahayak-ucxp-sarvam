import { View } from "react-native";
import { Slot } from "expo-router";
import { WebSidebar } from "@/components";

/**
 * Desktop shell — web only. Metro resolves this instead of _layout.tsx on web,
 * so the native app keeps its bottom tab bar untouched.
 *
 * `Slot` rather than `Tabs`: React Navigation's bottom tabs can't be moved to
 * the side, and a floating pill nav in the middle of a wide window is what made
 * the web build look like a stretched phone.
 */
export default function WebTabsLayout() {
  return (
    <View className="flex-1 flex-row bg-canvas dark:bg-canvas-dark">
      <WebSidebar />
      <View className="flex-1">
        <Slot />
      </View>
    </View>
  );
}
