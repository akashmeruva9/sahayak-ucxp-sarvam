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
    </Tabs>
  );
}
