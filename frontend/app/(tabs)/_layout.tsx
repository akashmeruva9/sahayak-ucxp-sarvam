import { Tabs } from "expo-router";
import { Navbar } from "@/components";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
      tabBar={(props) => <Navbar {...props} />}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="companies" options={{ title: "Companies" }} />
      <Tabs.Screen name="history" options={{ title: "History" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      {/* A conversation lives inside the shell rather than on top of it, so the
          tab bar stays put when you open one — the same reason the web build
          keeps its sidebar. `href: null` keeps it out of the bar itself. */}
      <Tabs.Screen name="conversation/[id]" options={{ href: null }} />
    </Tabs>
  );
}
