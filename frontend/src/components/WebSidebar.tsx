import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { router, usePathname } from "expo-router";
import { Building2, Clock, Home, LogOut, Settings, type LucideIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useAuthStore } from "@/store/useAuthStore";
import { palette } from "@/constants/theme";

/**
 * Navigation rail. Web only.
 *
 * A phone's bottom tab bar floating in the middle of a 1700px window is the
 * single thing that makes the web build read as a stretched phone app. On a
 * wide viewport navigation belongs down the side, where it also has room for
 * labels and the account.
 *
 * It was a fixed 248px at every width, which is a quarter of a laptop window
 * and half a phone browser. Below `COMPACT_AT` the labels and the account card
 * drop and it becomes an icon rail: the same navigation, an eighth of the
 * width, and the content gets the room instead.
 */
const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/history", label: "History", icon: Clock },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Below this the rail carries icons only. Roughly a small laptop. */
const COMPACT_AT = 900;

/**
 * The browser's own tooltip, which is what makes an icon-only rail usable.
 *
 * react-native-web forwards `title` to the DOM node, but it isn't in React
 * Native's `PressableProps` — the prop is real, the type just doesn't describe
 * this renderer. Spreading it keeps the assertion in one place instead of at
 * every call site.
 */
const tooltip = (label: string) => ({ title: label }) as Record<string, unknown>;

export function WebSidebar() {
  const { colors } = useThemeColors();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const compact = width < COMPACT_AT;

  return (
    <View
      className={`h-full border-r border-hairline/70 bg-elevated/60 py-6 dark:border-hairline-dark/70 dark:bg-elevated-dark/40 ${
        compact ? "items-center px-2" : "px-4"
      }`}
      style={{ width: compact ? 72 : 248 }}
    >
      {compact ? (
        // The wordmark doesn't fit, and truncating it reads as a bug. The
        // monogram is the same brand at a size that does.
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
          <Text className="text-[16px] font-bold text-accent">स</Text>
        </View>
      ) : (
        <View className="px-2">
          <Text className="text-[22px] font-bold tracking-tight text-ink dark:text-white">
            Sahayak
          </Text>
          <Text className="mt-0.5 text-[12px] font-medium uppercase tracking-[1.5px] text-accent">
            UCXP
          </Text>
        </View>
      )}

      <View className={`mt-9 gap-1 ${compact ? "items-center" : ""}`}>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Pressable
              key={href}
              onPress={() => router.push(href as never)}
              accessibilityRole="link"
              // `title` is the browser's own tooltip — the only way the icons
              // stay legible once the labels are gone.
              {...(compact ? tooltip(label) : {})}
              className={`flex-row items-center rounded-xl transition-colors duration-150 ${
                compact ? "h-11 w-11 justify-center" : "px-3 py-2.5"
              } ${
                active
                  ? "bg-accent/10"
                  : "hover:bg-ink/[0.06] active:bg-ink/[0.1] dark:hover:bg-white/[0.07] dark:active:bg-white/10"
              }`}
            >
              <Icon
                size={18}
                color={active ? palette.accent : colors.textMuted}
                strokeWidth={active ? 2.4 : 2}
              />
              {compact ? null : (
                <Text
                  className={`ml-3 text-[14.5px] ${
                    active
                      ? "font-semibold text-accent"
                      : "font-medium text-ink-soft dark:text-white/60"
                  }`}
                >
                  {label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <View className="flex-1" />

      {user ? (
        compact ? (
          <Pressable
            onPress={() => void signOut()}
            {...tooltip(`Sign out (${user.email})`)}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            className="h-11 w-11 items-center justify-center rounded-xl transition-colors duration-150 hover:bg-rose-500/10 active:bg-rose-500/20"
          >
            <LogOut size={17} color={colors.textMuted} />
          </Pressable>
        ) : (
          <View className="rounded-xl border border-hairline/70 p-3 dark:border-hairline-dark/70">
            <Text
              numberOfLines={1}
              className="text-[13px] font-medium text-ink dark:text-white"
            >
              {user.email}
            </Text>
            <Pressable
              onPress={() => void signOut()}
              accessibilityRole="button"
              className="mt-2 -mx-1 flex-row items-center rounded-lg px-1 py-1 transition-colors duration-150 hover:bg-rose-500/10"
            >
              <LogOut size={14} color={colors.textMuted} />
              <Text className="ml-2 text-[13px] text-ink-muted dark:text-white/50">
                Sign out
              </Text>
            </Pressable>
          </View>
        )
      ) : null}
    </View>
  );
}
