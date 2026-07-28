import { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, MessagesSquare } from "lucide-react-native";
import type { ConversationSummary } from "@/types";
import { bucketFor, type DateBucket } from "@/utils/time";
import { useHistory } from "@/hooks/useHistory";
import { getBusiness } from "@/constants/businesses";
import { useThemeColors } from "@/hooks/useThemeColors";
import { palette } from "@/constants/theme";

/**
 * Reanimated `entering` animations stall on web: elements stay at their initial
 * opacity until something forces a repaint, so the page reads as half-loaded
 * until the user scrolls. The web screens therefore render statically — the
 * native screens keep their entrance animations.
 */

/**
 * History, desktop edition. Web only.
 *
 * A day-grouped timeline rather than the phone's stacked cards: on a wide
 * canvas the eye needs a left rail to follow, and each row can afford to show
 * the business it belonged to alongside the preview.
 */
const MEASURE = 860;
const ORDER: DateBucket[] = ["Today", "Yesterday", "Earlier"];

export function HistoryScreen() {
  const router = useRouter();
  const { colors } = useThemeColors();
  const { data, isLoading, refetch } = useHistory();

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const sections = useMemo(() => {
    const groups: Record<DateBucket, ConversationSummary[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };
    for (const item of data ?? []) groups[bucketFor(item.updatedAt)].push(item);
    return ORDER.filter((t) => groups[t].length > 0).map((t) => ({ title: t, items: groups[t] }));
  }, [data]);

  if (isLoading && !data) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (sections.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-10">
        <MessagesSquare size={38} color={colors.textFaint} />
        <Text className="mt-4 max-w-[380px] text-center text-[15px] leading-6 text-ink-muted dark:text-white/45">
          No conversations yet. Start one from Home and it will appear here.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="items-center px-10 pb-16 pt-12">
      <View className="w-full" style={{ maxWidth: MEASURE }}>
        <Text className="text-[36px] font-bold tracking-tight text-ink dark:text-white">
          History
        </Text>
        <Text className="mt-2 text-[16px] text-ink-muted dark:text-white/50">
          Every conversation, across the app, the web and WhatsApp.
        </Text>

        {sections.map((section, si) => (
          <View
            key={section.title}
            className="mt-10"
          >
            <Text className="mb-3 text-[12px] font-semibold uppercase tracking-[2px] text-ink-faint dark:text-white/40">
              {section.title}
            </Text>

            {/* Left rail ties the day's rows together. */}
            <View className="border-l border-hairline/70 pl-5 dark:border-hairline-dark/70">
              {section.items.map((c) => {
                const business = c.businessId ? getBusiness(c.businessId) : null;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => router.push(`/conversation/${c.id}`)}
                    className="mb-2 flex-row items-center rounded-xl px-3 py-3.5 hover:bg-elevated dark:hover:bg-elevated-dark"
                  >
                    {business ? (
                      <View
                        className="mr-3.5 h-9 w-9 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${business.color}1F` }}
                      >
                        <Text className="text-[16px]">{business.glyph}</Text>
                      </View>
                    ) : (
                      <View className="mr-3.5 h-9 w-9 items-center justify-center rounded-lg bg-surface dark:bg-surface-dark">
                        <MessagesSquare size={16} color={colors.textMuted} />
                      </View>
                    )}

                    <View className="flex-1">
                      <Text
                        numberOfLines={1}
                        className="text-[15px] font-semibold text-ink dark:text-white"
                      >
                        {c.title}
                      </Text>
                      <Text
                        numberOfLines={1}
                        className="mt-0.5 text-[13.5px] text-ink-muted dark:text-white/45"
                      >
                        {business ? `${business.name} · ` : ""}
                        {c.preview}
                      </Text>
                    </View>

                    <ChevronRight size={17} color={colors.textFaint} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
