import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useColorScheme } from "nativewind";
import Constants from "expo-constants";
import {
  Moon,
  Server,
  Smartphone,
  Sun,
  User,
  type LucideIcon,
} from "lucide-react-native";
import type { ThemePreference } from "@/types";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAuthStore } from "@/store/useAuthStore";
import { COMPILED_BASE_URL, pingBackend } from "@/api/client";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * Reanimated `entering` animations stall on web: elements stay at their initial
 * opacity until something forces a repaint, so the page reads as half-loaded
 * until the user scrolls. The web screens therefore render statically — the
 * native screens keep their entrance animations.
 */

/**
 * Settings, desktop edition. Web only.
 *
 * The phone screen stacks full-width rows — correct on a small screen, wasteful
 * on a wide one. Here each concern is a card in a two-column grid.
 */
const MEASURE = 960;

const THEMES: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Smartphone },
];

function Card({
  icon: Icon,
  title,
  hint,
  children,
  delay = 0,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  const { colors } = useThemeColors();
  return (
    <View
      className="grow rounded-2xl border border-hairline/70 bg-elevated p-6 dark:border-hairline-dark/70 dark:bg-elevated-dark"
      style={{ minWidth: 320, maxWidth: 460 }}
    >
      <View className="flex-row items-center">
        <Icon size={17} color={colors.textMuted} />
        <Text className="ml-2.5 text-[15.5px] font-semibold text-ink dark:text-white">
          {title}
        </Text>
      </View>
      {hint ? (
        <Text className="mt-1.5 text-[13px] leading-5 text-ink-muted dark:text-white/45">
          {hint}
        </Text>
      ) : null}
      <View className="mt-4">{children}</View>
    </View>
  );
}

export function SettingsScreen() {
  const { colors } = useThemeColors();
  const { setColorScheme } = useColorScheme();

  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const apiOverride = useSettingsStore((s) => s.apiOverride);
  const apiReady = useSettingsStore((s) => s.apiReady);
  const saveApiOverride = useSettingsStore((s) => s.saveApiOverride);

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const [draftUrl, setDraftUrl] = useState(apiOverride ?? "");
  const [testing, setTesting] = useState(false);
  const [ping, setPing] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => {
    if (apiReady) setDraftUrl(apiOverride ?? "");
  }, [apiReady, apiOverride]);

  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <ScrollView className="flex-1" contentContainerClassName="items-center px-10 pb-20 pt-12">
      <View className="w-full" style={{ maxWidth: MEASURE }}>
        <Text className="text-[36px] font-bold tracking-tight text-ink dark:text-white">
          Settings
        </Text>
        <Text className="mt-2 text-[16px] text-ink-muted dark:text-white/50">
          Appearance, your account and the backend this client talks to.
        </Text>

        <View className="mt-9 flex-row flex-wrap gap-5">
          {/* Appearance */}
          <Card icon={Moon} title="Appearance" hint="Dark by default." delay={0}>
            <View className="flex-row gap-2">
              {THEMES.map((opt) => {
                const active = theme === opt.value;
                const Icon = opt.icon;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      setTheme(opt.value);
                      setColorScheme(opt.value);
                    }}
                    className={`flex-1 flex-row items-center justify-center rounded-xl py-3 ${
                      active
                        ? "bg-accent"
                        : "border border-hairline/70 dark:border-hairline-dark/70"
                    }`}
                  >
                    <Icon size={16} color={active ? "#FFFFFF" : colors.textMuted} />
                    <Text
                      className={`ml-2 text-[13.5px] font-semibold ${
                        active ? "text-white" : "text-ink-soft dark:text-white/60"
                      }`}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {/* Account */}
          <Card icon={User} title="Account" delay={120}>
            {user ? (
              <>
                <Text className="text-[14.5px] text-ink dark:text-white">{user.email}</Text>
                <Text className="mt-1 text-[13px] text-ink-muted dark:text-white/45">
                  Conversations and receipts are saved to this account.
                </Text>
                <Pressable
                  onPress={() => void signOut()}
                  className="mt-4 items-center rounded-xl border border-hairline/70 py-3 dark:border-hairline-dark/70"
                >
                  <Text className="text-[14px] font-semibold text-rose-500">Sign out</Text>
                </Pressable>
              </>
            ) : (
              <Text className="text-[14px] text-ink-muted dark:text-white/45">
                Not signed in.
              </Text>
            )}
          </Card>

          {/* Backend */}
          <Card
            icon={Server}
            title="Server"
            hint={
              apiOverride
                ? "Overriding the URL compiled into this build."
                : `Using the compiled default: ${COMPILED_BASE_URL}`
            }
            delay={180}
          >
            <TextInput
              value={draftUrl}
              onChangeText={(text) => {
                setDraftUrl(text);
                setPing(null);
              }}
              placeholder={COMPILED_BASE_URL}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              className="rounded-xl border border-hairline/70 px-3.5 py-3 text-[14px] text-ink dark:border-hairline-dark/70 dark:text-white"
            />
            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={async () => {
                  setTesting(true);
                  setPing(await pingBackend(draftUrl.trim() || undefined));
                  setTesting(false);
                }}
                className="flex-1 items-center rounded-xl border border-hairline/70 py-2.5 dark:border-hairline-dark/70"
              >
                <Text className="text-[13.5px] font-semibold text-ink dark:text-white">
                  {testing ? "Testing…" : "Test"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void saveApiOverride(draftUrl.trim() || null)}
                className="flex-1 items-center rounded-xl bg-accent py-2.5"
              >
                <Text className="text-[13.5px] font-semibold text-white">Save</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setDraftUrl("");
                  void saveApiOverride(null);
                  setPing(null);
                }}
                className="items-center rounded-xl border border-hairline/70 px-4 py-2.5 dark:border-hairline-dark/70"
              >
                <Text className="text-[13.5px] font-semibold text-ink-muted dark:text-white/50">
                  Reset
                </Text>
              </Pressable>
            </View>
            {ping ? (
              <Text
                className={`mt-3 text-[13px] ${
                  ping.ok ? "text-emerald-500" : "text-rose-500"
                }`}
              >
                {ping.ok ? `Connected — ${ping.detail}` : `Failed — ${ping.detail}`}
              </Text>
            ) : null}
          </Card>
        </View>

        <Text className="mt-10 text-[13px] text-ink-faint dark:text-white/30">
          Sahayak {version} · Unified Customer Experience Protocol
        </Text>
      </View>
    </ScrollView>
  );
}
