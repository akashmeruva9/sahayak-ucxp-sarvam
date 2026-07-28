import { Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { Building2, Clock, Home, LogOut, Settings, type LucideIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/store/useAuthStore";
import { palette } from "@/constants/theme";

/**
 * Desktop navigation rail. Web only.
 *
 * A phone's bottom tab bar floating in the middle of a 1700px window is the
 * single thing that makes the web build read as a stretched phone app. On a
 * wide viewport navigation belongs down the side, where it also has room for
 * labels and the account.
 */
const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/history", label: "History", icon: Clock },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function WebSidebar() {
  const { colors } = useThemeColors();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <View
      className="h-full border-r border-hairline/70 bg-elevated/60 px-4 py-6 dark:border-hairline-dark/70 dark:bg-elevated-dark/40"
      style={{ width: 248 }}
    >
      <View className="px-2">
        <Text className="text-[22px] font-bold tracking-tight text-ink dark:text-white">
          Sahayak
        </Text>
        <Text className="mt-0.5 text-[12px] font-medium uppercase tracking-[1.5px] text-accent">
          UCXP
        </Text>
      </View>

      <View className="mt-9 gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Pressable
              key={href}
              onPress={() => router.push(href as never)}
              className={`flex-row items-center rounded-xl px-3 py-2.5 ${
                active ? "bg-accent/10" : ""
              }`}
            >
              <Icon
                size={18}
                color={active ? palette.accent : colors.textMuted}
                strokeWidth={active ? 2.4 : 2}
              />
              <Text
                className={`ml-3 text-[14.5px] ${
                  active
                    ? "font-semibold text-accent"
                    : "font-medium text-ink-soft dark:text-white/60"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-1" />

      {user ? (
        <View className="rounded-xl border border-hairline/70 p-3 dark:border-hairline-dark/70">
          <Text
            numberOfLines={1}
            className="text-[13px] font-medium text-ink dark:text-white"
          >
            {user.email}
          </Text>
          <Pressable
            onPress={() => void signOut()}
            className="mt-2 flex-row items-center"
          >
            <LogOut size={14} color={colors.textMuted} />
            <Text className="ml-2 text-[13px] text-ink-muted dark:text-white/50">
              Sign out
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
