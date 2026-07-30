import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Clock, House, Settings, Store, type LucideIcon } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { palette } from "@/constants/theme";

/**
 * Minimal shape of the props Expo Router's <Tabs tabBar={...}> passes down.
 * Declared locally because Expo Router 57 bundles navigation internally and
 * does not expose @react-navigation types as a resolvable package.
 */
interface TabRoute {
  key: string;
  name: string;
}
interface NavbarProps {
  state: { index: number; routes: TabRoute[] };
  navigation: {
    emit: (event: {
      type: "tabPress";
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

const ICONS: Record<string, LucideIcon> = {
  home: House,
  companies: Store,
  history: Clock,
  settings: Settings,
};

const LABELS: Record<string, string> = {
  home: "Home",
  companies: "Companies",
  history: "History",
  settings: "Settings",
};

/**
 * The routes that are actually tabs.
 *
 * A custom `tabBar` is handed **every** route in the navigator, including ones
 * marked `href: null` — that option only hides a route from Expo Router's own
 * bar. Without this list, `conversation/[id]` rendered as a fifth item labelled
 * with its raw route name, which widened the bar until it covered the chat
 * composer underneath.
 */
const TAB_ROUTES = ["home", "companies", "history", "settings"];

/**
 * Height of the pill itself: py-2 (8+8) around items with py-2.5 (10+10)
 * wrapping a 20px icon.
 */
export const NAVBAR_PILL_HEIGHT = 56;

/** Breathing room between the bar and whatever sits above it. */
const NAVBAR_GAP = 12;

/**
 * Bottom space a screen must leave so the tab bar does not cover its content.
 *
 * The bar is absolutely positioned and floats *over* the screen. A scrolling
 * tab screen gets away with that through its own content padding, but anything
 * pinned to the bottom — a chat composer — ends up underneath it. Screens that
 * pin to the bottom ask for this instead of guessing a number, so the two
 * cannot drift apart when the bar's padding changes.
 */
export function useNavbarClearance(): number {
  const insets = useSafeAreaInsets();
  return NAVBAR_PILL_HEIGHT + NAVBAR_GAP + Math.max(insets.bottom, 12);
}

/** Floating, pill-style tab bar wired to Expo Router's Tabs. */
export function Navbar({ state, navigation }: NavbarProps) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useThemeColors();

  const activeName = state.routes[state.index]?.name;
  const tabs = state.routes.filter((route) => TAB_ROUTES.includes(route.name));

  /**
   * A conversation is a focused context: it has its own back button and pins a
   * composer to the bottom, and this bar floats *over* the screen rather than
   * sitting below it. Stepping aside is what gives the chat its full height —
   * reserving space for a bar nobody needs there would only shrink the thread.
   */
  if (!TAB_ROUTES.includes(activeName)) return null;

  return (
    <View
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      className="absolute inset-x-0 bottom-0 items-center bg-transparent"
    >
      <View
        className="flex-row items-center rounded-full border border-hairline/70 bg-elevated px-2 py-2 dark:border-hairline-dark/70 dark:bg-elevated-dark"
        style={{
          shadowColor: "#000",
          shadowOpacity: isDark ? 0.4 : 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        }}
      >
        {tabs.map((route) => {
          // `state.index` indexes the unfiltered list, so compare by name.
          const focused = route.name === activeName;
          const Icon = ICONS[route.name] ?? House;

          const onPress = () => {
            Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TabItem
              key={route.key}
              focused={focused}
              onPress={onPress}
              Icon={Icon}
              label={LABELS[route.name] ?? route.name}
              inactiveColor={colors.tabInactive}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({
  focused,
  onPress,
  Icon,
  label,
  inactiveColor,
}: {
  focused: boolean;
  onPress: () => void;
  Icon: LucideIcon;
  label: string;
  inactiveColor: string;
}) {
  const width = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    width.value = withTiming(focused ? 1 : 0, { duration: 240 });
  }, [focused, width]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: width.value,
    transform: [{ scale: 0.9 + width.value * 0.1 }],
  }));

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      className="flex-row items-center rounded-full px-4 py-2.5"
    >
      <Animated.View
        pointerEvents="none"
        style={pillStyle}
        className="absolute inset-0 rounded-full bg-accent/10 dark:bg-accent/20"
      />
      <Icon size={20} color={focused ? palette.accent : inactiveColor} strokeWidth={focused ? 2.4 : 2} />
      {focused ? (
        <Text className="ml-2 text-[13px] font-semibold text-accent">{label}</Text>
      ) : null}
    </Pressable>
  );
}
