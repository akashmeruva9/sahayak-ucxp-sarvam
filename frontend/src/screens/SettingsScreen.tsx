import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useColorScheme } from "nativewind";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";
import {
  ChevronRight,
  Info,
  Moon,
  Server,
  Smartphone,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react-native";
import type { ThemePreference } from "@/types";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useAuthStore } from "@/store/useAuthStore";
import { authConfigured } from "@/lib/supabase";
import { COMPILED_BASE_URL, pingBackend } from "@/api/client";
import { ScreenContainer } from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Smartphone },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function SettingsScreen() {
  const { colors } = useThemeColors();
  const { setColorScheme } = useColorScheme();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const authUser = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const [aboutOpen, setAboutOpen] = useState(false);

  const apiOverride = useSettingsStore((s) => s.apiOverride);
  const apiReady = useSettingsStore((s) => s.apiReady);
  const saveApiOverride = useSettingsStore((s) => s.saveApiOverride);
  const [draftUrl, setDraftUrl] = useState(apiOverride ?? "");
  const [testing, setTesting] = useState(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; detail: string } | null>(null);

  // The stored URL is read from disk asynchronously, so seed the field once it lands.
  useEffect(() => {
    if (apiReady) setDraftUrl(apiOverride ?? "");
  }, [apiReady, apiOverride]);

  const handleSave = async () => {
    Haptics.selectionAsync().catch(() => {});
    await saveApiOverride(draftUrl.trim() || null);
    setPingResult(null);
  };

  const handleReset = async () => {
    Haptics.selectionAsync().catch(() => {});
    setDraftUrl("");
    await saveApiOverride(null);
    setPingResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    // Test what's typed, not what's saved — so a bad URL is caught before saving.
    setPingResult(await pingBackend(draftUrl.trim() || undefined));
    setTesting(false);
  };


  const applyTheme = (value: ThemePreference) => {
    Haptics.selectionAsync().catch(() => {});
    setTheme(value);
    setColorScheme(value);
  };

  const version =
    Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "1.0.0";

  return (
    <ScreenContainer>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-40 pt-2"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-[32px] font-bold tracking-tight text-ink dark:text-white">
          Settings
        </Text>

        {/* Appearance */}
        <Animated.View entering={FadeInDown.duration(360)} className="mt-8">
          <SectionLabel>Appearance</SectionLabel>
          <View className="flex-row gap-2 rounded-2xl border border-hairline/70 bg-elevated p-1.5 dark:border-hairline-dark/70 dark:bg-elevated-dark">
            {THEME_OPTIONS.map((opt) => {
              const active = theme === opt.value;
              const Icon = opt.icon;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => applyTheme(opt.value)}
                  className={`flex-1 flex-row items-center justify-center rounded-xl py-3 ${
                    active ? "bg-accent" : ""
                  }`}
                >
                  <Icon size={17} color={active ? "#FFFFFF" : colors.textMuted} />
                  <Text
                    className={`ml-2 text-[14px] font-semibold ${
                      active ? "text-white" : "text-ink-muted dark:text-white/50"
                    }`}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        {/* Account */}
        {authConfigured ? (
          <Animated.View entering={FadeInDown.delay(100).duration(360)} className="mt-8">
            <SectionLabel>Account</SectionLabel>
            <View className="rounded-2xl border border-hairline/70 bg-elevated p-4 dark:border-hairline-dark/70 dark:bg-elevated-dark">
              <Text className="text-[15px] text-ink dark:text-white">
                {authUser ? authUser.email : "Not signed in"}
              </Text>
              <Text className="mt-1 text-[12px] text-ink-faint dark:text-white/40">
                {authUser
                  ? "Your conversations are saved to this account."
                  : "Sign in to keep conversations across devices."}
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  if (authUser) void signOut();
                  else router.push("/sign-in");
                }}
                className={`mt-3 items-center rounded-xl py-3 ${
                  authUser
                    ? "border border-hairline/70 dark:border-hairline-dark/70"
                    : "bg-accent"
                }`}
              >
                <Text
                  className={`text-[14px] font-semibold ${
                    authUser ? "text-rose-500" : "text-white"
                  }`}
                >
                  {authUser ? "Sign out" : "Sign in"}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}

        {/* Backend — editable at runtime so a shipped build can be repointed */}
        <Animated.View entering={FadeInDown.delay(120).duration(360)} className="mt-8">
          <SectionLabel>Backend</SectionLabel>
          <View className="rounded-2xl border border-hairline/70 bg-elevated p-4 dark:border-hairline-dark/70 dark:bg-elevated-dark">
            <View className="mb-2 flex-row items-center">
              <Server size={16} color={colors.textMuted} />
              <Text className="ml-2 text-[15px] text-ink dark:text-white">Server URL</Text>
            </View>

            <TextInput
              value={draftUrl}
              onChangeText={(text) => {
                setDraftUrl(text);
                setPingResult(null);
              }}
              placeholder={COMPILED_BASE_URL}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
              className="rounded-xl border border-hairline/70 px-3 py-3 text-[15px] text-ink dark:border-hairline-dark/70 dark:text-white"
            />

            <Text className="mt-2 text-[12px] leading-4 text-ink-faint dark:text-white/40">
              {apiOverride
                ? "Overriding the URL compiled into this build."
                : `Using the compiled default: ${COMPILED_BASE_URL}`}
            </Text>

            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={handleTest}
                disabled={testing}
                className="flex-1 items-center rounded-xl border border-hairline/70 py-3 dark:border-hairline-dark/70"
              >
                <Text className="text-[14px] font-semibold text-ink dark:text-white">
                  {testing ? "Testing…" : "Test"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                className="flex-1 items-center rounded-xl bg-accent py-3"
              >
                <Text className="text-[14px] font-semibold text-white">Save</Text>
              </Pressable>
              <Pressable
                onPress={handleReset}
                className="items-center rounded-xl border border-hairline/70 px-4 py-3 dark:border-hairline-dark/70"
              >
                <Text className="text-[14px] font-semibold text-ink-muted dark:text-white/50">
                  Reset
                </Text>
              </Pressable>
            </View>

            {pingResult ? (
              <Text
                className={`mt-3 text-[13px] ${
                  pingResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"
                }`}
              >
                {pingResult.ok ? `Connected — ${pingResult.detail}` : `Failed — ${pingResult.detail}`}
              </Text>
            ) : null}
          </View>
        </Animated.View>

        {/* About */}
        <Animated.View entering={FadeInDown.delay(160).duration(360)} className="mt-8">
          <SectionLabel>About</SectionLabel>
          <View className="overflow-hidden rounded-2xl border border-hairline/70 bg-elevated dark:border-hairline-dark/70 dark:bg-elevated-dark">
            <SettingsRow
              icon={Info}
              title="About UCXP"
              value=""
              onPress={() => setAboutOpen(true)}
              flat
            />
            <View className="h-px bg-hairline/70 dark:bg-hairline-dark/70" />
            <View className="flex-row items-center justify-between px-4 py-4">
              <Text className="text-[15px] text-ink dark:text-white">App version</Text>
              <Text className="text-[15px] text-ink-muted dark:text-white/40">{version}</Text>
            </View>
          </View>
        </Animated.View>

        <Text className="mt-10 text-center text-[13px] text-ink-faint dark:text-white/30">
          Sahayak · Unified Customer Experience Protocol
        </Text>
      </ScrollView>

      {/* About UCXP */}
      <PickerModal visible={aboutOpen} title="About UCXP" onClose={() => setAboutOpen(false)}>
        <View className="px-5 pb-2">
          <Text className="text-[15px] leading-[23px] text-ink-soft dark:text-white/70">
            The Unified Customer Experience Protocol (UCXP) is an open standard that lets a single
            client talk to any business — track orders, cancel services, book appointments, raise
            complaints — in any language, without app-hopping or hold music.
          </Text>
          <Text className="mt-4 text-[15px] leading-[23px] text-ink-soft dark:text-white/70">
            Sahayak is the reference client for UCXP: one place, every business, every language.
          </Text>
        </View>
      </PickerModal>
    </ScreenContainer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-faint dark:text-white/40">
      {children}
    </Text>
  );
}

function SettingsRow({
  icon: Icon,
  title,
  value,
  onPress,
  flat = false,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  onPress: () => void;
  flat?: boolean;
}) {
  const { colors } = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-4 py-4 ${
        flat
          ? ""
          : "rounded-2xl border border-hairline/70 bg-elevated dark:border-hairline-dark/70 dark:bg-elevated-dark"
      }`}
    >
      <Icon size={20} color={colors.textMuted} />
      <Text className="ml-3 flex-1 text-[15px] text-ink dark:text-white">{title}</Text>
      {value ? (
        <Text className="mr-1 text-[15px] text-ink-muted dark:text-white/40">{value}</Text>
      ) : null}
      <ChevronRight size={18} color={colors.textFaint} />
    </Pressable>
  );
}

function PickerModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="rounded-t-3xl bg-canvas pb-8 pt-4 dark:bg-canvas-dark"
        >
          <View className="mb-2 flex-row items-center justify-between px-5">
            <Text className="text-[18px] font-bold text-ink dark:text-white">{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} className="h-8 w-8 items-center justify-center">
              <X size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
