import { useCallback, useMemo } from "react";
import { ActivityIndicator, SectionList, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
import { MessagesSquare } from "lucide-react-native";
import type { ConversationSummary } from "@/types";
import { bucketFor, type DateBucket } from "@/utils/time";
import { useHistory } from "@/hooks/useHistory";
import { ConversationCard, ScreenContainer } from "@/components";
import { useThemeColors } from "@/hooks/useThemeColors";
import { palette } from "@/constants/theme";

const ORDER: DateBucket[] = ["Today", "Yesterday", "Earlier"];

export function HistoryScreen() {
  const router = useRouter();
  const { colors } = useThemeColors();
  const { data, isLoading, refetch } = useHistory();

  // Keep the list fresh whenever the tab regains focus.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const sections = useMemo(() => {
    const items = data ?? [];
    const groups: Record<DateBucket, ConversationSummary[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };
    for (const item of items) groups[bucketFor(item.updatedAt)].push(item);
    return ORDER.filter((title) => groups[title].length > 0).map((title) => ({
      title,
      data: groups[title],
    }));
  }, [data]);

  return (
    <ScreenContainer>
      <View className="px-5 pb-2 pt-2">
        <Text className="text-[32px] font-bold tracking-tight text-ink dark:text-white">
          History
        </Text>
        <Text className="mt-1 text-[16px] text-ink-muted dark:text-white/50">
          Every conversation, in one place.
        </Text>
      </View>

      {isLoading && !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : sections.length === 0 ? (
        <View className="flex-1 items-center justify-center px-10">
          <MessagesSquare size={40} color={colors.textFaint} />
          <Text className="mt-4 text-center text-[15px] text-ink-muted dark:text-white/40">
            No conversations yet. Start one from Home and it'll show up here.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-5 pb-40 pt-2"
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text className="mb-2 mt-4 text-[13px] font-semibold uppercase tracking-wider text-ink-faint dark:text-white/40">
              {section.title}
            </Text>
          )}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeIn.duration(240)} className="mb-2.5">
              <ConversationCard
                conversation={item}
                index={index}
                onPress={(id) => router.push(`/conversation/${id}`)}
              />
            </Animated.View>
          )}
        />
      )}
    </ScreenContainer>
  );
}
