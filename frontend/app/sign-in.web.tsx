import { useEffect } from "react";
import { router } from "expo-router";
import { SignInScreen } from "@/screens/SignInScreen";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Sign-in as a real page on the web, reached from the landing page.
 *
 * On native this route is a modal opened from Settings and the app itself is
 * gated by `_layout`, so signing in just dissolves the gate. On the web the
 * customer is standing on a URL, and nothing moves them off it — hence the
 * explicit hand-off to the app once a session exists.
 */
export default function SignInRoute() {
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (user) router.replace("/home");
  }, [user]);

  // "Continue without an account" returns to the landing page rather than
  // going back: the app is not usable signed-out on the web, so `back()` could
  // bounce the customer straight into a route the gate immediately rejects.
  return <SignInScreen onSkip={() => router.replace("/")} />;
}
