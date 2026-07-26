import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ChevronRight } from "lucide-react-native";
import type { ConversationSummary } from "@/types";
import { getBusiness } from "@/constants/businesses";
import { formatRelative } from "@/utils/time";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Card } from "./Card";

interface ConversationCardProps {
  conversation: ConversationSummary;
  onPress: (id: string) => void;
  index?: number;
  /** Compact variant used in the Home "Recent" rail. */
  compact?: boolean;
}

export function ConversationCard({
  conversation,
  onPress,
  index = 0,
  compact = false,
}: ConversationCardProps) {
  const { colors } = useThemeColors();
  const business = getBusiness(conversation.businessId);

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(320)}>
      <Card onPress={() => onPress(conversation.id)} className={compact ? "p-3.5" : "p-4"}>
        <View className="flex-row items-center">
          <View
            className="items-center justify-center rounded-2xl"
            style={{ backgroundColor: business.tint, width: 44, height: 44 }}
          >
            <Text className="text-[20px]">{business.glyph}</Text>
          </View>

          <View className="ml-3 flex-1">
            <View className="flex-row items-center justify-between">
              <Text
                className="flex-1 text-[15px] font-semibold text-ink dark:text-white"
                numberOfLines={1}
              >
                {conversation.title}
              </Text>
              <Text className="ml-2 text-[12px] text-ink-faint dark:text-white/30">
                {formatRelative(conversation.updatedAt)}
              </Text>
            </View>
            <Text className="mt-0.5 text-[13px] text-ink-muted dark:text-white/40" numberOfLines={1}>
              {conversation.preview}
            </Text>
          </View>

          {!compact ? <ChevronRight size={18} color={colors.textFaint} className="ml-1" /> : null}
        </View>
      </Card>
    </Animated.View>
  );
}
