import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BrandGradient, ScreenContainer } from "@/components";

/**
 * The entrance, on the phone only.
 *
 * Reanimated `entering` stalls on web — the form holds its initial opacity
 * until something forces a repaint, so the first screen of the app renders
 * almost invisible and there is nothing to scroll to fix it.
 */
const WEB = Platform.OS === "web";
const Card = (WEB ? View : Animated.View) as typeof Animated.View;
const ENTER = WEB ? undefined : FadeInDown.duration(360);

/**
 * On a phone the form is the screen, so it fills it. In a desktop browser that
 * same layout stretches a password field across 900px and reads as an unstyled
 * page — especially arriving from the landing page. On web the form becomes a
 * bounded, branded card on the canvas instead.
 */
const WEB_CARD = WEB
  ? ({ width: "100%", maxWidth: 430, alignSelf: "center" } as const)
  : undefined;

/**
 * Sign in / create account.
 *
 * Email + password rather than a magic link: Supabase's built-in SMTP is rate
 * limited to a handful of messages an hour, which is fine in development and
 * fails in front of an audience.
 */
export function SignInScreen({ onSkip }: { onSkip?: () => void }) {
  const { colors } = useThemeColors();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    Haptics.selectionAsync().catch(() => {});
    await (mode === "in" ? signIn(email, password) : signUp(email, password));
  };

  const swap = () => {
    clearError();
    setMode((m) => (m === "in" ? "up" : "in"));
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 pb-16"
          keyboardShouldPersistTaps="handled"
        >
          <Card entering={ENTER} style={WEB_CARD}>
            {WEB ? (
              <View className="mb-8 items-center">
                <Pressable
                  onPress={() => router.replace("/")}
                  accessibilityRole="link"
                  accessibilityLabel="Back to the Sahayak home page"
                  className="flex-row items-center"
                >
                  <View className="h-11 w-11 items-center justify-center overflow-hidden rounded-2xl">
                    <BrandGradient />
                    <Text className="text-[22px]" style={{ lineHeight: 26, color: "#FFFFFF" }}>
                      ✦
                    </Text>
                  </View>
                  <Text className="ml-3 text-[22px] font-bold tracking-tight text-ink dark:text-white">
                    Sahayak
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <Text
              className="text-[34px] font-bold tracking-tight text-ink dark:text-white"
              style={WEB ? { textAlign: "center" } : undefined}
            >
              {mode === "in" ? "Welcome back" : "Create account"}
            </Text>
            <Text
              className="mt-2 text-[15px] leading-6 text-ink-muted dark:text-white/50"
              style={WEB ? { textAlign: "center" } : undefined}
            >
              {mode === "in"
                ? "Sign in to keep your conversations and receipts across devices."
                : "Your conversations and receipts are saved to your account."}
            </Text>

            <View className="mt-8 gap-3">
              <TextInput
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  clearError();
                }}
                placeholder="you@example.com"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                className="rounded-2xl border border-hairline/70 bg-elevated px-4 py-4 text-[16px] text-ink dark:border-hairline-dark/70 dark:bg-elevated-dark dark:text-white"
              />
              <TextInput
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  clearError();
                }}
                placeholder="Password (6+ characters)"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType={mode === "in" ? "password" : "newPassword"}
                onSubmitEditing={submit}
                className="rounded-2xl border border-hairline/70 bg-elevated px-4 py-4 text-[16px] text-ink dark:border-hairline-dark/70 dark:bg-elevated-dark dark:text-white"
              />
            </View>

            {error ? (
              <Text className="mt-3 text-[14px] leading-5 text-rose-500">{error}</Text>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              className={`mt-6 items-center rounded-2xl py-4 ${
                canSubmit ? "bg-accent" : "bg-accent/40"
              }`}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-[16px] font-semibold text-white">
                  {mode === "in" ? "Sign in" : "Create account"}
                </Text>
              )}
            </Pressable>

            <Pressable onPress={swap} className="mt-5 items-center py-2">
              <Text className="text-[14px] text-ink-muted dark:text-white/50">
                {mode === "in"
                  ? "No account yet? Create one"
                  : "Already have an account? Sign in"}
              </Text>
            </Pressable>

            {onSkip ? (
              <Pressable onPress={onSkip} className="mt-2 items-center py-2">
                <Text className="text-[14px] text-ink-faint dark:text-white/30">
                  Continue without an account
                </Text>
              </Pressable>
            ) : null}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
