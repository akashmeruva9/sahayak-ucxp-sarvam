import "../global.css";

import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useColorScheme } from "nativewind";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAuthStore } from "@/store/useAuthStore";
import { authConfigured } from "@/lib/supabase";
import { SignInScreen } from "@/screens/SignInScreen";

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** Keeps NativeWind's color scheme in sync with the user's saved preference. */
function ThemeSync() {
  const { setColorScheme } = useColorScheme();
  const theme = useSettingsStore((s) => s.theme);
  useEffect(() => {
    setColorScheme(theme);
  }, [theme, setColorScheme]);
  return null;
}

export default function RootLayout() {
  // Read the saved backend URL before anything can issue a request. A shipped
  // build compiles in a placeholder, so this is what makes it reach a real
  // backend without a rebuild.
  useEffect(() => {
    void useSettingsStore.getState().hydrateApi();
    // Restore any stored Supabase session before the first request, so a
    // signed-in customer's turns are attributed to them from turn one.
    void useAuthStore.getState().hydrate();
  }, []);

  // `error` matters: if a font asset fails to load, `loaded` never flips true.
  // Ignoring it (the old bug) left the app pinned on the native splash forever.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Hard safety net: never let font loading gate the app for more than a moment.
  // Worst case we render with the system font — a demo that opens beats perfect
  // typography that never appears.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    // Short gate: fonts normally resolve well under this. If they lag, we render
    // anyway (system font) and Inter swaps in when `fontsLoaded` flips.
    const t = setTimeout(() => setTimedOut(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const fontsReady = fontsLoaded || !!fontError || timedOut;

  // Sign-in is compulsory, so nothing renders until the stored session has
  // been read. Deciding before `authReady` would flash the sign-in screen at
  // an already-signed-in customer on every cold start.
  const authReady = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);

  // A build without Supabase config cannot sign anyone in; gating it would
  // brick the app entirely, so the gate only applies when auth is available.
  const mustSignIn = authConfigured && !user;

  const ready = fontsReady && (authReady || !authConfigured);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeSync />
          {mustSignIn ? (
            <SignInScreen />
          ) : (
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "transparent" },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="sign-in" options={{ presentation: "modal", headerShown: false }} />
            <Stack.Screen name="index" options={{ animation: "fade" }} />
            <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
            <Stack.Screen
              name="conversation/[id]"
              options={{ animation: "slide_from_bottom" }}
            />
          </Stack>
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
