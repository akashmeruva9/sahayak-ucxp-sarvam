import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ArrowUpRight, Search, Store, X } from "lucide-react-native";
import type { Business } from "@/types";
import { useConversationStore } from "@/store/useConversationStore";
import { useBusinesses } from "@/hooks/useBusinesses";
import { useThemeColors } from "@/hooks/useThemeColors";
import { palette } from "@/constants/theme";

/**
 * Companies, desktop edition. Web only.
 *
 * The phone screen is a sectioned list, which on a wide canvas is a thin ribbon
 * of text down the left with nothing beside it. Here the directory is a grid:
 * the same data, but the page fills and each entry shows what it can actually
 * do — which is the protocol claim, one card per published manifest.
 */
const MEASURE = 1100;

export function CompaniesScreen() {
  const router = useRouter();
  const { colors } = useThemeColors();
  const [query, setQuery] = useState("");
  const startBusinessChat = useConversationStore((s) => s.startBusinessChat);
  const { data: all = [], isLoading } = useBusinesses();

  /**
   * One flat grid rather than per-category sections. Each merchant sits in its
   * own category, so grouping produced a single card per row — a narrow column
   * down the left of a wide page. The category rides on the card instead.
   */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? all.filter(
          (b) => b.name.toLowerCase().includes(q) || b.category.toLowerCase().includes(q)
        )
      : all;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [all, query]);

  const open = (b: Business) => router.push(`/conversation/${startBusinessChat(b.id)}`);

  return (
    <ScrollView className="flex-1" contentContainerClassName="items-center px-10 pb-16 pt-12">
      <View className="w-full" style={{ maxWidth: MEASURE }}>
        <Text className="text-[36px] font-bold tracking-tight text-ink dark:text-white">
          Companies
        </Text>
        <Text className="mt-2 text-[16px] text-ink-muted dark:text-white/50">
          Every business here published a UCXP manifest. Nothing was written to
          support any of them individually.
        </Text>

        {/* Search */}
        <View className="mt-7 max-w-[420px] flex-row items-center rounded-2xl border border-hairline/70 bg-elevated px-4 py-3 dark:border-hairline-dark/70 dark:bg-elevated-dark">
          <Search size={17} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or category"
            placeholderTextColor={colors.textFaint}
            className="ml-3 flex-1 text-[15px] text-ink dark:text-white"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <X size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {isLoading ? (
          <View className="mt-16 items-center">
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : matches.length === 0 ? (
          <View className="mt-16 items-center">
            <Store size={26} color={colors.textFaint} />
            <Text className="mt-3 text-[15px] text-ink-muted dark:text-white/50">
              Nothing matches “{query}”.
            </Text>
          </View>
        ) : (
          <View className="mt-8 flex-row flex-wrap gap-4">
            {matches.map((b, i) => (
              <Animated.View
                key={b.id}
                entering={FadeInDown.delay(i * 45).duration(360)}
                className="grow"
                style={{ minWidth: 250, maxWidth: 330 }}
              >
                <Pressable
                  onPress={() => open(b)}
                  className="h-full rounded-2xl border border-hairline/70 bg-elevated p-5 dark:border-hairline-dark/70 dark:bg-elevated-dark"
                >
                  <View className="flex-row items-center justify-between">
                    <View
                      className="h-11 w-11 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${b.color}1F` }}
                    >
                      <Text className="text-[20px]">{b.glyph}</Text>
                    </View>
                    <ArrowUpRight size={18} color={colors.textFaint} />
                  </View>
                  <Text className="mt-4 text-[16.5px] font-semibold text-ink dark:text-white">
                    {b.name}
                  </Text>
                  <Text className="mt-0.5 text-[13px] text-ink-muted dark:text-white/45">
                    {b.category}
                  </Text>
                  {b.capabilities?.length ? (
                    <View className="mt-3.5 flex-row flex-wrap gap-1.5">
                      {b.capabilities.map((c) => (
                        <View
                          key={c}
                          className="rounded-full bg-surface px-2.5 py-1 dark:bg-surface-dark"
                        >
                          <Text className="text-[11.5px] font-medium text-ink-soft dark:text-white/60">
                            {c.replace(/_/g, " ")}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
