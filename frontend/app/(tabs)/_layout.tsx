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
      {/* A conversation lives inside the shell so the web build keeps its
          sidebar. `href: null` keeps it out of Expo Router's own bar — but a
          custom tabBar still receives the route, so Navbar filters it out and
          hides itself here, giving the chat its full height on a phone. */}
      <Tabs.Screen name="conversation/[id]" options={{ href: null }} />
    </Tabs>
  );
}
