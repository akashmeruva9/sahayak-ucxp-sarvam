import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ArrowUpRight } from "lucide-react-native";
import type { SuggestedAction } from "@/types";
import { getBusiness } from "@/constants/businesses";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Card } from "./Card";

interface SuggestedActionCardProps {
  action: SuggestedAction;
  onPress: (action: SuggestedAction) => void;
  index?: number;
}

/** A tappable "job to be done" card on Home. */
export function SuggestedActionCard({ action, onPress, index = 0 }: SuggestedActionCardProps) {
  const { colors } = useThemeColors();
  const business = getBusiness(action.businessId);

  return (
    <Animated.View entering={FadeInDown.delay(index * 70).duration(360)} className="flex-1">
      <Card onPress={() => onPress(action)} className="p-4">
        <View className="flex-row items-start justify-between">
          <View
            className="h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: business.tint }}
          >
            <Text className="text-[18px]">{business.glyph}</Text>
          </View>
          <ArrowUpRight size={18} color={colors.textFaint} />
        </View>
        <Text
          className="mt-3 text-[15px] font-semibold leading-[20px] text-ink dark:text-white"
          numberOfLines={2}
        >
          {action.title}
        </Text>
        <Text className="mt-1 text-[13px] text-ink-muted dark:text-white/40" numberOfLines={1}>
          {action.subtitle}
        </Text>
      </Card>
    </Animated.View>
  );
}
