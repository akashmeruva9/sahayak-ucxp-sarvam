import { Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MessageCircle } from "lucide-react-native";
import type { Business } from "@/types";
import { palette } from "@/constants/theme";
import { Card } from "./Card";

interface CompanyRowProps {
  business: Business;
  onPress: (business: Business) => void;
}

/** A single row in the company directory. Tap → opens that company's support chat. */
export function CompanyRow({ business, onPress }: CompanyRowProps) {
  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <Card onPress={() => onPress(business)} className="p-3.5" elevated={false}>
        <View className="flex-row items-center">
          <View
            className="items-center justify-center rounded-2xl"
            style={{ backgroundColor: business.tint, width: 46, height: 46 }}
          >
            <Text className="text-[22px]">{business.glyph}</Text>
          </View>

          <View className="ml-3 flex-1">
            <Text className="text-[16px] font-semibold text-ink dark:text-white" numberOfLines={1}>
              {business.name}
            </Text>
            <Text className="mt-0.5 text-[13px] text-ink-muted dark:text-white/40" numberOfLines={1}>
              {business.category}
            </Text>
          </View>

          <View
            className="ml-2 h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: palette.accent + "14" }}
          >
            <MessageCircle size={18} color={palette.accent} />
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}
