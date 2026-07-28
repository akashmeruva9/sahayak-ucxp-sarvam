import { router } from "expo-router";
import { SignInScreen } from "@/screens/SignInScreen";

/**
 * Presented as a modal from Settings → Account. Not a gate: the app is usable
 * signed-out, and signing in only adds durable history.
 */
export default function SignInRoute() {
  return <SignInScreen onSkip={() => router.back()} />;
}
